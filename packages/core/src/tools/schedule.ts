import { z } from 'zod';
import type { Lang } from '@sahayak/shared';
import { defineTool, ToolError, type ToolRun } from './registry';
import { emitWebhook } from '../webhooks';
import { fmtTime, getSettings, hasConsent, notifyPatient } from './common';
import { nextFreeSlots } from './appointments';

const DOCTOR = ['staff:doctor'];
const doctorFor = (r: ToolRun, given?: string) => {
  const a = r.ctx.actor;
  const d = a.kind === 'staff' && a.role === 'doctor' && a.doctorId ? a.doctorId : given;
  if (!d) throw new ToolError('doctor_required', 'doctorId is required');
  return d;
};

/** End of the clinic opening window that contains `at` (null if the clinic is closed then). A shift past it needs a new slot. */
async function windowEnd(r: ToolRun, at: Date): Promise<Date | null> {
  const s = await getSettings(r.db, r.ctx.clinicId);
  const q = await r.db.query(
    "SELECT lower(to_char($1::timestamptz AT TIME ZONE $2,'dy')) AS dow, to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM-DD') AS d",
    [at, s.timezone],
  );
  for (const w of (s.timings[q.rows[0].dow] ?? '').split(',').map((x) => x.trim())) {
    const m = w.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!m) continue;
    const t = (
      await r.db.query(
        'SELECT (($1::date + $2::time) AT TIME ZONE $4) AS ws, (($1::date + $3::time) AT TIME ZONE $4) AS we',
        [q.rows[0].d, m[1], m[2], s.timezone],
      )
    ).rows[0];
    if (at >= t.ws && at < t.we) return t.we as Date;
  }
  return null;
}

export const proposeScheduleShift = defineTool({
  name: 'propose_schedule_shift',
  description:
    'Work out the impact of the doctor running late. Creates a PENDING proposal; nothing is sent to anyone until the doctor confirms.',
  module: 'appointments',
  input: z.object({
    doctorId: z.string().uuid().optional(),
    minutes: z.number().int().min(5).max(240),
    requestedText: z.string().max(300).optional(),
  }),
  allow: [...DOCTOR, 'agent:schedule'],
  async run(r, i) {
    const { db, ctx } = r;
    const doctorId = doctorFor(r, i.doctorId);
    const tz = (await getSettings(db, ctx.clinicId)).timezone;
    // From now: appointments later today that have not been completed.
    const appts = (
      await db.query(
        `SELECT a.id, a.patient_id, a.starts_at, p.name FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
        WHERE a.doctor_id=$1 AND a.status IN ('booked','checked_in') AND a.ends_at > now()
          AND (a.starts_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date ORDER BY a.starts_at`,
        [doctorId, tz],
      )
    ).rows;
    await db.query(
      "UPDATE schedule_proposals SET status='cancelled' WHERE doctor_id=$1 AND status='pending'",
      [doctorId],
    );
    const created = (
      await db.query(
        'INSERT INTO schedule_proposals (clinic_id,doctor_id,minutes,requested_text,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [
          ctx.clinicId,
          doctorId,
          i.minutes,
          i.requestedText ?? null,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      )
    ).rows[0].id as string;
    const slotMinutes = (await db.query('SELECT slot_minutes FROM doctors WHERE id=$1', [doctorId]))
      .rows[0].slot_minutes as number;
    let needsRebooking = 0;
    for (const a of appts) {
      const newStart = new Date(new Date(a.starts_at).getTime() + i.minutes * 60_000);
      const end = await windowEnd(r, new Date(a.starts_at));
      const beyond = !end || newStart.getTime() + slotMinutes * 60_000 > end.getTime();
      if (beyond) needsRebooking++;
      await db.query(
        'INSERT INTO schedule_shift_items (clinic_id,proposal_id,appointment_id,patient_id,old_start,new_start,needs_rebooking) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [ctx.clinicId, created, a.id, a.patient_id, a.starts_at, newStart, beyond],
      );
    }
    r.emit({ type: 'schedule_proposal', proposalId: created });
    return {
      proposalId: created,
      minutes: i.minutes,
      affected: appts.length,
      needsRebooking,
      patients: appts.slice(0, 50).map((a) => a.name ?? 'Walk-in'),
    };
  },
});

