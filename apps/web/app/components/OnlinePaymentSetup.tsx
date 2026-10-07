'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
export function OnlinePaymentSetup() {
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
    <section className="card">
      <h2>Online payments — Razorpay</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {setup && (
        <>
          <p>
            <strong>
              {setup.enabled ? 'Online checkout enabled' : 'Online checkout paused'} ·{' '}
              {setup.mode === 'live' ? 'Real payments' : 'Test payments'}
            </strong>
          </p>
          <p>{setup.message}</p>
          <p>
            After Razorpay confirms receipt, the patient automatically joins the doctor’s queue.
            Reception can still record cash for check-ins where online payment has not started.
          </p>
          <p>
            In Razorpay, subscribe to payment.captured, order.paid and refund.processed at your
            public API address followed by <code>{setup.webhookPath}</code>. Enable automatic
            capture in Razorpay.
          </p>
          {!setup.enabled && (
            <label className="check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I checked the payment account, capture settings and webhook.{' '}
              {setup.mode === 'live'
                ? 'Patients will be charged real money; provider fees apply.'
                : 'Only test payments will be made.'}
            </label>
          )}
          <p>
            <button
              disabled={busy || (!setup.enabled && (!setup.configured || !accepted))}
              onClick={() =>
                void run(() => staff('/staff/payments/setup', { enabled: !setup.enabled }, 'PUT'))
              }
            >
              {setup.enabled ? 'Pause new online payments' : 'Enable online checkout'}
            </button>{' '}
            <button className="ghost" disabled={busy} onClick={() => void run(load)}>
              Refresh payment setup
            </button>
          </p>
          <p>
            Keys stay on the server. This screen never asks patients for card details. A pause stops
            new checkouts; payments already in progress can still complete.
          </p>
        </>
      )}
      <h3>Payment activity</h3>
      {!orders.length && <p>No online payment attempts yet.</p>}
      {orders.map((o) => (
        <div className="card" key={o.id}>
          <p>
            <strong>₹{(o.amount_paise / 100).toFixed(2)}</strong> {o.test_mode && '(Test payment)'}{' '}
            ·{' '}
            {o.state === 'captured'
              ? 'Verified and queued'
              : o.state === 'review'
                ? 'Staff review needed'
                : o.state === 'ready'
                  ? 'Awaiting payment'
                  : o.state === 'unknown'
                    ? 'Confirmation unavailable'
                    : 'Preparing payment'}
          </p>
          <p className="muted">
            Receipt {o.id} · {new Date(o.created_at).toLocaleString()}
          </p>
          {o.detail && <p>{o.detail}</p>}
          {o.provider_payment_id && <p>Payment reference: {o.provider_payment_id}</p>}
          {o.verified_at && <p>Verified: {new Date(o.verified_at).toLocaleString()}</p>}
          {o.provider_order_id ? (
            <button
              disabled={busy}
              className="ghost"
              onClick={() => void run(() => staff(`/staff/payments/${o.id}/refresh`, {}))}
            >
              Check provider status
            </button>
          ) : (
            <>
              <label>
                Order reference from Razorpay
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
              >
                Verify and link this order
              </button>
              <p>
                Find the matching receipt in Razorpay first. Linking an order does not initiate
                another charge.
              </p>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
