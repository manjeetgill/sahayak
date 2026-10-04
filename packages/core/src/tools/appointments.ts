import { z } from 'zod';
import type { Db } from '@sahayak/db';
import { defineTool, ToolError } from './registry';
import { assertOwn, clinicToday } from './common';

const STAFF = ['staff:doctor', 'staff:receptionist'];
const BOOKERS = [...STAFF, 'agent:front_desk', 'agent:leads', 'agent:schedule'];

export async function freeSlots(db: Db, clinicId: string, doctorId: string, date: string, limit = 50): Promise<string[]> {
  const doc = await db.query('SELECT slot_minutes FROM doctors WHERE id=$1 AND active', [doctorId]);
  if (!doc.rowCount) throw new ToolError('not_found', 'Doctor not found', 404);
  const slot = doc.rows[0].slot_minutes as number;
  const s = await db.query(
    `SELECT timings, c.timezone, lower(to_char($2::date,'dy')) AS dow FROM clinic_settings s JOIN clinics c ON c.id=s.clinic_id WHERE s.clinic_id=$1`, [clinicId, date]);
  const { timings, timezone, dow } = s.rows[0];
  const spec: string = timings?.[dow] ?? '';
  const out: string[] = [];
  for (const w of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = w.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!m) continue;
    const r = await db.query(
      `SELECT s FROM generate_series(($1::date + $2::time) AT TIME ZONE $4, ($1::date + $3::time - make_interval(mins => $5)) AT TIME ZONE $4, make_interval(mins => $5)) s
        WHERE s > now() AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id=$6 AND a.starts_at=s AND a.status IN ('booked','checked_in'))`,
      [date, m[1], m[2], timezone, slot, doctorId]);
    out.push(...r.rows.map((x) => (x.s as Date).toISOString()));
  }
  return out.slice(0, limit);
}

/** Next days with free slots for a doctor: used by agents offering options. */
export async function nextFreeSlots(db: Db, clinicId: string, doctorId: string, count: number, fromDate?: string): Promise<string[]> {
  const { date } = await clinicToday(db, clinicId);
  const start = fromDate ?? date;
  const out: string[] = [];
  for (let i = 0; i < 14 && out.length < count; i++) {
    const d = (await db.query("SELECT to_char($1::date + $2::int,'YYYY-MM-DD') AS d", [start, i])).rows[0].d;
    out.push(...(await freeSlots(db, clinicId, doctorId, d, count - out.length)));
  }
  return out;
}

export const listFreeSlots = defineTool({
  name: 'list_free_slots', description: 'List free appointment slots for a doctor, starting today.', module: 'appointments',
  input: z.object({ doctorId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), count: z.number().int().min(1).max(20).default(5) }),
  allow: [...BOOKERS, 'patient'],
  async run({ db, ctx }, i) {
    const slots = i.date ? await freeSlots(db, ctx.clinicId, i.doctorId, i.date, i.count) : await nextFreeSlots(db, ctx.clinicId, i.doctorId, i.count);
    return { slots };
  },
});

export const bookAppointment = defineTool({
  name: 'book_appointment', description: 'Book an appointment slot for a patient with a doctor.', module: 'appointments',
  input: z.object({ doctorId: z.string().uuid(), patientId: z.string().uuid(), startsAt: z.string().datetime(), reason: z.string().max(200).optional(),
    source: z.enum(['manual', 'whatsapp', 'walk_in', 'agent']).default('agent') }),
  allow: BOOKERS,
  async run(r, i) {
    const { db, ctx } = r;
    assertOwn(ctx, i.patientId);
    const start = new Date(i.startsAt);
    const day = (await db.query("SELECT to_char($1::timestamptz AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$2),'YYYY-MM-DD') AS d", [start, ctx.clinicId])).rows[0].d;
    const free = await freeSlots(db, ctx.clinicId, i.doctorId, day, 500);
    if (!free.includes(start.toISOString())) {
      const alt = await nextFreeSlots(db, ctx.clinicId, i.doctorId, 3, day);
      throw new ToolError('slot_taken', `That slot is not available. Alternatives: ${alt.join(', ')}`);
    }
    const slot = (await db.query('SELECT slot_minutes FROM doctors WHERE id=$1', [i.doctorId])).rows[0].slot_minutes;
    try {
      const ins = await db.query(
        `INSERT INTO appointments (clinic_id,doctor_id,patient_id,starts_at,ends_at,source,reason)
         VALUES ($1,$2,$3,$4,$4::timestamptz + make_interval(mins => $5),$6,$7) RETURNING id, starts_at`,
        [ctx.clinicId, i.doctorId, i.patientId, start, slot, i.source, i.reason ?? null]);
      return { appointmentId: ins.rows[0].id as string, startsAt: (ins.rows[0].starts_at as Date).toISOString() };
    } catch (e: any) {
      if (e.code === '23505') throw new ToolError('slot_taken', 'That slot was just taken');
      throw e;
    }
  },
});