export const confirmScheduleShift = defineTool({
  name: 'confirm_schedule_shift',
  description:
    'Doctor confirms the late-running proposal: moves appointments and notifies every affected patient. Doctor only.',
  module: 'appointments',
  input: z.object({ proposalId: z.string().uuid() }),
  allow: DOCTOR, // agents can never confirm on the doctor's behalf
  async run(r, { proposalId }) {
    const { db, ctx } = r;
    const p = (
      await db.query(
        "SELECT * FROM schedule_proposals WHERE id=$1 AND status='pending' FOR UPDATE",
        [proposalId],
      )
    ).rows[0];
    if (!p) throw new ToolError('not_found', 'Proposal not found or already handled', 404);
    const a = ctx.actor;
    if (a.kind === 'staff' && a.doctorId && a.doctorId !== p.doctor_id)
      throw new ToolError('forbidden', 'Not your schedule', 403);
    const doc = (await db.query('SELECT name FROM doctors WHERE id=$1', [p.doctor_id])).rows[0]
      .name as string;
    const s = await getSettings(db, ctx.clinicId);
    const items = (
      await db.query(
        `SELECT i.*, pt.name, pt.phone, pt.language FROM schedule_shift_items i JOIN appointments ap ON ap.id=i.appointment_id LEFT JOIN patients pt ON pt.id=i.patient_id
        WHERE i.proposal_id=$1 ORDER BY i.old_start DESC`,
        [proposalId],
      )
    ).rows; // latest first so shifted slots never collide
    let notified = 0,
      notMessaged = 0,
      noConsent = 0;
    for (const it of items) {
      if (it.needs_rebooking)
        await db.query("UPDATE appointments SET status='needs_rebooking' WHERE id=$1", [
          it.appointment_id,
        ]);
      else
        await db.query(
          'UPDATE appointments SET starts_at=$2, ends_at=ends_at + make_interval(mins => $3) WHERE id=$1',
          [it.appointment_id, it.new_start, p.minutes],
        );
      if (!it.patient_id) continue;
      const patient = {
        id: it.patient_id as string,
        phone: it.phone as string,
        language: it.language as Lang,
      };
      let sent = false;
      if (it.needs_rebooking) {
        const options = await nextFreeSlots(db, ctx.clinicId, p.doctor_id, 3);
        sent = await notifyPatient(
          r,
          patient,
          'msg.rebook_needed',
          {
            options: options
              .map((o, n) => `${n + 1}) ${fmtTime(o, s.timezone, patient.language)}`)
              .join('; '),
          },
          { sender: 'agent:schedule' },
        );
        if (sent)
          await db.query('UPDATE conversations SET state=$2 WHERE clinic_id=$1 AND contact=$3', [
            ctx.clinicId,
            JSON.stringify({
              flow: 'pick_slot',
              doctorId: p.doctor_id,
              doctorName: doc,
              slots: options,
              rescheduleId: it.appointment_id,
            }),
            patient.phone,
          ]);
      } else {
        sent = await notifyPatient(
          r,
          patient,
          'msg.late_notice',
          {
            doctor: doc,
            minutes: p.minutes,
            when: fmtTime(it.new_start, s.timezone, patient.language),
          },
          { sender: 'agent:schedule' },
        );
        if (sent)
          await db.query('UPDATE conversations SET state=$2 WHERE clinic_id=$1 AND contact=$3', [
            ctx.clinicId,
            JSON.stringify({
              flow: 'late_notice',
              appointmentId: it.appointment_id,
              itemId: it.id,
              doctorId: p.doctor_id,
              doctorName: doc,
              newStart: it.new_start,
            }),
            patient.phone,
          ]);
      }
      await db.query('UPDATE schedule_shift_items SET notified=$2, response=$3 WHERE id=$1', [
        it.id,
        sent,
        sent ? 'pending' : 'no_consent',
      ]);
      if (sent) notified++;
      else {
        notMessaged++;
        if (!(await hasConsent(db, patient.id, 'whatsapp_messaging'))) noConsent++;
      }
    }
    await db.query(
      "UPDATE schedule_proposals SET status='confirmed', confirmed_at=now() WHERE id=$1",
      [proposalId],
    );
    if (notMessaged) {
      const f = await db.query(
        "INSERT INTO flags (clinic_id,kind,severity,summary) VALUES ($1,'system','normal',$2) RETURNING id",
        [
          ctx.clinicId,
          `${doc} running ${p.minutes} min late: ${notMessaged} patient(s) could not be messaged (consent or live delivery unavailable). Please contact them.`,
        ],
      );
      r.emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: 'normal' });
    }
    r.emit({ type: 'queue_changed', doctorId: p.doctor_id });
    r.emit({ type: 'schedule_proposal', proposalId });
    await emitWebhook(db, ctx.clinicId, 'schedule.shifted', {
      proposalId,
      doctorId: p.doctor_id,
      minutes: p.minutes,
      moved: items.length,
      notified,
    });
    return { ok: true, moved: items.length, notified, noConsent, notMessaged };
  },
});

