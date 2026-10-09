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
    await db.query('DELETE FROM inbox_reviews WHERE item_key = ANY($1::text[])', [
      convs.flatMap((id) => [`conversation:${id}`, `alert:${id}`]),
    ]);
    await db.query('UPDATE flags SET conversation_id=NULL WHERE conversation_id = ANY($1)', [
      convs,
    ]);
    await db.query(
      "UPDATE agent_platform_receipts SET response=NULL,state='UNKNOWN' WHERE conversation_id=ANY($1)",
      [convs],
    );
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
                                  (SELECT max(created_at) FROM patient_documents WHERE patient_id=$1),
                                  (SELECT max(created_at) FROM clinical_entries WHERE patient_id=$1),
                                  (SELECT max(approved_at) FROM patient_instructions WHERE patient_id=$1)) + make_interval(years => $2))::date,'YYYY-MM-DD') AS until,
                (GREATEST((SELECT max(signed_at) FROM visit_notes WHERE patient_id=$1 AND status='signed'),
                          (SELECT max(signed_at) FROM issued_documents WHERE patient_id=$1),
                          (SELECT max(created_at) FROM patient_documents WHERE patient_id=$1),
                                  (SELECT max(created_at) FROM clinical_entries WHERE patient_id=$1),
                                  (SELECT max(approved_at) FROM patient_instructions WHERE patient_id=$1)) + make_interval(years => $2))::date > now()::date AS held`,
        [patientId, years],
      )
    ).rows[0];
    partial = !opts.final && last.until !== null && last.held === true;
    holdUntil = partial ? last.until : null;
    await db.query("UPDATE flags SET summary='[removed on request]' WHERE patient_id=$1", [
      patientId,
    ]);
    await db.query(
      "UPDATE clinic_charges SET patient_id=NULL,description='Clinic charge (patient details removed)' WHERE patient_id=$1",
      [patientId],
    );
    await db.query('DELETE FROM inbox_reviews WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM patient_access_links WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM insurance_cases WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM care_plans WHERE patient_id=$1', [patientId]);
    await db.query("DELETE FROM patient_instructions WHERE patient_id=$1 AND status='draft'", [
      patientId,
    ]);
    await db.query(
      "UPDATE patient_feedback_improvements SET title='Clinic improvement (patient details removed)' WHERE source_checkin_id IN (SELECT id FROM patient_checkins WHERE patient_id=$1)",
      [patientId],
    );
    await db.query('DELETE FROM qr_arrivals WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM patient_checkins WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM care_tasks WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM appointment_waitlist WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM follow_ups WHERE patient_id=$1', [patientId]);
    await db.query('DELETE FROM evening_checkin_replies WHERE patient_id=$1', [patientId]);
    await db.query(
      'UPDATE consents SET withdrawn_at=COALESCE(withdrawn_at, now()) WHERE patient_id=$1',
      [patientId],
    );
    if (partial) {
      await db.query(
        `DELETE FROM consultation_capture_consents c WHERE c.patient_id=$1
         AND NOT EXISTS (SELECT 1 FROM visit_notes n WHERE n.capture_consent_id=c.id AND n.status='signed')`,
        [patientId],
      );
      await db.query(
        'UPDATE patients SET tags=$2, clinical_hold_until=$3, erasure_requested_at=now() WHERE id=$1',
        [patientId, [], holdUntil],
      );
    } else {
      await db.query('DELETE FROM clinical_entries WHERE patient_id=$1', [patientId]);
      await db.query('DELETE FROM patient_instructions WHERE patient_id=$1', [patientId]);
      await db.query('SELECT purge_patient_clinical($1,$2)', [ctx.clinicId, patientId]);
      await db.query('DELETE FROM consultation_capture_consents WHERE patient_id=$1', [patientId]);
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
      onlinePayments: await rows(
        'SELECT o.id,o.amount_paise,o.currency,o.state,o.provider_order_id,o.provider_payment_id,o.detail,o.verified_at,o.created_at FROM qr_payment_orders o JOIN qr_arrivals a ON a.id=o.arrival_id WHERE a.patient_id=$1',
      ),
      qrArrivals: await rows(
        'SELECT id,doctor_id,arrival_date,amount_paise,status,queue_entry_id,created_at,confirmed_at FROM qr_arrivals WHERE patient_id=$1',
      ),
      patientFeedback: await rows(
        'SELECT f.* FROM patient_feedback_responses f JOIN patient_checkins c ON c.id=f.checkin_id WHERE c.patient_id=$1',
      ),
      patientFeedbackHistory: await rows(
        'SELECT e.* FROM patient_feedback_events e JOIN patient_checkins c ON c.id=e.checkin_id WHERE c.patient_id=$1',
      ),
      patientFeedbackResolutions: await rows(
        'SELECT r.* FROM patient_feedback_resolutions r JOIN patient_checkins c ON c.id=r.checkin_id WHERE c.patient_id=$1',
      ),
      patientCheckins: await rows(
        'SELECT * FROM patient_checkins WHERE patient_id=$1 ORDER BY created_at',
      ),
      exportedAt: new Date().toISOString(),
      patient: p,
      privateLinks: await rows(
        'SELECT created_at,expires_at,revoked_at FROM patient_access_links WHERE patient_id=$1 ORDER BY created_at',
      ),
      consents: await rows(
        'SELECT purpose, notice_version, granted_at, withdrawn_at FROM consents WHERE patient_id=$1 ORDER BY granted_at',
      ),
      conversationCaptureConsents: await rows(
        'SELECT id,doctor_id,agreed_at,ended_at,method FROM consultation_capture_consents WHERE patient_id=$1 ORDER BY agreed_at',
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
        "SELECT created_at, signed_at, status, source, transcript, note, capture_consent_id FROM visit_notes WHERE patient_id=$1 AND status='signed' ORDER BY created_at",
      ),
      issuedDocuments: await rows(
        "SELECT doc_number, kind, subtype, status, signed_at FROM issued_documents WHERE patient_id=$1 AND status IN ('signed','void') ORDER BY signed_at",
      ),
      documents: await rows(
        'SELECT created_at, kind, filename, mime, size_bytes FROM patient_documents WHERE patient_id=$1 ORDER BY created_at',
      ),
      charges: await rows(
        'SELECT id,description,amount_paise,status,created_at FROM clinic_charges WHERE patient_id=$1',
      ),
      payments: await rows(
        'SELECT p.amount_paise,p.method,p.created_at,p.voided_at,p.correction_reason FROM clinic_payments p JOIN clinic_charges c ON c.id=p.charge_id WHERE c.patient_id=$1',
      ),
      insuranceCases: await rows('SELECT * FROM insurance_cases WHERE patient_id=$1'),
      insuranceHistory: await rows(
        'SELECT h.* FROM insurance_case_history h JOIN insurance_cases c ON c.id=h.case_id WHERE c.patient_id=$1',
      ),
      clinicalEntries: await rows(
        'SELECT kind,data,status,occurred_on::text,verified_at,document_id,result_reviewed_at,result_review_note FROM clinical_entries WHERE patient_id=$1 ORDER BY occurred_on',
      ),
      instructions: await rows(
        'SELECT language,body,status,approved_at,translated_from,translation_source FROM patient_instructions WHERE patient_id=$1 ORDER BY created_at',
      ),
      carePlans: await rows(
        'SELECT id,title,status,approved_at FROM care_plans WHERE patient_id=$1',
      ),
      careStepHistory: await rows(
        'SELECT step_id,status,response,created_at FROM care_step_history WHERE patient_id=$1 ORDER BY created_at',
      ),
      careSteps: await rows(
        'SELECT plan_id,title,message,due_at,status,response,response_due_at FROM care_plan_steps WHERE patient_id=$1',
      ),
      careTasks: await rows(
        'SELECT kind,title,status,due_at,reviewed_at,informed_at FROM care_tasks WHERE patient_id=$1 ORDER BY created_at',
      ),
      waitingList: await rows(
        'SELECT from_date,to_date,status,opted_in_at FROM appointment_waitlist WHERE patient_id=$1 ORDER BY created_at',
      ),
      slotOffers: await rows(
        'SELECT starts_at,expires_at,status FROM slot_offers WHERE patient_id=$1 ORDER BY created_at',
      ),
      followUps: await rows(
        'SELECT kind, run_at, status FROM follow_ups WHERE patient_id=$1 ORDER BY run_at',
      ),
      eveningReplies: await rows(
        'SELECT feeling,message,created_at FROM evening_checkin_replies WHERE patient_id=$1 ORDER BY created_at',
      ),
      eveningDelivery: await rows(
        `SELECT d.state,d.delivered_at,d.read_at,d.created_at FROM patient_evening_delivery d
         JOIN follow_ups f ON f.id=d.follow_up_id WHERE f.patient_id=$1 ORDER BY d.created_at`,
      ),
      waitingRoomAnswers: await rows(
        'SELECT waiting_answer,waiting_answered_at FROM qr_arrivals WHERE patient_id=$1 AND waiting_answer IS NOT NULL ORDER BY waiting_answered_at',
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
    await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [patientId]);
    await db.query(
      "UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose IN ('whatsapp_messaging','reminders_followups','evening_checkins') AND withdrawn_at IS NULL",
      [patientId],
    );
    await db.query(
      "UPDATE follow_ups SET status='skipped', detail='consent_withdrawn' WHERE patient_id=$1 AND status='pending'",
      [patientId],
    );
    await db.query(
      "UPDATE patient_checkins SET status=CASE WHEN work_status='planned' THEN 'cancelled' ELSE status END,cancelled_at=now(),cancellation_reason='consent_withdrawn' WHERE patient_id=$1 AND status='scheduled'",
      [patientId],
    );
    await db.query(
      'UPDATE patient_feedback_links SET expires_at=now() WHERE checkin_id IN (SELECT id FROM patient_checkins WHERE patient_id=$1)',
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
    await db.query("DELETE FROM patient_access_links WHERE expires_at<now()-interval '7 days'");
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
    await db.query(
      "UPDATE qr_arrivals SET waiting_answer=NULL,waiting_answered_at=NULL WHERE waiting_answered_at < now() - interval '90 days'",
    );
    const audit = await db.query('SELECT redact_old_audit($1,$2) AS n', [
      ctx.clinicId,
      rules.audit_days ?? 730,
    ]);
    await db.query(
      "UPDATE agent_platform_receipts SET response=NULL,state='UNKNOWN' WHERE created_at < now()-interval '1 day' AND response IS NOT NULL",
    );
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
            AND NOT EXISTS (SELECT 1 FROM clinical_entries e WHERE e.patient_id=p.id AND e.created_at > now() - make_interval(years => $2))
            AND NOT EXISTS (SELECT 1 FROM patient_instructions i WHERE i.patient_id=p.id AND i.approved_at > now() - make_interval(years => $2))
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
