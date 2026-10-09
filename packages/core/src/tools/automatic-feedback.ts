import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';

type ReadRun = Pick<ToolRun, 'db' | 'ctx'>;
const defaults = {
  enabled: false,
  delayDays: -1,
  sendTime: '18:00',
  assignedTo: null as string | null,
  reminder: false,
  waitingQuestion: true,
  eveningEnabled: false,
  eveningNights: 3,
  eveningTime: '19:00',
};
async function preferences(r: ReadRun, doctorId: string) {
  const row = (
    await r.db.query('SELECT * FROM doctor_feedback_preferences WHERE doctor_id=$1', [doctorId])
  ).rows[0];
  return row
    ? {
        enabled: row.enabled,
        delayDays: row.delay_days,
        sendTime: String(row.send_time).slice(0, 5),
        assignedTo: row.assigned_to as string | null,
        reminder: row.reminder_enabled,
        waitingQuestion: row.waiting_question_enabled,
        eveningEnabled: row.evening_enabled,
        eveningNights: row.evening_nights,
        eveningTime: String(row.evening_time).slice(0, 5),
      }
    : defaults;
}
function ownDoctor(r: ReadRun) {
  if (r.ctx.actor.kind !== 'staff' || r.ctx.actor.role !== 'doctor' || !r.ctx.actor.doctorId)
    throw new ToolError('forbidden', 'A linked doctor login is required', 403);
  return r.ctx.actor.doctorId;
}
export const automaticFeedbackTools = [
  defineTool({
    name: 'get_feedback_preferences',
    description: 'Read my saved automatic post-visit feedback settings.',
    module: 'core',
    allow: ['staff:doctor'],
    input: z.object({}),
    async run(r) {
      return {
        ...(await preferences(r, ownDoctor(r))),
        timezone: (await r.db.query('SELECT timezone FROM clinics WHERE id=$1', [r.ctx.clinicId]))
          .rows[0].timezone,
        staff: (
          await r.db.query(
            "SELECT id,name,role FROM staff_users WHERE role IN ('doctor','receptionist') ORDER BY name",
          )
        ).rows,
        deliveryEnabled: !!(await r.db.query('SELECT enabled FROM patient_feedback_settings'))
          .rows[0]?.enabled,
        eveningDeliveryReady:
          !!(await r.db.query('SELECT enabled FROM patient_evening_settings')).rows[0]?.enabled &&
          process.env.JOBS_ENABLED !== 'false',
      };
    },
  }),
  defineTool({
    name: 'save_feedback_preferences',
    description: 'Save my automatic feedback scheduling preferences for future completed visits.',
    module: 'core',
    allow: ['staff:doctor'],
    input: z
      .object({
        enabled: z.boolean(),
        delayDays: z.number().int().min(-1).max(30),
        sendTime: z.string().regex(/^(0[89]|1\d|20):[0-5]\d$/),
        assignedTo: z.string().uuid().nullable(),
        reminder: z.boolean(),
        waitingQuestion: z.boolean().default(true),
        eveningEnabled: z.boolean().default(false),
        eveningNights: z.number().int().min(1).max(3).default(3),
        eveningTime: z
          .string()
          .regex(/^(18|19|20):[0-5]\d$/)
          .default('19:00'),
      })
      .strict(),
    async run(r, i) {
      const doctorId = ownDoctor(r);
      if (
        i.assignedTo &&
        !(
          await r.db.query(
            "SELECT id FROM staff_users WHERE id=$1 AND role IN ('doctor','receptionist')",
            [i.assignedTo],
          )
        ).rowCount
      )
        throw new ToolError('wrong_owner', 'Choose a doctor or receptionist from this clinic');
      await r.db.query(
        `INSERT INTO doctor_feedback_preferences(clinic_id,doctor_id,enabled,delay_days,send_time,assigned_to,reminder_enabled,updated_by,waiting_question_enabled,evening_enabled,evening_nights,evening_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(doctor_id) DO UPDATE SET enabled=EXCLUDED.enabled,delay_days=EXCLUDED.delay_days,send_time=EXCLUDED.send_time,assigned_to=EXCLUDED.assigned_to,reminder_enabled=EXCLUDED.reminder_enabled,updated_by=EXCLUDED.updated_by,waiting_question_enabled=EXCLUDED.waiting_question_enabled,evening_enabled=EXCLUDED.evening_enabled,evening_nights=EXCLUDED.evening_nights,evening_time=EXCLUDED.evening_time,updated_at=now()`,
        [
          r.ctx.clinicId,
          doctorId,
          i.enabled,
          i.delayDays,
          i.sendTime,
          i.assignedTo,
          i.reminder,
          r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : null,
          i.waitingQuestion,
          i.eveningEnabled,
          i.eveningNights,
          i.eveningTime,
        ],
      );
      return { ok: true };
    },
  }),
];

