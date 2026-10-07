import { z } from 'zod';
import { CheckinInput, LangSchema } from '@sahayak/shared';
import { defineTool, ToolError, type ToolRun } from './registry';
import { emitWebhook } from '../webhooks';
import { clinicToday, getSettings, notifyPatient, queueSnapshot } from './common';

const CONSENT_NOTICE_VERSION = 'v1';
const FRONT = ['patient', 'staff:receptionist', 'agent:checkin', 'api'];

/** Add the next token for the doctor's queue today. Serialised per clinic+day so numbers never clash. */
export async function issueToken(
  r: ToolRun,
  patientId: string,
  doctorId: string,
  appointmentId: string | null,
) {
  const { db, ctx } = r;
  const { date } = await clinicToday(db, ctx.clinicId);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${ctx.clinicId}:${date}`]);
  const existing = await db.query(
    `SELECT id, token_number FROM queue_entries WHERE patient_id=$1 AND queue_date=$2 AND status IN ('waiting','called','in_consultation','on_hold')`,
    [patientId, date],
  );
  if (existing.rowCount)
    return {
      id: existing.rows[0].id as string,
      token: existing.rows[0].token_number as number,
      created: false,
    };
  const n = await db.query(
    'SELECT COALESCE(MAX(token_number),0)+1 AS t, COALESCE(MAX(position_key),0)+1000 AS p FROM queue_entries WHERE clinic_id=$1 AND queue_date=$2',
    [ctx.clinicId, date],
  );
  const ins = await db.query(
    `INSERT INTO queue_entries (clinic_id,doctor_id,patient_id,appointment_id,queue_date,token_number,position_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ctx.clinicId, doctorId, patientId, appointmentId, date, n.rows[0].t, n.rows[0].p],
  );
  r.emit({ type: 'queue_changed', doctorId });
  return { id: ins.rows[0].id as string, token: n.rows[0].t as number, created: true };
}

export const lookupPatientByPhone = defineTool({
  name: 'lookup_patient_by_phone',
  description:
    'Check whether a phone number belongs to a returning patient. Returns only a yes/no and the patient id.',
  scope: 'read',
  module: 'checkin',
  input: z.object({ phone: CheckinInput.shape.phone }),
  allow: [
    ...FRONT,
    'agent:queue',
    'agent:front_desk',
    'agent:intake',
    'agent:leads',
    'agent:followup',
    'agent:records',
    'system',
  ],
  async run({ db }, { phone }) {
    const p = await db.query('SELECT id, language FROM patients WHERE phone=$1', [phone]);
    return p.rowCount
      ? {
          returning: true,
          patientId: p.rows[0].id as string,
          language: p.rows[0].language as 'en' | 'hi',
        }
      : { returning: false };
  },
});