export const cancelScheduleShift = defineTool({
  name: 'cancel_schedule_shift',
  description: 'Discard a pending late-running proposal.',
  module: 'appointments',
  input: z.object({ proposalId: z.string().uuid() }),
  allow: DOCTOR,
  async run({ db, emit }, { proposalId }) {
    const u = await db.query(
      "UPDATE schedule_proposals SET status='cancelled' WHERE id=$1 AND status='pending' RETURNING id",
      [proposalId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'No pending proposal', 404);
    emit({ type: 'schedule_proposal', proposalId });
    return { ok: true };
  },
});

export const recordLateResponse = defineTool({
  name: 'record_late_response',
  description: "Record a patient's reply to a running-late notice.",
  module: 'appointments',
  input: z.object({ itemId: z.string().uuid(), response: z.enum(['kept', 'rebooking']) }),
  allow: ['agent:schedule'],
  async run({ db, ctx, emit }, i) {
    const u = await db.query(
      'UPDATE schedule_shift_items SET response=$2 WHERE id=$1 AND patient_id=$3 RETURNING proposal_id',
      [i.itemId, i.response, ctx.patientId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Notice not found for this patient', 404);
    emit({ type: 'schedule_proposal', proposalId: u.rows[0].proposal_id });
    return { ok: true };
  },
});

export const getShiftSummary = defineTool({
  name: 'get_shift_summary',
  description: 'Live summary of a running-late proposal for the doctor.',
  module: 'appointments',
  input: z.object({
    proposalId: z.string().uuid().optional(),
    doctorId: z.string().uuid().optional(),
  }),
  allow: [...DOCTOR, 'staff:receptionist'],
  async run(r, i) {
    const { db } = r;
    const doctorId = i.doctorId ?? (r.ctx.actor.kind === 'staff' ? r.ctx.actor.doctorId : null);
    const p = (
      await db.query(
        `SELECT * FROM schedule_proposals WHERE ($1::uuid IS NOT NULL AND id=$1) OR ($1::uuid IS NULL AND doctor_id=$2 AND status IN ('pending','confirmed')
        AND created_at > now() - interval '12 hours') ORDER BY created_at DESC LIMIT 1`,
        [i.proposalId ?? null, doctorId ?? null],
      )
    ).rows[0];
    if (!p) return { proposal: null };
    const items = (
      await db.query(
        `SELECT i.id, i.notified, i.response, i.needs_rebooking, i.new_start, ap.starts_at AS current_start, ap.status AS appt_status, pt.name
         FROM schedule_shift_items i JOIN appointments ap ON ap.id=i.appointment_id LEFT JOIN patients pt ON pt.id=i.patient_id WHERE i.proposal_id=$1 ORDER BY i.old_start`,
        [p.id],
      )
    ).rows;
    const rebooked = (x: any) =>
      x.response === 'rebooking' &&
      new Date(x.current_start).getTime() !== new Date(x.new_start).getTime() &&
      x.appt_status === 'booked';
    return {
      proposal: { id: p.id, status: p.status, minutes: p.minutes },
      counts: {
        affected: items.length,
        notified: items.filter((x) => x.notified).length,
        keptNewTime: items.filter((x) => x.response === 'kept').length,
        rebooked: items.filter(rebooked).length,
        waitingForReply: items.filter(
          (x) =>
            x.notified &&
            (x.response === 'pending' || (x.response === 'rebooking' && !rebooked(x))),
        ).length,
        needsCall: items.filter((x) => x.response === 'no_consent').length,
        needsRebooking: items.filter(
          (x) => x.needs_rebooking && x.appt_status === 'needs_rebooking',
        ).length,
      },
      patients: items.map((x) => ({
        name: x.name ?? 'Walk-in',
        response: rebooked(x) ? 'rebooked' : x.response,
        notified: x.notified,
      })),
    };
  },
});

export const scheduleTools = [
  proposeScheduleShift,
  confirmScheduleShift,
  cancelScheduleShift,
  recordLateResponse,
  getShiftSummary,
];
