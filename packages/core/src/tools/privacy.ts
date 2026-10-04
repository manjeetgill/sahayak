import { z } from 'zod';
import { t, type Lang } from '@sahayak/shared';
import { defineTool, ToolError, type ToolRun } from './registry';
import { emitWebhook } from '../webhooks';
import { assertOwn, deliver, getSettings } from './common';

const STAFF = ['staff:doctor', 'staff:receptionist'];
const SELF = ['agent:front_desk', 'agent:leads', ...STAFF];

async function conversationIds(
  r: ToolRun,
  patientId: string | null,
  phone: string | null,
): Promise<string[]> {
  const q = await r.db.query(
    'SELECT id FROM conversations WHERE ($1::uuid IS NOT NULL AND patient_id=$1) OR ($2::text IS NOT NULL AND contact=$2)',
    [patientId, phone],
  );
  return q.rows.map((x) => x.id as string);
}

async function logRequest(r: ToolRun, kind: string, via: string) {
  await r.db.query('INSERT INTO data_requests (clinic_id,kind,via) VALUES ($1,$2,$3)', [
    r.ctx.clinicId,
    kind,
    via,
  ]);
}

/**
 * Right to erasure. Removes what identifies the person (name, phone, birth year, chats, intake answers, pending
 * follow-ups, queued messages) and strips personal content from audit entries. Keeps de-identified operational
 * rows (that a visit/appointment happened) so the clinic's schedule and statistics stay correct.
 */
export async function erasePatient(
  r: ToolRun,
  patientId: string | null,
  contact: string | null,
  via: string,
  opts: { final?: boolean } = {},
): Promise<{ partial: boolean; holdUntil: string | null }> {
  const { db, ctx } = r;
  let phone = contact;
  let name: string | null = null;
  if (patientId) {
    const p = (await db.query('SELECT phone, name FROM patients WHERE id=$1', [patientId])).rows[0];
    if (!p) throw new ToolError('not_found', 'Patient not found', 404);
    phone = phone ?? p.phone;
    name = p.name;
  }
  const convs = await conversationIds(r, patientId, phone);
  await db.query('SELECT redact_patient_audit($1,$2,$3,$4,$5)', [
    ctx.clinicId,
    patientId,
    convs,
    phone,
    name,
  ]);
  if (convs.length) {
    await db.query('UPDATE flags SET conversation_id=NULL WHERE conversation_id = ANY($1)', [
      convs,
    ]);
    await db.query('DELETE FROM messages WHERE conversation_id = ANY($1)', [convs]);
    await db.query('DELETE FROM conversations WHERE id = ANY($1)', [convs]);
  }
  if (phone) await db.query('DELETE FROM outbox WHERE to_contact=$1', [phone]);
  let partial = false;
  let holdUntil: string | null = null;
  if (patientId) {
    // Signed clinical records (notes, uploaded reports) must be kept for the legal retention period.
    // Erasure then removes everything else now and the rest when that period ends.
    const years = Number(
      ((await getSettings(db, ctx.clinicId)) as any).retention_rules?.clinical_years ?? 3,
    );
    const last = (
      await db.query(
        `SELECT to_char((GREATEST((SELECT max(signed_at) FROM visit_notes WHERE patient_id=$1 AND status='signed'),
                                  (SELECT max(signed_at) FROM issued_documents WHERE patient_id=$1),
                                  (SELECT max(created_at) FROM patient_documents WHERE patient_id=$1)) + make_interval(years => $2))::date,'YYYY-MM-DD') AS until,
                (GREATEST((SELECT max(signed_at) FROM visit_notes WHERE patient_id=$1 AND status='signed'),
                          (SELECT max(signed_at) FROM issued_documents WHERE patient_id=$1),
                          (SELECT max(created_at) FROM patient_documents WHERE patient_id=$1)) + make_interval(years => $2))::date > now()::date AS held`,
        [patientId, years],
      )
    ).rows[0];
    partial = !opts.final && last.until !== null && last.held === true;
    holdUntil = partial ? last.until : null;
    await db.query("UPDATE flags SET summary='[removed on request]' WHERE patient_id=$1", [
      patientId,
    ]);
    await db.query('DELETE FROM follow_ups WHERE patient_id=$1', [patientId]);
    await db.query(
      'UPDATE consents SET withdrawn_at=COALESCE(withdrawn_at, now()) WHERE patient_id=$1',
      [patientId],
    );
    if (partial) {
      await db.query(
        'UPDATE patients SET tags=$2, clinical_hold_until=$3, erasure_requested_at=now() WHERE id=$1',
        [patientId, [], holdUntil],
      );
    } else {
      await db.query('SELECT purge_patient_clinical($1,$2)', [ctx.clinicId, patientId]);
      await db.query('DELETE FROM intake_summaries WHERE patient_id=$1', [patientId]);
      await db.query('UPDATE appointments SET reason=NULL WHERE patient_id=$1', [patientId]);
      await db.query(
        "UPDATE patients SET name='Erased patient', phone='erased:' || id::text, year_of_birth=NULL, tags='{}', clinical_hold_until=NULL WHERE id=$1",
        [patientId],
      );
    }
  }
  await logRequest(r, via === 'retention' ? 'retention_erase' : 'erase', via);
  if (patientId) await emitWebhook(db, ctx.clinicId, 'patient.erased', { patientId, partial }); // lets connected systems delete their copies
  r.emit({ type: 'queue_changed' });
  return { partial, holdUntil };
}

