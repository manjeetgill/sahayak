'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function OnlinePaymentSetup() {
  const { x: ui } = useStaffLang();
  const [setup, setSetup] = useState<any>(null),
    [orders, setOrders] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [recovery, setRecovery] = useState<Record<string, string>>({});
  async function load() {
    const [s, h] = await Promise.all([staff('/staff/payments/setup'), staff('/staff/payments')]);
    setSetup(s);
    setOrders(h.orders);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" id="online-payments" style={{ scrollMarginTop: 90 }}>
      <h2>{ui("Online payments — Razorpay")}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {setup && (
        <>
          <p>
            <strong>
              {ui(setup.enabled ? 'Online checkout enabled' : 'Online checkout paused')} ·{' '}
              {ui(setup.mode === 'live' ? 'Real payments' : 'Test payments')}
            </strong>
          </p>
          <p>{ui(setup.message)}</p>
          <p>{ui("After Razorpay confirms receipt, the patient automatically joins the doctor’s queue. Reception can still record cash for check-ins where online payment has not started.")}</p>
          <p>
            {ui("In Razorpay, subscribe to payment.captured, order.paid and refund.processed at your public API address followed by")} <code>{setup.webhookPath}</code>{ui(". Enable automatic capture in Razorpay.")}
          </p>
          {!setup.enabled && (
            <label className="check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {ui("I checked the payment account, capture settings and webhook.")}{' '}
              {ui(setup.mode === 'live'
                ? 'Patients will be charged real money; provider fees apply.'
                : 'Only test payments will be made.')}
            </label>
          )}
          <p>
            <button
              disabled={busy || (!setup.enabled && (!setup.configured || !accepted))}
              onClick={() =>
                void run(() => staff('/staff/payments/setup', { enabled: !setup.enabled }, 'PUT'))
              }
            >
              {ui(setup.enabled ? 'Pause new online payments' : 'Enable online checkout')}
            </button>{' '}
            <button className="ghost" disabled={busy} onClick={() => void run(load)}>{ui("Refresh payment setup")}</button>
          </p>
          <p>{ui("Keys stay on the server. This screen never asks patients for card details. A pause stops new checkouts; payments already in progress can still complete.")}</p>
        </>
      )}
      <h3 id="payment-activity" style={{ scrollMarginTop: 90 }}>{ui("Payment activity")}</h3>
      {!orders.length && <p>{ui("No online payment attempts yet.")}</p>}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <p>
            <strong>₹{(o.amount_paise / 100).toFixed(2)}</strong> {o.test_mode && ui('(Test payment)')}{' '}
            ·{' '}
            {ui(o.state === 'captured'
              ? 'Verified and queued'
              : o.state === 'review'
                ? 'Staff review needed'
                : o.state === 'ready'
                  ? 'Awaiting payment'
                  : o.state === 'unknown'
                    ? 'Confirmation unavailable'
                    : 'Preparing payment')}
          </p>
          <p className="muted">
            {ui("Receipt")} {o.id} · {new Date(o.created_at).toLocaleString()}
          </p>
          {o.detail && <p>{o.detail}</p>}
          {o.provider_payment_id && <p>{ui("Payment reference:")} {o.provider_payment_id}</p>}
          {o.verified_at && <p>{ui("Verified:")} {new Date(o.verified_at).toLocaleString()}</p>}
          {o.provider_order_id ? (
            <button
              disabled={busy}
              className="ghost"
              onClick={() => void run(() => staff(`/staff/payments/${o.id}/refresh`, {}))}
            >{ui("Check provider status")}</button>
          ) : (
            <>
              <label>
                {ui("Order reference from Razorpay")}
                <input
                  value={recovery[o.id] ?? ''}
                  placeholder="order_…"
                  onChange={(e) => setRecovery({ ...recovery, [o.id]: e.target.value })}
                />
              </label>
              <button
                disabled={busy || !recovery[o.id]}
                onClick={() =>
                  void run(() =>
                    staff(`/staff/payments/${o.id}/recover`, { orderId: recovery[o.id] }),
                  )
                }
              >{ui("Verify and link this order")}</button>
              <p>{ui("Find the matching receipt in Razorpay first. Linking an order does not initiate another charge.")}</p>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