export const getPatientAppointments = defineTool({
  name: 'get_patient_appointments', description: "List a patient's upcoming appointments.", module: 'appointments',
  input: z.object({ patientId: z.string().uuid() }),
  allow: [...BOOKERS, 'patient', 'agent:records', 'agent:followup'],
  async run({ db, ctx }, { patientId }) {
    assertOwn(ctx, patientId);
    const r = await db.query(
      `SELECT a.id, a.starts_at, a.status, d.name AS doctor, d.id AS doctor_id FROM appointments a JOIN doctors d ON d.id=a.doctor_id
        WHERE a.patient_id=$1 AND a.status IN ('booked','checked_in','needs_rebooking') AND a.starts_at > now() - interval '1 day' ORDER BY a.starts_at`, [patientId]);
    return { appointments: r.rows.map((x) => ({ id: x.id, startsAt: (x.starts_at as Date).toISOString(), status: x.status, doctor: x.doctor, doctorId: x.doctor_id })) };
  },
});

export const cancelAppointment = defineTool({
  name: 'cancel_appointment', description: 'Cancel an appointment.', module: 'appointments',
  input: z.object({ appointmentId: z.string().uuid() }), allow: BOOKERS,
  async run({ db, ctx }, { appointmentId }) {
    const a = await db.query('SELECT patient_id, starts_at FROM appointments WHERE id=$1', [appointmentId]);
    if (!a.rowCount) throw new ToolError('not_found', 'Appointment not found', 404);
    if (a.rows[0].patient_id) assertOwn(ctx, a.rows[0].patient_id);
    await db.query("UPDATE appointments SET status='cancelled' WHERE id=$1", [appointmentId]);
    return { ok: true, startsAt: (a.rows[0].starts_at as Date).toISOString() };
  },
});

export const rescheduleAppointment = defineTool({
  name: 'reschedule_appointment', description: 'Move an appointment to a new free slot with the same doctor.', module: 'appointments',
  input: z.object({ appointmentId: z.string().uuid(), newStartsAt: z.string().datetime() }), allow: BOOKERS,
  async run({ db, ctx }, i) {
    const a = await db.query('SELECT doctor_id, patient_id FROM appointments WHERE id=$1', [i.appointmentId]);
    if (!a.rowCount) throw new ToolError('not_found', 'Appointment not found', 404);
    if (a.rows[0].patient_id) assertOwn(ctx, a.rows[0].patient_id);
    const start = new Date(i.newStartsAt);
    const day = (await db.query("SELECT to_char($1::timestamptz AT TIME ZONE (SELECT timezone FROM clinics WHERE id=$2),'YYYY-MM-DD') AS d", [start, ctx.clinicId])).rows[0].d;
    if (!(await freeSlots(db, ctx.clinicId, a.rows[0].doctor_id, day, 500)).includes(start.toISOString())) throw new ToolError('slot_taken', 'That slot is not available');
    const slot = (await db.query('SELECT slot_minutes FROM doctors WHERE id=$1', [a.rows[0].doctor_id])).rows[0].slot_minutes;
    await db.query("UPDATE appointments SET starts_at=$2, ends_at=$2::timestamptz + make_interval(mins => $3), status='booked' WHERE id=$1", [i.appointmentId, start, slot]);
    return { ok: true, startsAt: start.toISOString() };
  },
});

export const appointmentTools = [listFreeSlots, bookAppointment, getPatientAppointments, cancelAppointment, rescheduleAppointment];