export async function registerCheckinPatient(r: ToolRun, input: z.infer<typeof CheckinInput>) {
  const { db, ctx } = r;
  if (!(await db.query('SELECT id FROM doctors WHERE id=$1 AND active', [input.doctorId])).rowCount)
    throw new ToolError('doctor_not_found', 'Choose an active doctor from this clinic', 404);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${ctx.clinicId}:patient:${input.phone}`,
  ]);
  const found = await db.query('SELECT id, name, language FROM patients WHERE phone=$1', [
    input.phone,
  ]);
  let patientId: string,
    name: string,
    language = input.language,
    returning = false;
  if (found.rowCount) {
    returning = true;
    patientId = found.rows[0].id;
    name = found.rows[0].name;
    language = found.rows[0].language;
  } else {
    if (!input.consent.visit_data)
      throw new ToolError(
        'consent_required',
        'Consent to store visit data is required to check in',
      );
    if (!input.name) throw new ToolError('name_required', 'Name is required for a new patient');
    name = input.name;
    patientId = (
      await db.query(
        'INSERT INTO patients (clinic_id,name,phone,language) VALUES ($1,$2,$3,$4) RETURNING id',
        [ctx.clinicId, name, input.phone, language],
      )
    ).rows[0].id;
  }
  // Record each consent that was granted and is not already active (minimal, purpose-specific, versioned).
  for (const [purpose, granted] of Object.entries(input.consent)) {
    if (!granted) continue;
    await db.query(
      `INSERT INTO consents (clinic_id,patient_id,purpose,notice_version)
         SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM consents WHERE patient_id=$2 AND purpose=$3 AND withdrawn_at IS NULL)`,
      [ctx.clinicId, patientId, purpose, CONSENT_NOTICE_VERSION],
    );
  }
  r.ctx.patientId = patientId;
  return { patientId, name, language, returning };
}

export const checkInPatient = defineTool({
  name: 'check_in_patient',
  description:
    'Register a new patient (with consent) or recognise a returning one by phone, then issue a queue token.',
  module: 'checkin',
  input: CheckinInput.extend({ appointmentId: z.string().uuid().optional() }),
  allow: FRONT,
  async run(r, input) {
    const { db, ctx } = r;
    const { patientId, name, language, returning } = await registerCheckinPatient(r, input);
    // Link today's booked appointment for this doctor, if there is one.
    const { date } = await clinicToday(db, ctx.clinicId);
    let apptId = input.appointmentId ?? null;
    if (!apptId) {
      const a = await db.query(
        `SELECT id FROM appointments WHERE patient_id=$1 AND doctor_id=$2 AND status='booked'
           AND (starts_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$3))::date = $4::date ORDER BY starts_at LIMIT 1`,
        [patientId, input.doctorId, ctx.clinicId, date],
      );
      apptId = a.rows[0]?.id ?? null;
    }
    if (apptId)
      await db.query(
        "UPDATE appointments SET status='checked_in' WHERE id=$1 AND status='booked'",
        [apptId],
      );
    const tok = await issueToken(r, patientId, input.doctorId, apptId);
    if (tok.created)
      await emitWebhook(
        db,
        ctx.clinicId,
        'patient.checked_in',
        { patientId, queueEntryId: tok.id, doctorId: input.doctorId, token: tok.token, returning },
        { patientId },
      );
    const snap = await queueSnapshot(db, ctx.clinicId, input.doctorId);
    const me = snap.find((e) => e.id === tok.id);
    const wait = me?.wait_minutes ?? 0;
    const s = await getSettings(db, ctx.clinicId);
    let messaged = false;
    if (tok.created)
      messaged = await notifyPatient(
        r,
        { id: patientId, phone: input.phone, language },
        'msg.token_issued',
        { name, clinic: s.clinic_name, token: tok.token, wait },
        { sender: 'agent:checkin' },
      );
    return {
      patientId,
      name,
      returning,
      token: tok.token,
      queueEntryId: tok.id,
      waitMinutes: wait,
      language,
      messaged,
    };
  },
});

export const recordConsent = defineTool({
  name: 'record_consent',
  description:
    'Record or withdraw a consent for a patient (e.g. patient replies YES to receive messages).',
  module: 'core',
  input: z.object({
    patientId: z.string().uuid(),
    purpose: z.enum(['visit_data', 'whatsapp_messaging', 'reminders_followups']),
    granted: z.boolean(),
  }),
  allow: ['patient', 'staff:receptionist', 'agent:checkin', 'agent:front_desk', 'agent:leads'],
  async run({ db, ctx }, i) {
    if (i.granted) {
      await db.query(
        `INSERT INTO consents (clinic_id,patient_id,purpose,notice_version) SELECT $1,$2,$3,$4
          WHERE NOT EXISTS (SELECT 1 FROM consents WHERE patient_id=$2 AND purpose=$3 AND withdrawn_at IS NULL)`,
        [ctx.clinicId, i.patientId, i.purpose, CONSENT_NOTICE_VERSION],
      );
    } else {
      await db.query(
        'UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose=$2 AND withdrawn_at IS NULL',
        [i.patientId, i.purpose],
      );
    }
    return { ok: true };
  },
});

export const setPatientLanguage = defineTool({
  name: 'set_patient_language',
  description: 'Set a patient preferred language.',
  module: 'core',
  input: z.object({ patientId: z.string().uuid(), language: LangSchema }),
  allow: ['staff:receptionist', 'agent:front_desk', 'agent:checkin', 'agent:leads'],
  async run({ db }, i) {
    await db.query('UPDATE patients SET language=$2 WHERE id=$1', [i.patientId, i.language]);
    return { ok: true };
  },
});

export const createPatient = defineTool({
  name: 'create_patient',
  description:
    'Create a patient record from a chat (enquiry or booking). Requires explicit consent to store visit data.',
  module: 'core',
  input: z.object({
    name: z.string().trim().min(1).max(100),
    phone: CheckinInput.shape.phone,
    language: LangSchema.default('en'),
    consentVisitData: z.literal(true),
  }),
  allow: ['agent:leads', 'agent:front_desk', 'staff:receptionist', 'api'],
  async run({ db, ctx }, i) {
    const voice =
      !!ctx.conversationId &&
      !!(
        await db.query(
          "SELECT 1 FROM conversations WHERE id=$1 AND channel='voice' AND contact LIKE 'voice:%'",
          [ctx.conversationId],
        )
      ).rowCount;
    const r = await db.query(
      `INSERT INTO patients (clinic_id,name,phone,language) VALUES ($1,$2,$3,$4)
       ON CONFLICT (clinic_id,phone) DO UPDATE SET language=CASE WHEN $5 THEN patients.language ELSE EXCLUDED.language END RETURNING id`,
      [ctx.clinicId, i.name, i.phone, i.language, voice],
    );
    const patientId = r.rows[0].id as string;
    await db.query(
      `INSERT INTO consents (clinic_id,patient_id,purpose,notice_version) SELECT $1,$2,'visit_data',$3
        WHERE NOT EXISTS (SELECT 1 FROM consents WHERE patient_id=$2 AND purpose='visit_data' AND withdrawn_at IS NULL)`,
      [ctx.clinicId, patientId, CONSENT_NOTICE_VERSION],
    );
    if (voice)
      await db.query(
        "UPDATE conversations SET patient_id=$2 WHERE id=$1 AND channel='voice' AND contact LIKE 'voice:%' AND patient_id IS NULL",
        [ctx.conversationId, patientId],
      );
    if (!voice)
      await db.query(
        'UPDATE conversations SET patient_id=$2 WHERE clinic_id=$1 AND contact=$3 AND patient_id IS NULL',
        [ctx.clinicId, patientId, i.phone],
      );
    return { patientId };
  },
});

export const checkinTools = [
  createPatient,
  lookupPatientByPhone,
  checkInPatient,
  recordConsent,
  setPatientLanguage,
];
