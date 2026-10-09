import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';
import { fmtTime, getSettings, hasConsent, notifyPatient } from './common';

const STAFF = ['staff:doctor', 'staff:receptionist'];

export const scheduleFollowup = defineTool({
  name: 'schedule_followup',
  description: 'Queue a reminder, post-visit check-in or recall for a patient.',
  module: 'followups',
  input: z.object({
    patientId: z.string().uuid(),
    kind: z.enum(['reminder', 'post_visit', 'recall']),
    runAt: z.string().datetime(),
    appointmentId: z.string().uuid().optional(),
  }),
  allow: [
    ...STAFF,
    'agent:followup',
    'agent:leads',
    'agent:front_desk',
    'agent:schedule',
    'system',
  ],
  async run({ db, ctx }, i) {
    const r = await db.query(
      `INSERT INTO follow_ups (clinic_id,patient_id,appointment_id,kind,run_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (appointment_id, kind) WHERE appointment_id IS NOT NULL DO UPDATE SET run_at=EXCLUDED.run_at, status='pending' RETURNING id`,
      [ctx.clinicId, i.patientId, i.appointmentId ?? null, i.kind, i.runAt],
    );
    return { followUpId: r.rows[0].id as string };
  },
});

/**
 * Send one due follow-up. Requires BOTH messaging and follow-up consent. Without consent the item is
 * skipped (never sent). Called by the pg-boss worker for each due id, inside the clinic's own scope.
 */
export const runFollowup = defineTool({
  name: 'run_followup',
  description: 'Deliver a due follow-up message.',
  module: 'followups',
  input: z.object({ followUpId: z.string().uuid() }),
  allow: ['agent:followup', 'system'],
  async run(r, { followUpId }) {
    const { db, ctx } = r;
    const f = (
      await db.query("SELECT * FROM follow_ups WHERE id=$1 AND status='pending' FOR UPDATE", [
        followUpId,
      ])
    ).rows[0];
    if (!f) return { status: 'gone' };
    const p = (
      await db.query('SELECT id, name, phone, language FROM patients WHERE id=$1', [f.patient_id])
    ).rows[0];
    const s = await getSettings(db, ctx.clinicId);
    const skip = async (why: string) => {
      await db.query("UPDATE follow_ups SET status='skipped', detail=$2 WHERE id=$1", [f.id, why]);
      return { status: 'skipped', why };
    };
    if (!p) return skip('patient_missing');
    if (
      !(await hasConsent(db, p.id, 'reminders_followups')) ||
      !(await hasConsent(db, p.id, 'whatsapp_messaging'))
    )
      return skip('no_consent');
    let messaged = false;
    if (f.kind === 'reminder') {
      const a = (
        await db.query('SELECT starts_at, status FROM appointments WHERE id=$1', [f.appointment_id])
      ).rows[0];
      if (!a || !['booked', 'checked_in'].includes(a.status)) return skip('appointment_not_active');
      messaged = await notifyPatient(
        r,
        p,
        'msg.followup_reminder',
        { clinic: s.clinic_name, when: fmtTime(a.starts_at, s.timezone, p.language) },
        { sender: 'agent:followup' },
      );
    } else if (f.kind === 'review_request') {
      const q = (
        await db.query(
          'SELECT q.doctor_id, d.name AS doctor FROM queue_entries q JOIN doctors d ON d.id=q.doctor_id WHERE q.id=$1',
          [f.queue_entry_id],
        )
      ).rows[0];
      if (!q) return skip('visit_missing');
      if (
        (await db.query('SELECT 1 FROM visit_feedback WHERE queue_entry_id=$1', [f.queue_entry_id]))
          .rowCount
      )
        return skip('already_rated');
      messaged = await notifyPatient(
        r,
        p,
        'msg.review_ask',
        { name: p.name.split(' ')[0], doctor: q.doctor, clinic: s.clinic_name },
        { sender: 'agent:followup' },
      );
      if (messaged)
        await db.query('UPDATE conversations SET state=$2 WHERE clinic_id=$1 AND contact=$3', [
          ctx.clinicId,
          JSON.stringify({
            flow: 'review_rating',
            queueEntryId: f.queue_entry_id,
            doctorId: q.doctor_id,
          }),
          p.phone,
        ]);
    } else if (f.kind === 'post_visit') {
      messaged = await notifyPatient(
        r,
        p,
        'msg.followup_checkin',
        { name: p.name.split(' ')[0] },
        { sender: 'agent:followup' },
      );
      if (messaged)
        await db.query('UPDATE conversations SET state=$2 WHERE clinic_id=$1 AND contact=$3', [
          ctx.clinicId,
          JSON.stringify({ flow: 'followup_checkin' }),
          p.phone,
        ]);
    } else {
      const future = await db.query(
        "SELECT 1 FROM appointments WHERE patient_id=$1 AND status='booked' AND starts_at > now()",
        [p.id],
      );
      if (future.rowCount) return skip('has_upcoming_appointment');
      messaged = await notifyPatient(
        r,
        p,
        'msg.recall',
        { name: p.name.split(' ')[0], clinic: s.clinic_name },
        { sender: 'agent:leads' },
      );
    }
    if (!messaged) {
      await db.query("UPDATE follow_ups SET status='failed', detail='live_delivery_unavailable' WHERE id=$1", [f.id]);
      await db.query(
        "INSERT INTO flags(clinic_id,patient_id,kind,severity,summary) VALUES($1,$2,'system','normal',$3)",
        [ctx.clinicId, p.id, `A follow-up message for ${p.name} was not sent. Contact the patient another way.`],
      );
      return { status: 'failed', why: 'live_delivery_unavailable' };
    }
    await db.query("UPDATE follow_ups SET status='sent' WHERE id=$1", [f.id]);
    return { status: 'sent' };
  },
});