/** Shared by the finish preview and transaction. Never invents patient consent. */
export async function automaticFeedbackPlan(r: ReadRun, visitId: string) {
  const visit = (
    await r.db.query('SELECT patient_id,doctor_id,finished_at FROM queue_entries WHERE id=$1', [
      visitId,
    ])
  ).rows[0];
  if (!visit) return { state: 'unavailable' as const };
  const existing = (
    await r.db.query(
      'SELECT id,status,scheduled_at FROM patient_checkins WHERE queue_entry_id=$1 ORDER BY created_at DESC LIMIT 1',
      [visitId],
    )
  ).rows[0];
  if (existing)
    return {
      state: existing.status === 'cancelled' ? ('cancelled' as const) : ('existing' as const),
      checkinId: existing.id,
      scheduledAt: existing.scheduled_at,
    };
  const policy = await preferences(r, visit.doctor_id);
  if (!policy.enabled) return { state: 'off' as const };
  const patient = (
    await r.db.query(
      "SELECT id,language FROM patients WHERE id=$1 AND erasure_requested_at IS NULL AND name<>'Erased patient'",
      [visit.patient_id],
    )
  ).rows[0];
  if (!patient) return { state: 'no_permission' as const };
  const consent = (
    await r.db.query(
      "SELECT count(DISTINCT purpose)::int n,max(granted_at) granted_at FROM consents WHERE patient_id=$1 AND withdrawn_at IS NULL AND purpose IN ('whatsapp_messaging','reminders_followups')",
      [patient.id],
    )
  ).rows[0];
  if (consent.n !== 2) return { state: 'no_permission' as const };
  const owner = (
    await r.db.query(
      `SELECT id,name FROM staff_users WHERE role IN ('doctor','receptionist') AND (id=$1 OR (role='doctor' AND doctor_id=$2)) ORDER BY (id=$1) DESC NULLS LAST,id LIMIT 1`,
      [policy.assignedTo, visit.doctor_id],
    )
  ).rows[0];
  if (!owner) return { state: 'no_owner' as const };
  const timing = (
    policy.delayDays === -1
      ? await r.db.query(
          `WITH c AS (SELECT timezone,COALESCE($1::timestamptz,now())+interval '30 minutes' candidate FROM clinics WHERE id=$2),
       t AS (SELECT timezone,candidate,candidate AT TIME ZONE timezone local_candidate FROM c)
       SELECT timezone,CASE WHEN local_candidate::time >= time '08:00' AND local_candidate::time < time '21:00'
         THEN candidate ELSE ((local_candidate::date + CASE WHEN local_candidate::time >= time '21:00' THEN 1 ELSE 0 END + time '08:00') AT TIME ZONE timezone) END due FROM t`,
          [visit.finished_at, r.ctx.clinicId],
        )
      : await r.db.query(
          `WITH t AS (SELECT timezone,((COALESCE($1::timestamptz,now()) AT TIME ZONE timezone)::date+$2::int+$3::time) AS local_due FROM clinics WHERE id=$4) SELECT timezone,CASE WHEN local_due AT TIME ZONE timezone>now() THEN local_due AT TIME ZONE timezone ELSE (local_due+interval '1 day') AT TIME ZONE timezone END AS due FROM t`,
          [visit.finished_at, policy.delayDays, policy.sendTime, r.ctx.clinicId],
        )
  ).rows[0];
  return {
    state: 'ready' as const,
    patientId: patient.id,
    language: patient.language,
    assignedTo: owner.id,
    assignee: owner.name,
    scheduledAt: timing.due,
    timezone: timing.timezone,
    reminder: policy.reminder,
    consentedAt: consent.granted_at,
    deliveryEnabled: !!(await r.db.query('SELECT enabled FROM patient_feedback_settings')).rows[0]
      ?.enabled,
  };
}

/** Called inside the same transaction that finishes a visit; schedules only, never sends. */
export async function scheduleFinishedVisitFeedback(r: ToolRun, visitId: string) {
  const v = (await r.db.query('SELECT patient_id FROM queue_entries WHERE id=$1', [visitId]))
    .rows[0];
  if (!v) return { state: 'unavailable' as const };
  // Serializes against manual schedules and opt-out, which also lock the patient.
  await r.db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [v.patient_id]);
  const plan = await automaticFeedbackPlan(r, visitId);
  if (plan.state !== 'ready') return plan;
  const createdBy = r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : plan.assignedTo;
  const row = (
    await r.db.query(
      `INSERT INTO patient_checkins(clinic_id,patient_id,queue_entry_id,assigned_to,scheduled_at,language,created_by,reminder_enabled,consented_at,consent_notice) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'automatic-post-visit-existing-followup-consent-v1') ON CONFLICT(clinic_id,queue_entry_id) WHERE status='scheduled' DO NOTHING RETURNING id`,
      [
        r.ctx.clinicId,
        plan.patientId,
        visitId,
        plan.assignedTo,
        plan.scheduledAt,
        plan.language,
        createdBy,
        plan.reminder,
        plan.consentedAt,
      ],
    )
  ).rows[0];
  if (!row) return { state: 'existing' as const };
  await r.db.query(
    "INSERT INTO patient_feedback_events(clinic_id,checkin_id,actor_id,kind) VALUES($1,$2,$3,'automatically_scheduled')",
    [r.ctx.clinicId, row.id, createdBy],
  );
  return { ...plan, state: 'scheduled' as const, checkinId: row.id };
}
