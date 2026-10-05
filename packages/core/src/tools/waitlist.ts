import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { defineTool, ToolError, type ToolRun } from './registry';
import { hasConsent, notifyPatient, getSettings, fmtTime } from './common';
import { bookAppointment } from './appointments';
const UUID = z.string().uuid();
const STAFF = ['staff:doctor', 'staff:receptionist'];
export async function lockAppointments(r: ToolRun, doctorId: string) {
  await r.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `${r.ctx.clinicId}:appointments:${doctorId}`,
  ]);
}
export async function offerCancelledSlot(r: ToolRun, appointmentId: string) {
  const { db, ctx } = r;
  const a = (
    await db.query(
      "SELECT * FROM appointments WHERE id=$1 AND status='cancelled' AND starts_at>now()+interval '15 minutes'",
      [appointmentId],
    )
  ).rows[0];
  if (!a) return { offered: false };
  await lockAppointments(r, a.doctor_id);
  await db.query(
    "UPDATE slot_offers SET status='expired' WHERE status='pending' AND expires_at<=now()",
  );
  if (
    (
      await db.query(
        `SELECT 1 FROM appointments WHERE doctor_id=$1 AND starts_at=$2 AND status IN ('booked','checked_in')
    UNION ALL SELECT 1 FROM slot_offers WHERE doctor_id=$1 AND starts_at=$2 AND status='pending'`,
        [a.doctor_id, a.starts_at],
      )
    ).rowCount
  )
    return { offered: false };
  const settings = await getSettings(db, ctx.clinicId);
  const hour = Number(
    (await db.query('SELECT extract(hour FROM now() AT TIME ZONE $1) AS hour', [settings.timezone]))
      .rows[0].hour,
  );
  if (hour < 8 || hour >= 21) return { offered: false };
  const candidates = (
    await db.query(
      `SELECT w.id AS waitlist_id,p.id,p.phone,p.language FROM appointment_waitlist w JOIN patients p ON p.id=w.patient_id
    WHERE w.doctor_id=$1 AND w.status='waiting' AND w.patient_id<>$3
    AND ($2::timestamptz AT TIME ZONE $4)::date BETWEEN w.from_date AND w.to_date
    AND NOT EXISTS (SELECT 1 FROM slot_offers o WHERE o.waitlist_id=w.id AND (o.starts_at=$2 OR (o.status='pending' AND o.expires_at>now())))
    ORDER BY w.created_at LIMIT 100`,
      [a.doctor_id, a.starts_at, a.patient_id, settings.timezone],
    )
  ).rows;
  for (const p of candidates) {
    if (
      !(await hasConsent(db, p.id, 'whatsapp_messaging')) ||
      !(await hasConsent(db, p.id, 'reminders_followups'))
    )
      continue;
    const code = randomBytes(5).toString('hex').toUpperCase();
    const offer = (
      await db.query(
        `INSERT INTO slot_offers(clinic_id,waitlist_id,doctor_id,patient_id,starts_at,expires_at,code)
      VALUES ($1,$2,$3,$4,$5,now()+interval '15 minutes',$6) RETURNING id,expires_at`,
        [ctx.clinicId, p.waitlist_id, a.doctor_id, p.id, a.starts_at, code],
      )
    ).rows[0];
    await notifyPatient(
      r,
      p,
      'msg.waitlist_offer',
      {
        clinic: settings.clinic_name,
        time: fmtTime(a.starts_at, settings.timezone, p.language),
        code,
        expires: fmtTime(offer.expires_at, settings.timezone, p.language),
      },
      { offerId: offer.id },
    );
    return { offered: true, offerId: offer.id };
  }
  return { offered: false };
}
export const joinWaitlist = defineTool({
  name: 'join_waitlist',
  description:
    'Record explicit patient opt-in for cancellation offers; messaging consent must already exist.',
  module: 'appointments',
  input: z.object({
    patientId: UUID,
    doctorId: UUID,
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    optedIn: z.literal(true),
  }),
  allow: STAFF,
  auditInput: (i) => ({ patientId: i.patientId, doctorId: i.doctorId, optedIn: true }),
  async run({ db, ctx }, i) {
    if (
      !(
        await db.query("SELECT 1 FROM patients WHERE id=$1 AND name<>'Erased patient'", [
          i.patientId,
        ])
      ).rowCount ||
      !(await db.query('SELECT 1 FROM doctors WHERE id=$1 AND active', [i.doctorId])).rowCount
    )
      throw new ToolError('not_found', 'Patient or doctor not found', 404);
    if (
      !(await hasConsent(db, i.patientId, 'whatsapp_messaging')) ||
      !(await hasConsent(db, i.patientId, 'reminders_followups'))
    )
      throw new ToolError('no_consent', 'Messaging and reminder consent are required');
    if (i.fromDate > i.toDate)
      throw new ToolError('invalid_dates', 'End date must follow start date');
    const row = (
      await db.query(
        `INSERT INTO appointment_waitlist(clinic_id,patient_id,doctor_id,from_date,to_date,created_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (clinic_id,patient_id,doctor_id) WHERE status='waiting' DO UPDATE SET from_date=EXCLUDED.from_date,to_date=EXCLUDED.to_date,opted_in_at=now() RETURNING id`,
        [
          ctx.clinicId,
          i.patientId,
          i.doctorId,
          i.fromDate,
          i.toDate,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      )
    ).rows[0];
    return { id: row.id };
  },
});
export const listWaitlist = defineTool({
  name: 'list_waitlist',
  description: 'Waiting patients, temporary offers, and recently cancelled slots.',
  module: 'appointments',
  input: z.object({}),
  allow: STAFF,
  auditOutput: () => ({ listed: true }),
  async run({ db }) {
    return {
      waiting: (
        await db.query(
          `SELECT w.*,p.name AS patient_name,d.name AS doctor FROM appointment_waitlist w JOIN patients p ON p.id=w.patient_id JOIN doctors d ON d.id=w.doctor_id WHERE w.status='waiting' ORDER BY w.created_at LIMIT 100`,
        )
      ).rows,
      offers: (
        await db.query(
          `SELECT o.id,o.code,o.starts_at,o.expires_at,CASE WHEN o.status='pending' AND o.expires_at<=now() THEN 'expired' ELSE o.status END AS status,p.name AS patient_name FROM slot_offers o JOIN patients p ON p.id=o.patient_id ORDER BY o.created_at DESC LIMIT 100`,
        )
      ).rows,
      cancellations: (
        await db.query(
          "SELECT a.id,a.starts_at,d.name AS doctor FROM appointments a JOIN doctors d ON d.id=a.doctor_id WHERE a.status='cancelled' AND a.starts_at>now()+interval '15 minutes' ORDER BY a.starts_at LIMIT 50",
        )
      ).rows,
    };
  },
});
export const withdrawWaitlist = defineTool({
  name: 'withdraw_waitlist',
  description: 'Withdraw opt-in and invalidate pending offers.',
  module: 'appointments',
  input: z.object({ id: UUID }),
  allow: STAFF,
  async run(r, { id }) {
    const { db } = r;
    const entry = (await db.query('SELECT doctor_id FROM appointment_waitlist WHERE id=$1', [id]))
      .rows[0];
    if (!entry) throw new ToolError('not_found', 'Waiting entry not found', 404);
    await lockAppointments(r, entry.doctor_id);
    const row = (
      await db.query(
        "UPDATE appointment_waitlist SET status='withdrawn' WHERE id=$1 AND status='waiting' RETURNING id",
        [id],
      )
    ).rows[0];
    if (!row) throw new ToolError('not_found', 'Waiting entry not found', 404);
    await db.query(
      "UPDATE slot_offers SET status='declined' WHERE waitlist_id=$1 AND status='pending'",
      [id],
    );
    return { ok: true };
  },
});
export const offerSlot = defineTool({
  name: 'offer_cancelled_slot',
  description: 'Offer a cancelled slot to the next eligible opted-in patient during daytime.',
  module: 'appointments',
  input: z.object({ appointmentId: UUID }),
  allow: STAFF,
  run: (r, i) => offerCancelledSlot(r, i.appointmentId),
});
export const acceptOffer = defineTool({
  name: 'accept_slot_offer',
  description: 'Accept a still-valid offer for the patient in the current conversation.',
  module: 'appointments',
  input: z.object({ code: z.string().regex(/^[A-F0-9]{10}$/) }),
  allow: ['agent:front_desk'],
  auditInput: () => ({ acceptOffer: true }),
  async run(r, i) {
    const { db, ctx } = r;
    const offer = (
      await db.query('SELECT * FROM slot_offers WHERE code=$1 AND patient_id=$2', [
        i.code,
        ctx.patientId ?? null,
      ])
    ).rows[0];
    if (!offer) return { accepted: false };
    await lockAppointments(r, offer.doctor_id);
    const current = (
      await db.query(
        `SELECT o.* FROM slot_offers o JOIN appointment_waitlist w ON w.id=o.waitlist_id WHERE o.id=$1 AND o.status='pending' AND o.expires_at>now() AND w.status='waiting' FOR UPDATE OF o,w`,
        [offer.id],
      )
    ).rows[0];
    if (
      !current ||
      !(await hasConsent(db, offer.patient_id, 'whatsapp_messaging')) ||
      !(await hasConsent(db, offer.patient_id, 'reminders_followups'))
    )
      return { accepted: false };
    await db.query("UPDATE slot_offers SET status='accepted' WHERE id=$1", [offer.id]);
    const booked = await bookAppointment.run(r, {
      doctorId: offer.doctor_id,
      patientId: offer.patient_id,
      startsAt: offer.starts_at.toISOString(),
      source: 'whatsapp',
    });
    await db.query('UPDATE slot_offers SET appointment_id=$2 WHERE id=$1', [
      offer.id,
      booked.appointmentId,
    ]);
    await db.query("UPDATE appointment_waitlist SET status='booked' WHERE id=$1", [
      offer.waitlist_id,
    ]);
    return { accepted: true };
  },
});
export const waitlistTools = [joinWaitlist, listWaitlist, withdrawWaitlist, offerSlot, acceptOffer];
