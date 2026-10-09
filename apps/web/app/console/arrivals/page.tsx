'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useLive, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';
export default function Arrivals() {
  const s = useSession();
  const { x } = useStaffLang();
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
        r.token ? `${x('Payment recorded. Token')} ${r.token} ${x('added to the doctor’s queue.')}` : x('Updated.'),
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
      <p className="eyebrow">{x('PATIENT ARRIVALS')}</p>
      <h1>{x('QR arrivals & payments')}</h1>
      <p>
        {x('Check the payment in your cash drawer, UPI app, or card terminal before confirming. A patient saying “paid” does not confirm payment.')}
      </p>
      {settings && (
        <p>
          <a href={`/c/${settings.slug}/poster`} target="_blank" rel="noreferrer">
            {x('Open reception QR poster')}
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
        {x('Refresh arrivals')}
      </button>
      {!rows.length && <p>{x('No QR arrivals today.')}</p>}
      {rows.map((a) => (
        <section className="card" key={a.id}>
          <h2>{a.name}</h2>
          <p>
            {a.phone} · {a.doctor} · {x('Reference')} {a.id.slice(0, 8).toUpperCase()}
          </p>
          <p>
            {x('Consultation fee:')} <strong>₹{(a.amount_paise / 100).toFixed(2)}</strong>
          </p>
          {a.online_state && (
            <p>
              {x('Online payment:')}{' '}
              {a.online_state === 'review'
                ? x('Staff review needed — do not take another payment')
                : a.online_state === 'captured'
                  ? x('Verified by Razorpay')
                  : x('In progress — check with the setup team before taking another payment')}
            </p>
          )}
          {a.status === 'awaiting_payment' &&
          !a.online_state &&
          new Date(a.expires_at) > new Date() ? (
            <>
              <p>{x('Details received — waiting for payment confirmation')}</p>
              <label htmlFor={`method-${a.id}`}>{x('Payment method')}</label>
              <select
                id={`method-${a.id}`}
                value={methods[a.id] ?? 'cash'}
                onChange={(e) => setMethods({ ...methods, [a.id]: e.target.value })}
              >
                <option value="cash">{x('Cash')}</option>
                <option value="upi">{x("UPI")}</option>
                <option value="card">{x('Card')}</option>
                <option value="bank">{x('Bank transfer')}</option>
                <option value="other">{x('Other')}</option>
              </select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed[a.id] ?? false}
                  onChange={(e) => setConfirmed({ ...confirmed, [a.id]: e.target.checked })}
                />
                {x('I verified that')} ₹{(a.amount_paise / 100).toFixed(2)} {x('was received for this patient.')}
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
                  {x('Confirm payment & add to queue')}
                </button>{' '}
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => void act(() => staff(`/staff/qr-arrivals/${a.id}/cancel`, {}))}
                >
                  {x('Cancel unpaid check-in')}
                </button>
              </p>
            </>
          ) : (
            <p>
              {a.status === 'queued'
                ? `${x(a.paid_paise >= a.amount_paise ? 'Payment recorded' : 'Payment needs review')} · ${x('Token')} ${a.token_number} · ${x(a.visit_status === 'done' ? 'Consultation complete' : a.visit_status === 'called' || a.visit_status === 'in_consultation' ? 'Doctor is ready' : 'In the queue')}`
                : a.status === 'cancelled'
                  ? x('Cancelled')
                  : a.online_state
                    ? x('Online payment pending or under review.')
                    : x('Expired — cancel this unpaid check-in before the patient tries again')}
            </p>
          )}
          {a.status === 'awaiting_payment' && new Date(a.expires_at) <= new Date() && (
            <button
              disabled={busy}
              onClick={() => void act(() => staff(`/staff/qr-arrivals/${a.id}/cancel`, {}))}
            >
              {x('Cancel expired check-in')}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
