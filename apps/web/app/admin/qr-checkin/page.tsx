'use client';
import { useEffect, useState } from 'react';
import { OnlinePaymentSetup } from '../../components/OnlinePaymentSetup';
import { QRCodeSVG } from 'qrcode.react';
import { staff } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';
export default function QrSetup() {
  const { x } = useStaffLang();
  const [data, setData] = useState<any>(null),
    [amount, setAmount] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    staff('/staff/qr-settings')
      .then((d) => {
        setData(d);
        setAmount(String(d.amountPaise / 100));
      })
      .catch((e) => setError(e.message));
  }, []);
  const url = data?.publicWebUrl ? `${data.publicWebUrl}/c/${data.slug}/arrival` : '';
  return (
    <div className="wrap">
      <p className="eyebrow">{x("ADMIN")}</p>
      <h1>{x("Payments & patient check-in")}</h1>
      <p>{x("Choose how your clinic collects consultation fees. Patients scan the clinic QR, enter their details, and pay online when enabled or at reception. A confirmed payment adds them to the doctor’s queue.")}</p>
      <nav
        className="row"
        aria-label={x('Payment setup sections')}
        style={{ flexWrap: 'wrap', marginBottom: 20 }}
      >
        <a href="#consultation-fee">{x("Consultation fee")}</a>
        <a href="#online-payments">{x("Online payments")}</a>
        <a href="#payment-activity">{x("Payment activity")}</a>
        <a href="#clinic-qr">{x("Clinic QR")}</a>
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <form
          className="card"
          id="consultation-fee"
          style={{ scrollMarginTop: 90 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              await staff(
                '/staff/qr-settings',
                {
                  enabled: data.enabled,
                  amountPaise: Math.round(Number(amount) * 100),
                  publicWebUrl: data.publicWebUrl,
                },
                'PUT',
              );
              setMessage(x('Saved. Your QR check-in settings are ready.'));
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>{x("Consultation fee & QR check-in")}</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            />
            {x('Enable QR check-in with payment confirmation')}
          </label>
          <label htmlFor="qr-fee">{x("Consultation fee (₹)")}</label>
          <input
            id="qr-fee"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label htmlFor="qr-origin">{x("Address patients can open on their phones")}</label>
          <input
            id="qr-origin"
            type="url"
            placeholder="https://clinic.example.com"
            value={data.publicWebUrl}
            onChange={(e) => setData({ ...data, publicWebUrl: e.target.value })}
          />
          <p className="muted">{x("Use your public clinic address, or this server’s Wi-Fi address for a local test. “localhost” only works on this computer.")}</p>
          <p>{x("For payments at reception, staff must check the cash, UPI, or card receipt before confirming. Online payments are verified through Razorpay when enabled below. Scanning the check-in QR alone does not confirm payment.")}</p>
          <button disabled={busy}>{x("Save QR settings")}</button>
        </form>
      )}
      <OnlinePaymentSetup />
      {data && (
        <section className="card" id="clinic-qr" style={{ scrollMarginTop: 90 }}>
          <h2>{x("Clinic QR")}</h2>
          {url ? (
            <>
              <QRCodeSVG value={url} size={240} />
              <p>
                <a href={url}>{url}</a>
              </p>
            </>
          ) : (
            <p>{x("Save an address reachable from the patient’s phone to create a usable QR.")}</p>
          )}
          <p>
            <a href={`/c/${data.slug}/poster`}>{x("Open printable reception poster")}</a>
          </p>
          <p>
            <a href={`/c/${data.slug}/arrival`}>{x("Preview patient check-in on this computer")}</a>
          </p>
        </section>
      )}
    </div>
  );
}
