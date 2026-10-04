import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';
import { clinicToday, getSettings, notifyPatient, queueSnapshot } from './common';
import { planFollowups } from './followups';

const STAFF = ['staff:doctor', 'staff:receptionist'];
const id = z.object({ queueEntryId: z.string().uuid() });

async function lockDay(r: ToolRun) {
  const { date } = await clinicToday(r.db, r.ctx.clinicId);
  await r.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${r.ctx.clinicId}:${date}`]);
  return date;
}
function doctorFor(r: ToolRun, given?: string): string {
  const a = r.ctx.actor;
  const d = a.kind === 'staff' && a.role === 'doctor' && a.doctorId ? a.doctorId : given;
  if (!d) throw new ToolError('doctor_required', 'doctorId is required');
  return d;
}

export const callNextPatient = defineTool({
  name: 'call_next_patient',
  description:
    'Finish the patient currently in the room and call the next waiting patient (WhatsApp + TV).',
  module: 'queue',
  input: z.object({ doctorId: z.string().uuid().optional() }),
  allow: [...STAFF, 'agent:queue'],
  async run(r, input) {
    const { db } = r;
    const date = await lockDay(r);
    const doctorId = doctorFor(r, input.doctorId);
    const finished = await db.query(
      `UPDATE queue_entries SET status='done', finished_at=now() WHERE doctor_id=$1 AND queue_date=$2 AND status IN ('called','in_consultation') RETURNING patient_id`,
      [doctorId, date],
    );
    for (const f of finished.rows) await planFollowups(r, 'finished', f.patient_id);
    const next = await db.query(
      `SELECT q.id,q.token_number,q.patient_id,p.name,p.phone,p.language,p.year_of_birth FROM queue_entries q JOIN patients p ON p.id=q.patient_id
        WHERE q.doctor_id=$1 AND q.queue_date=$2 AND q.status='waiting' ORDER BY q.position_key LIMIT 2`,
      [doctorId, date],
    );
    r.emit({ type: 'queue_changed', doctorId });
    if (!next.rowCount) return { patient: null };
    const cur = next.rows[0];
    await db.query("UPDATE queue_entries SET status='called', called_at=now() WHERE id=$1", [
      cur.id,
    ]);
    const doc = (await db.query('SELECT name FROM doctors WHERE id=$1', [doctorId])).rows[0].name;
    await notifyPatient(
      r,
      { id: cur.patient_id, phone: cur.phone, language: cur.language },
      'msg.your_turn',
      { name: cur.name, doctor: doc, token: cur.token_number },
      { sender: 'agent:queue' },
    );
    const after = next.rows[1];
    if (after)
      await notifyPatient(
        r,
        { id: after.patient_id, phone: after.phone, language: after.language },
        'msg.next_soon',
        { name: after.name },
        { sender: 'agent:queue' },
      );
    const card = await db.query(
      `SELECT i.summary, i.answers, a.reason FROM queue_entries q
         LEFT JOIN intake_summaries i ON i.queue_entry_id=q.id LEFT JOIN appointments a ON a.id=q.appointment_id WHERE q.id=$1`,
      [cur.id],
    );
    return {
      patient: {
        queueEntryId: cur.id,
        patientId: cur.patient_id,
        name: cur.name,
        token: cur.token_number,
        age: cur.year_of_birth ? new Date().getFullYear() - cur.year_of_birth : null,
        language: cur.language,
        reason: card.rows[0]?.reason ?? null,
        intakeSummary: card.rows[0]?.summary ?? null,
      },
    };
  },
});

export const finishVisit = defineTool({
  name: 'finish_visit',
  description: 'Mark the visit finished.',
  module: 'queue',
  input: id,
  allow: STAFF,
  async run(r, { queueEntryId }) {
    const u = await r.db.query(
      "UPDATE queue_entries SET status='done', finished_at=now() WHERE id=$1 AND status IN ('called','in_consultation') RETURNING doctor_id, patient_id",
      [queueEntryId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'No active visit with that id', 404);
    await planFollowups(r, 'finished', u.rows[0].patient_id);
    r.emit({ type: 'queue_changed', doctorId: u.rows[0].doctor_id });
    return { ok: true };
  },
});

export const skipPatient = defineTool({
  name: 'skip_patient',
  description: 'Skip a patient (not present). Staff only; patients cannot request reordering.',
  module: 'queue',
  input: id,
  allow: STAFF,
  async run(r, { queueEntryId }) {
    const u = await r.db.query(
      "UPDATE queue_entries SET status='skipped' WHERE id=$1 AND status IN ('waiting','called') RETURNING doctor_id",
      [queueEntryId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Cannot skip that entry', 404);
    r.emit({ type: 'queue_changed', doctorId: u.rows[0].doctor_id });
    return { ok: true };
  },
});

export const holdPatient = defineTool({
  name: 'hold_patient',
  description: 'Put a patient on hold (keeps their place for later).',
  module: 'queue',
  input: id,
  allow: STAFF,
  async run(r, { queueEntryId }) {
    const u = await r.db.query(
      "UPDATE queue_entries SET status='on_hold' WHERE id=$1 AND status IN ('waiting','called') RETURNING doctor_id",
      [queueEntryId],
    );
    if (!u.rowCount) throw new ToolError('not_found', 'Cannot hold that entry', 404);
    r.emit({ type: 'queue_changed', doctorId: u.rows[0].doctor_id });
    return { ok: true };
  },
});

export const resumePatient = defineTool({
  name: 'resume_patient',
  description:
    'Bring a held patient back at their old place, or a skipped patient to the back of the queue.',
  module: 'queue',
  input: id,
  allow: STAFF,
  async run(r, { queueEntryId }) {
    await lockDay(r);
    const cur = await r.db.query('SELECT status, queue_date FROM queue_entries WHERE id=$1', [
      queueEntryId,
    ]);
    if (!cur.rowCount || !['on_hold', 'skipped', 'no_show'].includes(cur.rows[0].status))
      throw new ToolError('not_found', 'Cannot resume that entry', 404);
    if (cur.rows[0].status === 'on_hold') {
      await r.db.query("UPDATE queue_entries SET status='waiting' WHERE id=$1", [queueEntryId]);
    } else {
      await r.db.query(
        `UPDATE queue_entries SET status='waiting', position_key=(SELECT COALESCE(MAX(position_key),0)+1000 FROM queue_entries WHERE clinic_id=$2 AND queue_date=$3) WHERE id=$1`,
        [queueEntryId, r.ctx.clinicId, cur.rows[0].queue_date],
      );
    }
    const d = await r.db.query('SELECT doctor_id FROM queue_entries WHERE id=$1', [queueEntryId]);
    r.emit({ type: 'queue_changed', doctorId: d.rows[0].doctor_id });
    return { ok: true };
  },
});

export const markNoShow = defineTool({
  name: 'mark_no_show',
  description: 'Mark a called patient as a no-show.',
  module: 'queue',
  input: id,
  allow: [...STAFF, 'agent:queue'],
  async run(r, { queueEntryId }) {
    const u = await r.db.query(
      "UPDATE queue_entries SET status='no_show' WHERE id=$1 AND status='called' RETURNING doctor_id",
      [queueEntryId],
    );
    if (!u.rowCount)
      throw new ToolError('not_found', 'Only a called patient can be marked no-show', 404);
    r.emit({ type: 'queue_changed', doctorId: u.rows[0].doctor_id });
    return { ok: true };
  },
});

export const getMyQueueStatus = defineTool({
  name: 'get_my_queue_status',
  description:
    "Get this patient's own token, status, number of patients ahead and estimated wait. Never returns other patients' data.",
  module: 'queue',
  input: z.object({ patientId: z.string().uuid() }),
  allow: [
    'agent:queue',
    'agent:front_desk',
    'agent:checkin',
    'agent:intake',
    'staff:receptionist',
    'patient',
  ],
  async run({ db, ctx }, { patientId }) {
    const snap = await queueSnapshot(db, ctx.clinicId);
    const mine = snap.find(
      (e) =>
        e.patient_id === patientId &&
        ['waiting', 'called', 'on_hold', 'in_consultation'].includes(e.status),
    );
    if (!mine) return { inQueue: false };
    const ahead = snap.filter(
      (e) =>
        e.doctor_id === mine.doctor_id &&
        e.status === 'waiting' &&
        Number(e.position_key) < Number(mine.position_key),
    ).length;
    const s = await getSettings(db, ctx.clinicId);
    return {
      inQueue: true,
      token: mine.token_number,
      status: mine.status,
      patientsAhead: ahead,
      waitMinutes: mine.wait_minutes,
      avgConsultMinutes: s.avg_consult_minutes,
    };
  },
});

export const startConsultation = defineTool({
  name: 'start_consultation',
  description: 'The called patient is here and the consultation has started.',
  module: 'queue',
  input: id,
  allow: STAFF,
  async run(r, { queueEntryId }) {
    const u = await r.db.query(
      "UPDATE queue_entries SET status='in_consultation' WHERE id=$1 AND status='called' RETURNING doctor_id",
      [queueEntryId],
    );
    if (!u.rowCount)
      throw new ToolError('not_found', 'That patient is not in the called state', 404);
    r.emit({ type: 'queue_changed', doctorId: u.rows[0].doctor_id });
    return { ok: true };
  },
});

/**
 * Queue agent housekeeping: a called patient who has not started within 8 minutes gets a nudge;
 * after 15 minutes the token is marked a no-show and the receptionist is told. (Never reorders anyone.)
 */
export const sweepNoShows = defineTool({
  name: 'sweep_no_shows',
  description: 'Nudge or mark no-show for called patients who have not come in.',
  module: 'queue',
  input: z.object({
    nudgeAfterMinutes: z.number().default(8),
    noShowAfterMinutes: z.number().default(15),
  }),
  allow: ['agent:queue', 'system'],
  async run(r, i) {
    const { db, ctx } = r;
    const rows = (
      await db.query(
        `SELECT q.id, q.doctor_id, q.token_number, q.reminded_at, q.called_at, p.id AS pid, p.name, p.phone, p.language, d.name AS doctor
         FROM queue_entries q JOIN patients p ON p.id=q.patient_id JOIN doctors d ON d.id=q.doctor_id WHERE q.status='called' AND q.called_at IS NOT NULL`,
      )
    ).rows;
    let nudged = 0,
      noShows = 0;
    for (const q of rows) {
      const mins = (Date.now() - new Date(q.called_at).getTime()) / 60_000;
      const patient = { id: q.pid, phone: q.phone, language: q.language };
      if (mins >= i.noShowAfterMinutes) {
        await db.query("UPDATE queue_entries SET status='no_show' WHERE id=$1", [q.id]);
        await notifyPatient(
          r,
          patient,
          'msg.no_show',
          { token: q.token_number },
          { sender: 'agent:queue' },
        );
        const f = await db.query(
          "INSERT INTO flags (clinic_id,patient_id,kind,summary) VALUES ($1,$2,'system',$3) RETURNING id",
          [
            ctx.clinicId,
            q.pid,
            `Token ${q.token_number} (${q.name}) did not show up after being called and was marked a no-show.`,
          ],
        );
        r.emit({ type: 'flag_raised', flagId: f.rows[0].id, severity: 'normal' });
        r.emit({ type: 'queue_changed', doctorId: q.doctor_id });
        noShows++;
      } else if (mins >= i.nudgeAfterMinutes && !q.reminded_at) {
        await db.query('UPDATE queue_entries SET reminded_at=now() WHERE id=$1', [q.id]);
        await notifyPatient(
          r,
          patient,
          'msg.come_now',
          { name: q.name, token: q.token_number, doctor: q.doctor },
          { sender: 'agent:queue' },
        );
        nudged++;
      }
    }
    return { nudged, noShows };
  },
});

export const queueTools = [
  startConsultation,
  sweepNoShows,
  callNextPatient,
  finishVisit,
  skipPatient,
  holdPatient,
  resumePatient,
  markNoShow,
  getMyQueueStatus,
];
