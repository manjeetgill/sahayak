import { z } from 'zod';
import { defineTool, ToolError } from './registry';

const STAFF = ['staff:doctor', 'staff:receptionist'];
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A doctor manages their own leave; reception manages anyone's. */
const target = (ctx: { actor: any }, doctorId?: string): string => {
  const a = ctx.actor;
  if (a.kind === 'staff' && a.role === 'doctor') {
    if (!a.doctorId || (doctorId && doctorId !== a.doctorId))
      throw new ToolError('forbidden', 'You can only change your own leave', 403);
    return a.doctorId as string;
  }
  if (!doctorId) throw new ToolError('doctor_required', 'Choose a doctor');
  return doctorId;
};

export const listLeave = defineTool({
  name: 'list_leave',
  description: 'Upcoming and current leave for a doctor.',
  module: 'core',
  scope: 'read',
  input: z.object({ doctorId: z.string().uuid().optional() }),
  allow: STAFF,
  async run({ db, ctx }, i) {
    const doctorId = target(ctx, i.doctorId);
    return {
      leave: (
        await db.query(
          `SELECT l.id, to_char(starts_on,'YYYY-MM-DD') AS "startsOn", to_char(ends_on,'YYYY-MM-DD') AS "endsOn", note
             FROM doctor_leave l JOIN clinics c ON c.id=l.clinic_id
            WHERE doctor_id=$1 AND ends_on >= (now() AT TIME ZONE c.timezone)::date ORDER BY starts_on`,
          [doctorId],
        )
      ).rows as { id: string; startsOn: string; endsOn: string; note: string | null }[],
    };
  },
});

export const addLeave = defineTool({
  name: 'add_leave',
  description:
    'Mark days a doctor is away. New bookings are blocked for those days. Existing bookings are returned so staff can deal with each one; nobody is messaged automatically.',
  module: 'core',
  input: z.object({
    doctorId: z.string().uuid().optional(),
    startsOn: DATE,
    endsOn: DATE,
    note: z.string().trim().max(200).optional(),
  }),
  allow: STAFF,
  auditInput: (i) => ({ doctorId: i.doctorId, startsOn: i.startsOn, endsOn: i.endsOn }),
  auditOutput: (o: any) => ({ id: o.id, affected: o.affected.length }),
  async run({ db, ctx, emit }, i) {
    const doctorId = target(ctx, i.doctorId);
    if (i.endsOn < i.startsOn)
      throw new ToolError('bad_dates', 'The end date is before the start date');
    if (!(await db.query('SELECT 1 FROM doctors WHERE id=$1 AND active', [doctorId])).rowCount)
      throw new ToolError('not_found', 'Doctor not found', 404);
    let id: string;
    try {
      id = (
        await db.query(
          'INSERT INTO doctor_leave (clinic_id,doctor_id,starts_on,ends_on,note) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [ctx.clinicId, doctorId, i.startsOn, i.endsOn, i.note ?? null],
        )
      ).rows[0].id;
    } catch (e: any) {
      if (e.code === '23514') throw new ToolError('bad_dates', 'Leave can be at most 180 days');
      throw e;
    }
    emit({ type: 'queue_changed', doctorId });
    return {
      id,
      affected: await affectedByLeave(db, ctx.clinicId, doctorId, i.startsOn, i.endsOn),
    };
  },
});

export async function affectedByLeave(
  db: { query: (q: string, p?: unknown[]) => Promise<any> },
  _clinicId: string,
  doctorId: string,
  from: string,
  to: string,
) {
  return (
    await db.query(
      `SELECT a.id, a.starts_at AS "startsAt", p.name AS patient, p.phone
         FROM appointments a JOIN clinics c ON c.id=a.clinic_id LEFT JOIN patients p ON p.id=a.patient_id
        WHERE a.doctor_id=$1 AND a.status='booked'
          AND (a.starts_at AT TIME ZONE c.timezone)::date BETWEEN $2::date AND $3::date
        ORDER BY a.starts_at`,
      [doctorId, from, to],
    )
  ).rows as { id: string; startsAt: Date; patient: string | null; phone: string | null }[];
}

export const deleteLeave = defineTool({
  name: 'delete_leave',
  description: 'Remove a leave entry; those days open for booking again.',
  module: 'core',
  input: z.object({ id: z.string().uuid() }),
  allow: STAFF,
  auditInput: (i) => ({ id: i.id }),
  async run({ db, ctx }, { id }) {
    const row = (await db.query('SELECT doctor_id FROM doctor_leave WHERE id=$1', [id])).rows[0];
    if (!row) throw new ToolError('not_found', 'Leave not found', 404);
    target(ctx, row.doctor_id);
    await db.query('DELETE FROM doctor_leave WHERE id=$1', [id]);
    return { ok: true };
  },
});

export const leaveTools = [listLeave, addLeave, deleteLeave];
