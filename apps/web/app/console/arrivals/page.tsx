'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useLive, useSession } from '../../../lib/api';
export default function Arrivals() {
  const s = useSession('receptionist');
  const [rows, setRows] = useState<any[]>([]),
    [settings, setSettings] = useState<any>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [methods, setMethods] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const load = useCallback(() => staff('/staff/qr-arrivals').then((r) => setRows(r.arrivals)), []);
  useEffect(() => {
    if (!s) return;
    void load().catch((e) => setError(e.message));
    void staff('/staff/qr-settings')
      .then(setSettings)
      .catch((e) => setError(e.message));
    const t = setInterval(() => void load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [s, load]);
  useLive(s ? `/ws?token=${s.token}` : null, () => void load().catch(() => {}));
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await fn();
      setMessage(
        r.token ? `Payment recorded. Token ${r.token} added to the doctor’s queue.` : 'Updated.',
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!s) return null;
  return (
    <div className="wrap">
      <p className="eyebrow">RECEPTION</p>
      <h1>QR arrivals &amp; payments</h1>
      <p>
        Check the payment in your cash drawer, UPI app, or card terminal before confirming. A
        patient saying “paid” does not confirm payment.
      </p>
      {settings && (
        <p>
          <a href={`/c/${settings.slug}/poster`} target="_blank" rel="noreferrer">
            Open reception QR poster
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button className="ghost" onClick={() => void load().catch((e) => setError(e.message))}>
        Refresh arrivals
      </button>
      {!rows.length && <p>No QR arrivals today.</p>}
      {rows.map((a) => (
        <section className="card" key={a.id}>
          <h2>{a.name}</h2>
          <p>
            {a.phone} · {a.doctor} · Reference {a.id.slice(0, 8).toUpperCase()}
          </p>
          <p>
            Consultation fee: <strong>₹{(a.amount_paise / 100).toFixed(2)}</strong>
          </p>
          {a.online_state && (
            <p>
              Online payment:{' '}
              {a.online_state === 'review'
                ? 'Staff review needed — do not take another payment'
                : a.online_state === 'captured'
                  ? 'Verified by Razorpay'
                  : 'In progress — check with the setup team before taking another payment'}
            </p>
          )}
          {a.status === 'awaiting_payment' &&
          !a.online_state &&
          new Date(a.expires_at) > new Date() ? (
            <>
              <p>Details received — waiting for payment confirmation</p>
              <label htmlFor={`method-${a.id}`}>Payment method</label>
              <select
                id={`method-${a.id}`}
                value={methods[a.id] ?? 'cash'}
                onChange={(e) => setMethods({ ...methods, [a.id]: e.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed[a.id] ?? false}
                  onChange={(e) => setConfirmed({ ...confirmed, [a.id]: e.target.checked })}
                />
                I verified that ₹{(a.amount_paise / 100).toFixed(2)} was received for this patient.
              </label>
              <p>
                <button
                  disabled={busy || !confirmed[a.id]}
                  onClick={() =>
                    void act(() =>
                      staff(`/staff/qr-arrivals/${a.id}/confirm`, {
                        method: methods[a.id] ?? 'cash',
                        confirmed: true,
                      }),
                    )
                  }
                >
                  Confirm payment &amp; add to queue
                </button>{' '}
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => void act(() => staff(`/staff/qr-arrivals/${a.id}/cancel`, {}))}
                >
                  Cancel unpaid check-in
                </button>
              </p>
            </>
          ) : (
            <p>
              {a.status === 'queued'
                ? `${a.paid_paise >= a.amount_paise ? 'Payment recorded' : 'Payment needs review'} · Token ${a.token_number} · ${a.visit_status === 'done' ? 'Consultation complete' : a.visit_status === 'called' || a.visit_status === 'in_consultation' ? 'Doctor is ready' : 'In the queue'}`
                : a.status === 'cancelled'
                  ? 'Cancelled'
                  : a.online_state
                    ? 'Online payment pending or under review.'
                    : 'Expired — cancel this unpaid check-in before the patient tries again'}
            </p>
          )}
          {a.status === 'awaiting_payment' && new Date(a.expires_at) <= new Date() && (
            <button
              disabled={busy}
              onClick={() => void act(() => staff(`/staff/qr-arrivals/${a.id}/cancel`, {}))}
            >
              Cancel expired check-in
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
