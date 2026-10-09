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
    if (f.evening_number && new Date(f.run_at).getTime() < Date.now() - 3 * 3_600_000) {
      await db.query(
        "UPDATE follow_ups SET status='skipped',detail='evening_window_passed' WHERE id=$1",
        [f.id],
      );
      return { status: 'skipped', why: 'evening_window_passed' };
    }
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
      if (f.evening_number && !(await hasConsent(db, p.id, 'evening_checkins')))
        return skip('evening_permission_withdrawn');
      messaged = await notifyPatient(
        r,
        p,
        f.evening_number ? 'msg.evening_checkin' : 'msg.followup_checkin',
        { name: p.name.split(' ')[0], night: f.evening_number },
        { sender: 'agent:followup' },
      );
      if (messaged)
        await db.query('UPDATE conversations SET state=$2 WHERE clinic_id=$1 AND contact=$3', [
          ctx.clinicId,
          JSON.stringify({
            flow: 'followup_checkin',
            followUpId: f.id,
            eveningNumber: f.evening_number,
          }),
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
      await db.query(
        "UPDATE follow_ups SET status='failed', detail='live_delivery_unavailable' WHERE id=$1",
        [f.id],
      );
      await db.query(
        "INSERT INTO flags(clinic_id,patient_id,kind,severity,summary) VALUES($1,$2,'system','normal',$3)",
        [
          ctx.clinicId,
          p.id,
          `A follow-up message for ${p.name} was not sent. Contact the patient another way.`,
        ],
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
    const evening = queueEntryId
      ? (
          await db.query(
            `SELECT p.evening_enabled,p.evening_nights,p.evening_time FROM queue_entries q
           JOIN doctor_feedback_preferences p ON p.doctor_id=q.doctor_id WHERE q.id=$1`,
            [queueEntryId],
          )
        ).rows[0]
      : null;
    if (
      evening?.evening_enabled &&
      (await hasConsent(db, patientId, 'evening_checkins')) &&
      (await hasConsent(db, patientId, 'whatsapp_messaging'))
    ) {
      const due = (
        await db.query(
          `WITH clock AS (SELECT timezone,
           ((now() AT TIME ZONE timezone)::date + $1::time) AT TIME ZONE timezone AS today_due
           FROM clinics WHERE id=$2)
         SELECT ((now() AT TIME ZONE timezone)::date +
           CASE WHEN today_due > now() + interval '30 minutes' THEN 0 ELSE 1 END) AS local_day,
           timezone FROM clock`,
          [evening.evening_time, ctx.clinicId],
        )
      ).rows[0];
      for (let number = 1; number <= evening.evening_nights; number++) {
        await db.query(
          `INSERT INTO follow_ups(clinic_id,patient_id,queue_entry_id,kind,run_at,evening_number)
           VALUES($1,$2,$3,'post_visit',(($4::date + ($5::int - 1)) + $6::time) AT TIME ZONE $7,$5)
           ON CONFLICT DO NOTHING`,
          [
            ctx.clinicId,
            patientId,
            queueEntryId,
            due.local_day,
            number,
            evening.evening_time,
            due.timezone,
          ],
        );
      }
    } else {
      await db.query(
        "INSERT INTO follow_ups (clinic_id,patient_id,kind,run_at) VALUES ($1,$2,'post_visit', now() + make_interval(hours => $3))",
        [ctx.clinicId, patientId, rules.post_visit_hours ?? 24],
      );
    }
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

export const recordEveningReply = defineTool({
  name: 'record_evening_reply',
  description: 'Save a patient reply to an evening check-in for the clinic team.',
  module: 'followups',
  input: z.object({
    followUpId: z.string().uuid(),
    feeling: z.enum(['better', 'same', 'worse', 'help']),
    message: z.string().trim().min(1).max(1000),
  }),
  allow: ['agent:followup'],
  auditInput: (i) => ({ followUpId: i.followUpId, feeling: i.feeling }),
  auditOutput: () => ({ saved: true }),
  async run({ db, ctx }, i) {
    if (!ctx.patientId) throw new ToolError('no_patient', 'Patient identification is required');
    const followup = (
      await db.query(
        "SELECT id FROM follow_ups WHERE id=$1 AND patient_id=$2 AND kind='post_visit' AND evening_number IS NOT NULL AND status='sent'",
        [i.followUpId, ctx.patientId],
      )
    ).rows[0];
    if (!followup) throw new ToolError('not_found', 'Evening check-in was not sent', 404);
    await db.query(
      `INSERT INTO evening_checkin_replies(clinic_id,patient_id,follow_up_id,feeling,message)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(follow_up_id) DO NOTHING`,
      [ctx.clinicId, ctx.patientId, i.followUpId, i.feeling, i.message],
    );
    if (i.feeling === 'worse' || i.feeling === 'help')
      await db.query(
        `UPDATE follow_ups SET status='skipped',detail='patient_needs_personal_review'
         WHERE patient_id=$1 AND kind='post_visit' AND evening_number IS NOT NULL AND status='pending'
           AND queue_entry_id=(SELECT queue_entry_id FROM follow_ups WHERE id=$2)`,
        [ctx.patientId, i.followUpId],
      );
    return { saved: true };
  },
});

export const eveningPermission = defineTool({
  name: 'set_evening_checkin_permission',
  description:
    'Record or withdraw the patient’s explicit permission for up to three evening messages after each visit.',
  module: 'followups',
  input: z.object({ enabled: z.boolean() }),
  allow: ['agent:followup'],
  auditInput: (i) => ({ enabled: i.enabled }),
  async run({ db, ctx }, i) {
    if (!ctx.patientId) throw new ToolError('no_patient', 'Patient identification is required');
    await db.query('SELECT id FROM patients WHERE id=$1 FOR UPDATE', [ctx.patientId]);
    if (i.enabled) {
      if (
        !(await hasConsent(db, ctx.patientId, 'whatsapp_messaging')) ||
        !(await hasConsent(db, ctx.patientId, 'reminders_followups'))
      )
        return { enabled: false, needsPermission: true };
      await db.query(
        `INSERT INTO consents(clinic_id,patient_id,purpose,notice_version)
         SELECT $1,$2,'evening_checkins','evening-v1' WHERE NOT EXISTS
         (SELECT 1 FROM consents WHERE patient_id=$2 AND purpose='evening_checkins' AND withdrawn_at IS NULL)`,
        [ctx.clinicId, ctx.patientId],
      );
    } else {
      await db.query(
        "UPDATE consents SET withdrawn_at=now() WHERE patient_id=$1 AND purpose='evening_checkins' AND withdrawn_at IS NULL",
        [ctx.patientId],
      );
      await db.query(
        "UPDATE follow_ups SET status='skipped',detail='evening_permission_withdrawn' WHERE patient_id=$1 AND evening_number IS NOT NULL AND status='pending'",
        [ctx.patientId],
      );
    }
    return { enabled: i.enabled };
  },
});

export const listEveningCheckins = defineTool({
  name: 'list_evening_checkins',
  description: 'See scheduled evening messages, delivery state and patient replies.',
  module: 'followups',
  input: z.object({}),
  allow: ['staff:admin', 'staff:doctor', 'staff:receptionist'],
  auditOutput: () => ({ opened: true }),
  async run({ db, ctx }) {
    const doctorId =
      ctx.actor.kind === 'staff' && ctx.actor.role === 'doctor' && !ctx.actor.clinicAdmin
        ? ctx.actor.doctorId
        : null;
    return {
      updates: (
        await db.query(
          `SELECT f.id,f.run_at,f.status,f.detail,f.evening_number,f.queue_entry_id,p.name patient_name,
        r.feeling,r.message,r.created_at replied_at,d.state delivery_state,d.delivered_at,d.read_at,
        d.detail delivery_detail
       FROM follow_ups f JOIN patients p ON p.id=f.patient_id
       JOIN queue_entries q ON q.id=f.queue_entry_id
       LEFT JOIN evening_checkin_replies r ON r.follow_up_id=f.id
       LEFT JOIN patient_evening_delivery d ON d.follow_up_id=f.id
       WHERE f.evening_number IS NOT NULL AND ($1::uuid IS NULL OR q.doctor_id=$1)
       ORDER BY f.run_at DESC LIMIT 100`,
          [doctorId ?? null],
        )
      ).rows,
    };
  },
});

export const followupTools = [
  recordFeedback,
  addFeedbackComment,
  scheduleFollowup,
  runFollowup,
  queueRecalls,
  enableReminders,
  recordEveningReply,
  eveningPermission,
  listEveningCheckins,
];