/** Create 'recall' follow-ups for consenting patients not seen for `recall_days` and without an upcoming visit. */
export const queueRecalls = defineTool({
  name: 'queue_recalls',
  description: 'Find patients due for a review and queue recall messages.',
  module: 'leads',
  input: z.object({}),
  allow: ['agent:leads', 'system'],
  async run({ db, ctx }) {
    const s = await getSettings(db, ctx.clinicId);
    const days = Number((s as any).followup_rules?.recall_days ?? 90);
    const r = await db.query(
      `INSERT INTO follow_ups (clinic_id,patient_id,kind,run_at)
       SELECT $1, p.id, 'recall', now() FROM patients p
        WHERE EXISTS (SELECT 1 FROM consents c WHERE c.patient_id=p.id AND c.purpose='reminders_followups' AND c.withdrawn_at IS NULL)
          AND EXISTS (SELECT 1 FROM consents c WHERE c.patient_id=p.id AND c.purpose='whatsapp_messaging' AND c.withdrawn_at IS NULL)
          AND (SELECT max(queue_date) FROM queue_entries q WHERE q.patient_id=p.id AND q.status='done') < (now()::date - $2::int)
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id=p.id AND a.status='booked' AND a.starts_at > now())
          AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.patient_id=p.id AND f.kind='recall' AND f.created_at > now() - interval '30 days')
       RETURNING id`,
      [ctx.clinicId, days],
    );
    return { queued: r.rowCount ?? 0 };
  },
});

/** Called when a visit finishes or an appointment is booked: set up the doctor-configured follow-ups. */
export async function planFollowups(
  r: ToolRun,
  kind: 'booked' | 'finished',
  patientId: string,
  appt?: { id: string; startsAt: Date },
  queueEntryId?: string,
) {
  const { db, ctx } = r;
  if (!(await hasConsent(db, patientId, 'reminders_followups'))) return;
  const s = (await getSettings(db, ctx.clinicId)) as any;
  const rules = s.followup_rules ?? {};
  if (kind === 'booked' && appt) {
    const when = new Date(
      appt.startsAt.getTime() - (rules.reminder_hours_before ?? 24) * 3_600_000,
    );
    await db.query(
      `INSERT INTO follow_ups (clinic_id,patient_id,appointment_id,kind,run_at) VALUES ($1,$2,$3,'reminder',GREATEST($4::timestamptz, now()))
       ON CONFLICT (appointment_id, kind) WHERE appointment_id IS NOT NULL DO UPDATE SET run_at=EXCLUDED.run_at, status='pending'`,
      [ctx.clinicId, patientId, appt.id, when],
    );
  }
  if (kind === 'finished') {
    await db.query(
      "INSERT INTO follow_ups (clinic_id,patient_id,kind,run_at) VALUES ($1,$2,'post_visit', now() + make_interval(hours => $3))",
      [ctx.clinicId, patientId, rules.post_visit_hours ?? 24],
    );
    // Ask for private feedback a few hours after the visit, at most once every 60 days per patient.
    const rep = s.reputation ?? {};
    if (rep.enabled && queueEntryId) {
      const recent = await db.query(
        "SELECT 1 FROM follow_ups WHERE patient_id=$1 AND kind='review_request' AND created_at > now() - interval '60 days'",
        [patientId],
      );
      if (!recent.rowCount)
        await db.query(
          "INSERT INTO follow_ups (clinic_id,patient_id,kind,run_at,queue_entry_id) VALUES ($1,$2,'review_request', now() + make_interval(hours => $3), $4)",
          [ctx.clinicId, patientId, rep.delay_hours ?? 3, queueEntryId],
        );
    }
  }
}
export const enableReminders = defineTool({
  name: 'enable_reminders',
  description:
    'The patient said YES to WhatsApp reminders: record the two consents (messaging and reminders) and schedule the reminder for this appointment.',
  module: 'followups',
  input: z.object({ appointmentId: z.string().uuid() }),
  allow: ['agent:front_desk', 'agent:leads'],
  async run(r, { appointmentId }) {
    const { db, ctx } = r;
    const a = (
      await db.query('SELECT patient_id, starts_at FROM appointments WHERE id=$1', [appointmentId])
    ).rows[0];
    if (!a || a.patient_id !== ctx.patientId)
      throw new ToolError('not_found', 'Appointment not found for this patient', 404);
    for (const purpose of ['whatsapp_messaging', 'reminders_followups']) {
      await db.query(
        `INSERT INTO consents (clinic_id,patient_id,purpose,notice_version) SELECT $1,$2,$3,'v1'
          WHERE NOT EXISTS (SELECT 1 FROM consents WHERE patient_id=$2 AND purpose=$3 AND withdrawn_at IS NULL)`,
        [ctx.clinicId, a.patient_id, purpose],
      );
    }
    await planFollowups(r, 'booked', a.patient_id, { id: appointmentId, startsAt: a.starts_at });
    return { ok: true };
  },
});

