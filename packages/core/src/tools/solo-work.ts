import { z } from 'zod';
import { detectRedFlagKeywords } from '@sahayak/shared';
import { defineTool, ToolError } from './registry';
import type { ToolRun } from './registry';

export const getSoloAvailability = defineTool({
  name: 'get_solo_availability',
  module: 'core',
  description: 'Show whether the solo doctor is available, seeing patients, or closed.',
  scope: 'read',
  input: z.object({}),
  allow: ['staff:doctor', 'staff:admin'],
  auditOutput: () => ({ opened: true }),
  async run({ db, ctx }) {
    const row = (await db.query(
      `SELECT s.workspace_mode,s.solo_availability,s.solo_availability_updated_at,
        u.id AS owner_id,u.name AS owner_name
       FROM clinic_settings s LEFT JOIN staff_users u ON u.clinic_id=s.clinic_id AND u.solo_owner
       WHERE s.clinic_id=$1`, [ctx.clinicId],
    )).rows[0];
    return {
      workspaceMode: row.workspace_mode,
      availability: row.solo_availability,
      updatedAt: row.solo_availability_updated_at,
      ownerId: row.owner_id ?? null,
      ownerName: row.owner_name ?? null,
    };
  },
});

export const setSoloAvailability = defineTool({
  name: 'set_solo_availability',
  module: 'core',
  description: 'Solo doctor chooses how patient requests reach them during the day.',
  input: z.object({ availability: z.enum(['available', 'seeing_patients', 'closed']) }),
  allow: ['staff:admin'],
  auditInput: (i) => i,
  async run({ db, ctx }, i) {
    if (ctx.actor.kind !== 'staff' ||
        (ctx.actor.role === 'doctor' && ctx.actor.clinicAdmin !== true))
      throw new ToolError('forbidden', 'Only the clinic owner can change this', 403);
    const row = (await db.query(
      `UPDATE clinic_settings SET solo_availability=$2,solo_availability_updated_at=now(),updated_at=now()
       WHERE clinic_id=$1 AND workspace_mode='solo' RETURNING solo_availability,solo_availability_updated_at`,
      [ctx.clinicId, i.availability],
    )).rows[0];
    if (!row) throw new ToolError('not_solo', 'Choose Single doctor clinic view first', 409);
    return { availability: row.solo_availability, updatedAt: row.solo_availability_updated_at };
  },
});

async function closeoutSnapshot(r: ToolRun) {
  if (r.ctx.actor.kind !== 'staff' || r.ctx.actor.role !== 'doctor' ||
      r.ctx.actor.clinicAdmin !== true || !r.ctx.actor.doctorId)
    throw new ToolError('forbidden', 'Only the solo doctor owner can review the day', 403);
  const row = (await r.db.query(
    `SELECT s.workspace_mode,c.timezone,
       ((now() AT TIME ZONE c.timezone)::date)::text AS clinic_date,
       (SELECT count(*)::int FROM queue_entries q WHERE q.doctor_id=$2
         AND q.queue_date=(now() AT TIME ZONE c.timezone)::date
         AND q.status IN ('waiting','called','in_consultation','on_hold','skipped')) AS queue_open,
       (SELECT count(*)::int FROM flags f WHERE f.status='open' AND f.severity='urgent') AS urgent_alerts,
       (SELECT count(*)::int FROM visit_notes n WHERE n.doctor_id=$2 AND n.status='draft') AS unsigned_notes,
       (SELECT count(*)::int FROM issued_documents d WHERE d.doctor_id=$2 AND d.status='draft') AS unsigned_documents,
       (SELECT count(*)::int FROM qr_payment_orders o WHERE o.state IN ('unknown','review')) AS payment_problems,
       (SELECT count(*)::int FROM care_tasks t WHERE t.assigned_to=$3
         AND t.status NOT IN ('informed','cancelled') AND t.due_at<now()+interval '1 day') AS care_due,
       (SELECT count(*)::int FROM conversations x WHERE x.handled_by='human'
         AND x.human_user_id=$3 AND EXISTS
           (SELECT 1 FROM messages m WHERE m.conversation_id=x.id AND m.direction='in'
             AND NOT EXISTS (SELECT 1 FROM messages reply WHERE reply.conversation_id=x.id
               AND reply.direction='out' AND reply.sender LIKE 'staff:%' AND reply.created_at>=m.created_at))) AS messages_waiting,
       (SELECT count(*)::int FROM appointments a WHERE a.doctor_id=$2 AND a.status='booked'
         AND (a.starts_at AT TIME ZONE c.timezone)::date=((now() AT TIME ZONE c.timezone)::date+1)) AS tomorrow_booked
     FROM clinic_settings s JOIN clinics c ON c.id=s.clinic_id WHERE s.clinic_id=$1`,
    [r.ctx.clinicId, r.ctx.actor.doctorId, r.ctx.actor.userId],
  )).rows[0];
  if (row?.workspace_mode !== 'solo') throw new ToolError('not_solo', 'Choose Single doctor clinic view first', 409);
  const counts = {
    queueOpen: row.queue_open, urgentAlerts: row.urgent_alerts,
    unsignedNotes: row.unsigned_notes, unsignedDocuments: row.unsigned_documents,
    paymentProblems: row.payment_problems, careDue: row.care_due,
    messagesWaiting: row.messages_waiting, tomorrowBooked: row.tomorrow_booked,
  };
  const reviewed = (await r.db.query(
    'SELECT reviewed_at,counts FROM solo_closeouts WHERE clinic_id=$1 AND doctor_id=$2 AND clinic_date=$3',
    [r.ctx.clinicId, r.ctx.actor.doctorId, row.clinic_date],
  )).rows[0];
  return { clinicDate: row.clinic_date, counts,
    reviewedAt: reviewed?.reviewed_at ?? null, reviewedCounts: reviewed?.counts ?? null };
}