export const getMyData = defineTool({
  name: 'get_my_data',
  description: 'What Sahayak holds about this patient (summary for the patient themselves).',
  module: 'core',
  input: z.object({ patientId: z.string().uuid() }),
  allow: SELF,
  auditOutput: () => ({ summaryShown: true }), // keep the personal data itself out of the audit log
  async run(r, { patientId }) {
    assertOwn(r.ctx, patientId);
    const { db } = r;
    const p = (
      await db.query(
        'SELECT name, phone, language, year_of_birth, created_at FROM patients WHERE id=$1',
        [patientId],
      )
    ).rows[0];
    if (!p) throw new ToolError('not_found', 'Patient not found', 404);
    const n = async (sql: string) => (await db.query(sql, [patientId])).rows[0].n as number;
    return {
      name: p.name,
      phone: p.phone,
      language: p.language as Lang,
      yearOfBirth: p.year_of_birth,
      visits: await n(
        "SELECT count(*)::int n FROM queue_entries WHERE patient_id=$1 AND status='done'",
      ),
      appointments: await n('SELECT count(*)::int n FROM appointments WHERE patient_id=$1'),
      messages: await n(
        'SELECT count(*)::int n FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.patient_id=$1',
      ),
      intakeAnswers: await n('SELECT count(*)::int n FROM intake_summaries WHERE patient_id=$1'),
      consents: (
        await db.query(
          'SELECT purpose FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL ORDER BY purpose',
          [patientId],
        )
      ).rows.map((x) => x.purpose as string),
    };
  },
});

export const exportPatientData = defineTool({
  name: 'export_patient_data',
  description: 'Complete copy of everything held about one patient (staff only).',
  module: 'core',
  input: z.object({ patientId: z.string().uuid() }),
  allow: STAFF,
  auditOutput: () => ({ exported: true }), // keep the personal data itself out of the audit log
  async run(r, { patientId }) {
    const { db } = r;
    const p = (
      await db.query(
        'SELECT id, name, phone, language, year_of_birth, created_at FROM patients WHERE id=$1',
        [patientId],
      )
    ).rows[0];
    if (!p) throw new ToolError('not_found', 'Patient not found', 404);
    const rows = async (sql: string) => (await db.query(sql, [patientId])).rows;
    await logRequest(r, 'export', 'staff');
    return {
      exportedAt: new Date().toISOString(),
      patient: p,
      consents: await rows(
        'SELECT purpose, notice_version, granted_at, withdrawn_at FROM consents WHERE patient_id=$1 ORDER BY granted_at',
      ),
      appointments: await rows(
        'SELECT starts_at, status, reason, source FROM appointments WHERE patient_id=$1 ORDER BY starts_at',
      ),
      visits: await rows(
        'SELECT queue_date, token_number, status, checked_in_at, finished_at FROM queue_entries WHERE patient_id=$1 ORDER BY queue_date',
      ),
      intake: await rows(
        'SELECT created_at, answers, summary FROM intake_summaries WHERE patient_id=$1 ORDER BY created_at',
      ),
      messages: await rows(
        'SELECT m.created_at, m.direction, m.sender, m.body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.patient_id=$1 ORDER BY m.created_at',
      ),
      visitNotes: await rows(
        "SELECT created_at, signed_at, status, note FROM visit_notes WHERE patient_id=$1 AND status='signed' ORDER BY created_at",
      ),
      issuedDocuments: await rows(
        "SELECT doc_number, kind, subtype, status, signed_at FROM issued_documents WHERE patient_id=$1 AND status IN ('signed','void') ORDER BY signed_at",
      ),
      documents: await rows(
        'SELECT created_at, kind, filename, mime, size_bytes FROM patient_documents WHERE patient_id=$1 ORDER BY created_at',
      ),
      followUps: await rows(
        'SELECT kind, run_at, status FROM follow_ups WHERE patient_id=$1 ORDER BY run_at',
      ),
    };
  },
});