export const recordFeedback = defineTool({
  name: 'record_feedback',
  description:
    "Store the patient's 1-5 rating of a visit. Low ratings alert the receptionist for a personal follow-up.",
  module: 'followups',
  input: z.object({
    rating: z.number().int().min(1).max(5),
    queueEntryId: z.string().uuid().optional(),
    doctorId: z.string().uuid().optional(),
  }),
  allow: ['agent:followup', 'system'],
  async run(r, i) {
    const { db, ctx } = r;
    if (!ctx.patientId) throw new ToolError('no_patient', 'No patient in this conversation');
    const f = await db.query(
      'INSERT INTO visit_feedback (clinic_id,patient_id,doctor_id,queue_entry_id,rating) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [ctx.clinicId, ctx.patientId, i.doctorId ?? null, i.queueEntryId ?? null, i.rating],
    );
    if (i.rating <= 3) {
      const p = (await db.query('SELECT name FROM patients WHERE id=$1', [ctx.patientId])).rows[0];
      const fl = await db.query(
        "INSERT INTO flags (clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,'other','normal',$4) RETURNING id",
        [
          ctx.clinicId,
          ctx.conversationId ?? null,
          ctx.patientId,
          `Low rating (${i.rating}/5) from ${p.name} after their visit. Please reach out personally.`,
        ],
      );
      r.emit({ type: 'flag_raised', flagId: fl.rows[0].id, severity: 'normal' });
    }
    return { feedbackId: f.rows[0].id as string };
  },
});

export const addFeedbackComment = defineTool({
  name: 'add_feedback_comment',
  description:
    "Attach the patient's comment to their latest rating and show it to the receptionist.",
  module: 'followups',
  input: z.object({ comment: z.string().trim().min(1).max(500) }),
  allow: ['agent:followup', 'system'],
  auditInput: (i) => ({ chars: i.comment.length }),
  async run(r, { comment }) {
    const { db, ctx } = r;
    if (!ctx.patientId) throw new ToolError('no_patient', 'No patient in this conversation');
    await db.query(
      'UPDATE visit_feedback SET comment=$2 WHERE id = (SELECT id FROM visit_feedback WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1)',
      [ctx.patientId, comment],
    );
    const fl = await db.query(
      "INSERT INTO flags (clinic_id,conversation_id,patient_id,kind,severity,summary) VALUES ($1,$2,$3,'other','normal',$4) RETURNING id",
      [
        ctx.clinicId,
        ctx.conversationId ?? null,
        ctx.patientId,
        `Feedback comment: "${comment.slice(0, 300)}"`,
      ],
    );
    r.emit({ type: 'flag_raised', flagId: fl.rows[0].id, severity: 'normal' });
    return { ok: true };
  },
});

export const followupTools = [
  recordFeedback,
  addFeedbackComment,
  scheduleFollowup,
  runFollowup,
  queueRecalls,
  enableReminders,
];
