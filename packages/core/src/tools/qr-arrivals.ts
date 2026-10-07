import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CheckinInput } from '@sahayak/shared';
import { defineTool, ToolError } from './registry';
import { registerCheckinPatient, checkInPatient } from './checkin';
import { clinicToday } from './common';
import { addCharge, recordPayment } from './clinical-workbench';
const token = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().uuid();
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const CARE = ['staff:doctor', 'staff:receptionist'];
export const qrArrivalTools = [
  defineTool({
    name: 'get_qr_settings',
    module: 'core',
    description: 'Clinic QR check-in and payment confirmation settings.',
    allow: ['staff:admin', ...CARE],
    input: z.object({}),
    async run({ db, ctx }) {
      const row = (
        await db.query('SELECT enabled,amount_paise,public_web_url FROM clinic_qr_settings')
      ).rows[0];
      const clinic = (await db.query('SELECT slug,name FROM clinics WHERE id=$1', [ctx.clinicId]))
        .rows[0];
      return {
        enabled: row?.enabled ?? false,
        amountPaise: row?.amount_paise ?? 50000,
        publicWebUrl: row?.public_web_url ?? '',
        ...clinic,
      };
    },
  }),
  defineTool({
    name: 'save_qr_settings',
    module: 'core',
    description: 'Configure QR arrival and receptionist-confirmed payment.',
    allow: ['staff:admin'],
    input: z
      .object({
        enabled: z.boolean(),
        amountPaise: z.number().int().min(1).max(100000000),
        publicWebUrl: z.string().max(500).default(''),
      })
      .strict(),
    async run({ db, ctx }, i) {
      let origin = '';
      if (i.publicWebUrl) {
        try {
          const u = new URL(i.publicWebUrl);
          if (
            !['http:', 'https:'].includes(u.protocol) ||
            u.username ||
            u.password ||
            u.search ||
            u.hash ||
            u.pathname !== '/' ||
            ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)
          )
            throw Error();
          origin = u.origin;
        } catch {
          throw new ToolError(
            'url',
            'Use a public HTTPS address, or your clinic server’s Wi-Fi address, without a path.',
          );
        }
      }
      await db.query(
        'INSERT INTO clinic_qr_settings(clinic_id,enabled,amount_paise,public_web_url,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(clinic_id) DO UPDATE SET enabled=EXCLUDED.enabled,amount_paise=EXCLUDED.amount_paise,public_web_url=EXCLUDED.public_web_url,updated_by=EXCLUDED.updated_by,updated_at=now()',
        [
          ctx.clinicId,
          i.enabled,
          i.amountPaise,
          origin || null,
          ctx.actor.kind === 'staff' ? ctx.actor.userId : null,
        ],
      );
      return { ok: true };
    },
  }),
  defineTool({
    name: 'submit_qr_arrival',
    module: 'checkin',
    description:
      'Record QR patient details and await staff payment confirmation; no queue token yet.',
    allow: ['patient'],
    input: CheckinInput.extend({ accessToken: token }).strict(),
    auditInput: (i) => ({ doctorId: i.doctorId }),
    auditOutput: () => ({ received: true }),
    async run(r, i) {
      const settings = (await r.db.query('SELECT * FROM clinic_qr_settings WHERE enabled')).rows[0];
      if (!settings)
        throw new ToolError(
          'not_ready',
          'Please check in with reception. QR payment check-in is not enabled.',
        );
      const hash = digest(i.accessToken);
      const existing = (
        await r.db.query('SELECT id,expires_at FROM qr_arrivals WHERE access_hash=$1', [hash])
      ).rows[0];
      if (existing) {
        if (new Date(existing.expires_at) <= new Date())
          throw new ToolError(
            'expired',
            'This check-in link has expired. Please contact reception.',
            410,
          );
        return { received: true };
      }
      if (!i.consent.visit_data)
        throw new ToolError(
          'consent_required',
          'Please agree to the clinic recording your visit details',
        );
      const p = await registerCheckinPatient(r, i);
      const { date } = await clinicToday(r.db, r.ctx.clinicId);
      if (
        (
          await r.db.query(
            "SELECT id FROM queue_entries WHERE patient_id=$1 AND queue_date=$2 AND status IN ('waiting','called','in_consultation','on_hold')",
            [p.patientId, date],
          )
        ).rowCount
      )
        throw new ToolError(
          'already_checked_in',
          'You already have an active visit today. Please ask reception for your token.',
        );
      if (
        (
          await r.db.query(
            "SELECT id FROM qr_arrivals WHERE patient_id=$1 AND arrival_date=$2 AND status='awaiting_payment'",
            [p.patientId, date],
          )
        ).rowCount
      )
        throw new ToolError(
          'already_arrived',
          'Your check-in is already with reception. Please show them your name or phone number.',
        );
      await r.db.query(
        'INSERT INTO qr_arrivals(clinic_id,patient_id,doctor_id,arrival_date,access_hash,amount_paise) VALUES($1,$2,$3,$4,$5,$6)',
        [r.ctx.clinicId, p.patientId, i.doctorId, date, hash, settings.amount_paise],
      );
      r.emit({ type: 'queue_changed', doctorId: i.doctorId });
      return { received: true };
    },
  }),
  defineTool({
    name: 'read_qr_arrival',
    module: 'core',
    description: 'Read a private arrival receipt using its unguessable token.',
    allow: ['patient'],
    input: z.object({ accessToken: token }),
    auditInput: () => ({ receipt: true }),
    auditOutput: () => ({ opened: true }),
    async run({ db }, i) {
      const row = (
        await db.query(
          `SELECT a.id,a.status,a.amount_paise,a.expires_at,d.name AS doctor,q.token_number,q.status AS visit_status,c.status AS feedback_status,c.scheduled_at AS feedback_at,
 (SELECT COALESCE(sum(p.amount_paise),0) FROM clinic_payments p WHERE p.charge_id=a.charge_id AND p.voided_at IS NULL)::int AS paid
 FROM qr_arrivals a JOIN doctors d ON d.id=a.doctor_id LEFT JOIN queue_entries q ON q.id=a.queue_entry_id LEFT JOIN patient_checkins c ON c.queue_entry_id=q.id AND c.status='scheduled' WHERE a.access_hash=$1`,
          [digest(i.accessToken)],
        )
      ).rows[0];
      if (!row || new Date(row.expires_at) <= new Date())
        throw new ToolError(
          'expired',
          'This receipt link has expired. Please contact reception.',
          410,
        );
      return {
        reference: row.id.slice(0, 8).toUpperCase(),
        status: row.status,
        amountPaise: row.amount_paise,
        paidPaise: row.paid,
        doctor: row.doctor,
        token: row.token_number,
        visitStatus: row.visit_status,
        feedbackAt: row.feedback_at,
      };
    },
  }),
  defineTool({
    name: 'list_qr_arrivals',
    module: 'core',
    description: 'Today’s QR arrivals and payment confirmations for the front desk.',
    allow: CARE,
    input: z.object({}),
    auditOutput: () => ({ opened: true }),
    async run({ db, ctx }) {
      const { date } = await clinicToday(db, ctx.clinicId);
      return {
        arrivals: (
          await db.query(
            `SELECT a.id,a.status,a.amount_paise,a.created_at,a.expires_at,a.confirmed_at,
        (SELECT COALESCE(sum(pay.amount_paise),0)::int FROM clinic_payments pay WHERE pay.charge_id=a.charge_id AND pay.voided_at IS NULL) paid_paise,p.name,p.phone,d.name doctor,q.token_number,q.status visit_status FROM qr_arrivals a JOIN patients p ON p.id=a.patient_id JOIN doctors d ON d.id=a.doctor_id LEFT JOIN queue_entries q ON q.id=a.queue_entry_id WHERE a.arrival_date=$1 ORDER BY (a.status='awaiting_payment') DESC,a.created_at LIMIT 200`,
            [date],
          )
        ).rows,
      };
    },
  }),
  defineTool({
    name: 'confirm_qr_payment',
    module: 'checkin',
    description:
      'Confirm money already received, record the payment, and issue a queue token atomically.',
    allow: CARE,
    input: z
      .object({
        id,
        method: z.enum(['cash', 'upi', 'card', 'bank', 'other']),
        confirmed: z.literal(true),
      })
      .strict(),
    auditInput: (i) => ({ id: i.id, method: i.method }),
    async run(r, i) {
      const a = (
        await r.db.query(
          "SELECT *,to_char(arrival_date,'YYYY-MM-DD') AS arrival_day FROM qr_arrivals WHERE id=$1 FOR UPDATE",
          [i.id],
        )
      ).rows[0];
      if (!a) throw new ToolError('not_found', 'Arrival not found', 404);
      if (a.status === 'queued') return { ok: true, alreadyConfirmed: true };
      if (a.status !== 'awaiting_payment' || new Date(a.expires_at) <= new Date())
        throw new ToolError(
          'expired',
          'This arrival is cancelled or expired. Ask the patient to check in again.',
        );
      const p = (
        await r.db.query(
          'SELECT name,phone,language,erasure_requested_at FROM patients WHERE id=$1',
          [a.patient_id],
        )
      ).rows[0];
      if (!p || p.erasure_requested_at || p.name === 'Erased patient')
        throw new ToolError('not_found', 'Patient record unavailable', 404);
      const input = {
        phone: p.phone,
        name: p.name,
        language: p.language,
        doctorId: a.doctor_id,
        consent: { visit_data: false, whatsapp_messaging: false, reminders_followups: false },
      };
      await registerCheckinPatient(r, input);
      const { date } = await clinicToday(r.db, r.ctx.clinicId);
      // Queue operations and this payment confirmation use the same day lock.
      await r.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${r.ctx.clinicId}:${date}`]);
      if (a.arrival_day !== date)
        throw new ToolError(
          'expired',
          'This arrival is from another day. Ask the patient to check in again.',
        );
      if (
        (
          await r.db.query(
            "SELECT id FROM queue_entries WHERE patient_id=$1 AND queue_date=$2 AND status IN ('waiting','called','in_consultation','on_hold')",
            [a.patient_id, date],
          )
        ).rowCount
      )
        throw new ToolError(
          'already_queued',
          'Patient already has a queue token. Review the visit before recording another payment.',
        );
      const charge = await addCharge.run(r, {
        patientId: a.patient_id,
        description: 'Consultation — QR check-in',
        amountPaise: a.amount_paise,
      });
      await recordPayment.run(r, {
        chargeId: charge.id,
        requestId: a.id,
        amountPaise: a.amount_paise,
        method: i.method,
      });
      const out = await checkInPatient.run(r, input);
      await r.db.query(
        "UPDATE qr_arrivals SET status='queued',queue_entry_id=$2,charge_id=$3,confirmed_by=$4,confirmed_at=now() WHERE id=$1",
        [
          a.id,
          out.queueEntryId,
          charge.id,
          r.ctx.actor.kind === 'staff' ? r.ctx.actor.userId : null,
        ],
      );
      return { ok: true, token: out.token };
    },
  }),
  defineTool({
    name: 'cancel_qr_arrival',
    module: 'core',
    description: 'Cancel an unpaid QR arrival without changing any payment.',
    allow: CARE,
    input: z.object({ id }),
    async run(r, i) {
      if (
        !(
          await r.db.query(
            "UPDATE qr_arrivals SET status='cancelled' WHERE id=$1 AND status='awaiting_payment' RETURNING id",
            [i.id],
          )
        ).rowCount
      )
        throw new ToolError('not_found', 'Unpaid arrival not found', 404);
      r.emit({ type: 'queue_changed' });
      return { ok: true };
    },
  }),
];