export const erasePatientData = defineTool({
  name: 'erase_patient_data',
  description:
    "Erase a patient's personal data on their request (self-service or via the receptionist).",
  module: 'core',
  input: z.object({ patientId: z.string().uuid().nullable() }),
  allow: SELF,
  async run(r, { patientId }) {
    const { ctx } = r;
    if (patientId) assertOwn(ctx, patientId);
    let contact: string | null = null;
    if (ctx.conversationId)
      contact =
        (await r.db.query('SELECT contact FROM conversations WHERE id=$1', [ctx.conversationId]))
          .rows[0]?.contact ?? null;
    const via = ctx.actor.kind === 'staff' ? 'staff' : 'whatsapp';
    const lang = ((
      await r.db.query('SELECT language FROM conversations WHERE id=$1', [
        ctx.conversationId ?? null,
      ])
    ).rows[0]?.language ?? 'en') as Lang;
    const res = await erasePatient(r, patientId, ctx.actor.kind === 'staff' ? null : contact, via);
    const text = res.partial
      ? t(lang, 'msg.erased_partial', { date: res.holdUntil ?? '' })
      : t(lang, 'msg.erased');
    // The chat is gone, so the confirmation is delivered but not stored.
    if (contact && ctx.actor.kind !== 'staff') await deliver(r, { to: contact, text, lang });
    return { ok: true, text, partial: res.partial, holdUntil: res.holdUntil };
  },
});

export const withdrawMessaging = defineTool({
  name: 'withdraw_messaging',
  description:
    'STOP: withdraw WhatsApp messaging and reminder consent and cancel pending follow-ups.',
  module: 'core',
  input: z.object({ patientId: z.string().uuid() }),
  allow: SELF,
  async run(r, { patientId }) {
    assertOwn(r.ctx, patientId);
    const { db } = r;
    await db.query(
      "UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose IN ('whatsapp_messaging','reminders_followups') AND withdrawn_at IS NULL",
      [patientId],
    );
    await db.query(
      "UPDATE follow_ups SET status='skipped', detail='consent_withdrawn' WHERE patient_id=$1 AND status='pending'",
      [patientId],
    );
    await logRequest(r, 'withdraw_messaging', r.ctx.actor.kind === 'staff' ? 'staff' : 'whatsapp');
    return { ok: true };
  },
});

/** Delete what has outlived its purpose. Runs daily per clinic (retention rules are per clinic, with floors). */
export const applyRetention = defineTool({
  name: 'apply_retention',
  description: 'Apply the clinic data-retention rules.',
  module: 'core',
  input: z.object({}),
  allow: ['system'],
  async run(r) {
    const { db, ctx } = r;
    const rules = ((await getSettings(db, ctx.clinicId)) as any).retention_rules ?? {};
    const messages = await db.query(
      'DELETE FROM messages WHERE created_at < now() - make_interval(days => $1)',
      [rules.messages_days ?? 180],
    );
    await db.query(
      'DELETE FROM conversations c WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id) AND c.updated_at < now() - make_interval(days => $1)',
      [rules.messages_days ?? 180],
    );
    const intake = await db.query(
      'DELETE FROM intake_summaries WHERE created_at < now() - make_interval(days => $1)',
      [rules.intake_days ?? 365],
    );
    await db.query(
      "DELETE FROM outbox WHERE status IN ('sent','failed') AND created_at < now() - interval '1 day'",
    );
    await db.query(
      "DELETE FROM follow_ups WHERE status<>'pending' AND created_at < now() - interval '90 days'",
    );
    const audit = await db.query('SELECT redact_old_audit($1,$2) AS n', [
      ctx.clinicId,
      rules.audit_days ?? 730,
    ]);
    // Patients with no visit or appointment for a long time: erase (storage limitation).
    const inactive = (
      await db.query(
        `SELECT p.id FROM patients p
          WHERE p.name <> 'Erased patient' AND p.created_at < now() - make_interval(days => $1)
            AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.patient_id=p.id AND q.queue_date > (now() - make_interval(days => $1))::date)
            AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.starts_at > now() - make_interval(days => $1))
            AND NOT EXISTS (SELECT 1 FROM visit_notes n WHERE n.patient_id=p.id AND n.status='signed' AND n.signed_at > now() - make_interval(years => $2))
            AND NOT EXISTS (SELECT 1 FROM patient_documents d WHERE d.patient_id=p.id AND d.created_at > now() - make_interval(years => $2))
            AND NOT EXISTS (SELECT 1 FROM issued_documents x WHERE x.patient_id=p.id AND x.signed_at > now() - make_interval(years => $2))
          UNION
          SELECT id FROM patients WHERE name <> 'Erased patient' AND clinical_hold_until IS NOT NULL AND clinical_hold_until <= now()::date`,
        [rules.inactive_patient_days ?? 1095, rules.clinical_years ?? 3],
      )
    ).rows;
    for (const p of inactive) await erasePatient(r, p.id, null, 'retention', { final: true });
    return {
      messages: messages.rowCount,
      intake: intake.rowCount,
      auditRedacted: audit.rows[0].n,
      patientsErased: inactive.length,
    };
  },
});

export const privacyTools = [
  getMyData,
  exportPatientData,
  erasePatientData,
  withdrawMessaging,
  applyRetention,
];