export const getSoloCloseout = defineTool({
  name: 'get_solo_closeout', module: 'core',
  description: 'Show open work and tomorrow’s bookings for the solo doctor.',
  input: z.object({}), allow: ['staff:doctor'], scope: 'read',
  auditOutput: () => ({ opened: true }),
  async run(r) { return closeoutSnapshot(r); },
});
export const recordSoloCloseout = defineTool({
  name: 'record_solo_closeout', module: 'core',
  description: 'Record that the solo doctor reviewed the current open work. Does not close unresolved items.',
  input: z.object({ acknowledged: z.literal(true) }), allow: ['staff:doctor'],
  auditOutput: () => ({ reviewed: true }),
  async run(r) {
    const snapshot = await closeoutSnapshot(r);
    if (r.ctx.actor.kind !== 'staff' || !r.ctx.actor.doctorId) throw new ToolError('forbidden', 'Doctor required', 403);
    await r.db.query(
      `INSERT INTO solo_closeouts(clinic_id,doctor_id,clinic_date,counts) VALUES ($1,$2,$3,$4)
       ON CONFLICT(clinic_id,doctor_id,clinic_date) DO UPDATE SET counts=$4,reviewed_at=now()`,
      [r.ctx.clinicId, r.ctx.actor.doctorId, snapshot.clinicDate, JSON.stringify(snapshot.counts)],
    );
    return { ...snapshot, reviewedAt: new Date().toISOString() };
  },
});

export const submitPatientCareReply = defineTool({
  name: 'submit_patient_care_reply', module: 'core',
  description: 'Save a patient reply to a doctor-approved follow-up plan for doctor review.',
  input: z.object({ stepId: z.string().uuid(), response: z.string().trim().min(1).max(2000) }),
  allow: ['patient'], auditInput: () => ({ patientReply: true }),
  auditOutput: () => ({ saved: true }),
  async run(r, i) {
    if (!r.ctx.patientId) throw new ToolError('forbidden', 'Private patient link required', 403);
    const step = (await r.db.query(
      `SELECT s.id,s.status,s.patient_id FROM care_plan_steps s JOIN care_plans p ON p.id=s.plan_id
       WHERE s.id=$1 AND s.patient_id=$2 AND p.status='active' FOR UPDATE OF s`,
      [i.stepId, r.ctx.patientId],
    )).rows[0];
    if (!step) throw new ToolError('not_found', 'Active follow-up step not found', 404);
    if (!['pending','contacted','no_response'].includes(step.status))
      throw new ToolError('already_reviewing', 'The clinic already has a reply to review', 409);
    const phrases = (await r.db.query('SELECT phrase,language FROM red_flag_phrases')).rows;
    const urgent = !!detectRedFlagKeywords(i.response, phrases);
    let flagId: string | null = null;
    if (urgent) {
      const createdFlagId = (await r.db.query(
        `INSERT INTO flags(clinic_id,patient_id,kind,severity,summary)
         VALUES($1,$2,'red_flag','urgent','A patient follow-up reply may describe an emergency. Review the original response promptly.') RETURNING id`,
        [r.ctx.clinicId, r.ctx.patientId],
      )).rows[0].id as string;
      flagId = createdFlagId;
      r.emit({ type: 'flag_raised', flagId: createdFlagId, severity: 'urgent' });
    }
    await r.db.query(
      `UPDATE care_plan_steps SET status='needs_review',response=$2,responded_at=now(),flag_id=COALESCE($3,flag_id)
       WHERE id=$1`, [i.stepId, i.response, flagId],
    );
    await r.db.query(
      `INSERT INTO care_step_history(clinic_id,patient_id,step_id,status,response,source)
       VALUES($1,$2,$3,'needs_review',$4,'patient_web')`,
      [r.ctx.clinicId, r.ctx.patientId, i.stepId, i.response],
    );
    return { saved: true, urgent };
  },
});

export const soloWorkTools = [getSoloAvailability, setSoloAvailability, getSoloCloseout, recordSoloCloseout, submitPatientCareReply];
