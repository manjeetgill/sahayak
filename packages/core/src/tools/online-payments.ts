import { z } from 'zod';
import { defineTool, ToolError } from './registry';
import { checkInPatient, registerCheckinPatient } from './checkin';
import { clinicToday } from './common';

/** Only the API's authenticated provider verifier calls this; never browser/agent-supplied proof. */
export const settleQrPayment = defineTool({
  name: 'settle_qr_online_payment',
  module: 'core',
  description:
    'Record a server-verified captured gateway payment and join the queue when the arrival is still valid.',
  allow: ['system'],
  input: z
    .object({
      id: z.string().uuid(),
      keyId: z.string(),
      orderId: z.string(),
      paymentId: z.string(),
      amountPaise: z.number().int(),
      currency: z.literal('INR'),
      refundedPaise: z.number().int().min(0),
      method: z.enum(['upi', 'card', 'bank', 'other']),
    })
    .strict(),
  async run(r, i) {
    if (r.ctx.actor.kind !== 'system' || r.ctx.actor.name !== 'razorpay-verifier')
      throw new ToolError('forbidden', 'Provider verification required', 403);
    const order = (
      await r.db.query('SELECT * FROM qr_payment_orders WHERE id=$1 FOR UPDATE', [i.id])
    ).rows[0];
    if (
      !order ||
      order.key_id !== i.keyId ||
      order.provider_order_id !== i.orderId ||
      order.amount_paise !== i.amountPaise
    )
      throw new ToolError('payment_mismatch', 'Payment does not match this check-in.', 409);
    if (order.provider_payment_id && order.provider_payment_id !== i.paymentId)
      throw new ToolError(
        'payment_mismatch',
        'Another payment was already recorded for this order.',
        409,
      );
    if (order.verified_at && i.refundedPaise === 0)
      return { state: order.state, alreadyRecorded: true };
    const review = async (detail: string) => {
      await r.db.query(
        "UPDATE qr_payment_orders SET state='review',detail=$2,provider_payment_id=$3,verified_at=COALESCE(verified_at,now()),updated_at=now() WHERE id=$1",
        [i.id, detail, i.paymentId],
      );
      r.emit({ type: 'queue_changed' });
      return { state: 'review' };
    };
    if (i.refundedPaise > 0)
      return review(
        'The provider reports a refund. Reception must reconcile the payment record; no new queue token was issued.',
      );
    const a = (
      await r.db.query(
        "SELECT *,to_char(arrival_date,'YYYY-MM-DD') arrival_day FROM qr_arrivals WHERE id=$1 FOR UPDATE",
        [order.arrival_id],
      )
    ).rows[0];
    if (!a)
      return review(
        'Payment received for a removed check-in. Review the provider payment and arrange the next step.',
      );
    const p = (await r.db.query('SELECT * FROM patients WHERE id=$1', [a.patient_id])).rows[0];
    if (!p || p.erasure_requested_at || p.name === 'Erased patient')
      return review('Payment received for an unavailable patient record. Review with reception.');
    // Use null staff attribution for the verified gateway, never impersonate a doctor.
    const charge = (
      await r.db.query(
        "INSERT INTO clinic_charges(clinic_id,patient_id,description,amount_paise,created_by,is_test) VALUES($1,$2,'Consultation — online QR payment',$3,NULL,$4) RETURNING id",
        [r.ctx.clinicId, a.patient_id, i.amountPaise, i.keyId.startsWith('rzp_test_')],
      )
    ).rows[0];
    await r.db.query(
      "INSERT INTO clinic_payments(clinic_id,charge_id,request_id,amount_paise,method,recorded_by,source,provider_payment_id,is_test) VALUES($1,$2,$3,$4,$5,NULL,'razorpay',$6,$7)",
      [
        r.ctx.clinicId,
        charge.id,
        order.id,
        i.amountPaise,
        i.method,
        i.paymentId,
        i.keyId.startsWith('rzp_test_'),
      ],
    );
    await r.db.query('UPDATE qr_payment_orders SET charge_id=$2 WHERE id=$1', [i.id, charge.id]);
    const { date } = await clinicToday(r.db, r.ctx.clinicId);
    const doctor = (
      await r.db.query('SELECT id FROM doctors WHERE id=$1 AND active', [a.doctor_id])
    ).rowCount;
    const modules = (await r.db.query('SELECT modules FROM clinic_settings')).rows[0]?.modules;
    if (
      a.status !== 'awaiting_payment' ||
      a.arrival_day !== date ||
      new Date(a.expires_at) <= new Date() ||
      !doctor ||
      modules?.checkin === false
    ) {
      if (!a.charge_id)
        await r.db.query('UPDATE qr_arrivals SET charge_id=$2 WHERE id=$1', [a.id, charge.id]);
      return review(
        'Payment received, but this check-in is cancelled, expired or unavailable. Reception must arrange the visit or refund. Do not pay again.',
      );
    }
    const input = {
      phone: p.phone,
      name: p.name,
      language: p.language,
      doctorId: a.doctor_id,
      consent: { visit_data: false, whatsapp_messaging: false, reminders_followups: false },
    };
    await registerCheckinPatient(r, input);
    await r.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [r.ctx.clinicId + ':' + date]);
    const active = (
      await r.db.query(
        "SELECT doctor_id FROM queue_entries WHERE patient_id=$1 AND queue_date=$2 AND status IN ('waiting','called','in_consultation','on_hold')",
        [a.patient_id, date],
      )
    ).rows[0];
    if (active && active.doctor_id !== a.doctor_id) {
      await r.db.query('UPDATE qr_arrivals SET charge_id=$2 WHERE id=$1', [a.id, charge.id]);
      return review(
        'Payment received. The patient already has a visit with another doctor. Reception must review before issuing another token.',
      );
    }
    const result = await checkInPatient.run(r, input);
    await r.db.query(
      "UPDATE qr_arrivals SET status='queued',queue_entry_id=$2,charge_id=$3,confirmed_at=now() WHERE id=$1",
      [a.id, result.queueEntryId, charge.id],
    );
    await r.db.query(
      "UPDATE qr_payment_orders SET state='captured',provider_payment_id=$2,verified_at=now(),updated_at=now(),detail=NULL WHERE id=$1",
      [i.id, i.paymentId],
    );
    return { state: 'captured', token: result.token };
  },
});
