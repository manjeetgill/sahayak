import { z } from 'zod';
import { defineTool, type ToolRun } from './registry';
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
    if (f.kind === 'reminder') {
      const a = (
        await db.query('SELECT starts_at, status FROM appointments WHERE id=$1', [f.appointment_id])
      ).rows[0];
      if (!a || !['booked', 'checked_in'].includes(a.status)) return skip('appointment_not_active');
      await notifyPatient(
        r,
        p,
        'msg.followup_reminder',
        { clinic: s.clinic_name, when: fmtTime(a.starts_at, s.timezone, p.language) },
        { sender: 'agent:followup' },
      );
    } else if (f.kind === 'post_visit') {
      await notifyPatient(
        r,
        p,
        'msg.followup_checkin',
        { name: p.name.split(' ')[0] },
        { sender: 'agent:followup' },
      );
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
      await notifyPatient(
        r,
        p,
        'msg.recall',
        { name: p.name.split(' ')[0], clinic: s.clinic_name },
        { sender: 'agent:leads' },
      );
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
  }
}
export const followupTools = [scheduleFollowup, runFollowup, queueRecalls];
