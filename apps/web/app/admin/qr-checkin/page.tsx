'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { staff } from '../../../lib/api';
export default function QrSetup() {
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
      <p className="eyebrow">ADMIN</p>
      <h1>Scan, pay at reception, join the queue</h1>
      <p>
        Patients scan the clinic QR and enter their details. Reception confirms payment received;
        Sahayak records it and adds the patient to the doctor’s queue.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && (
        <form
          className="card"
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
              setMessage('Saved. Your QR check-in settings are ready.');
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={data.enabled}
              onChange={(e) => setData({ ...data, enabled: e.target.checked })}
            />
            Enable QR check-in with payment confirmation
          </label>
          <label htmlFor="qr-fee">Consultation fee (₹)</label>
          <input
            id="qr-fee"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label htmlFor="qr-origin">Address patients can open on their phones</label>
          <input
            id="qr-origin"
            type="url"
            placeholder="https://clinic.example.com"
            value={data.publicWebUrl}
            onChange={(e) => setData({ ...data, publicWebUrl: e.target.value })}
          />
          <p className="muted">
            Use your public clinic address, or this server’s Wi-Fi address for a local test.
            “localhost” only works on this computer.
          </p>
          <p>
            Payment is confirmed by reception after checking cash, UPI, or card payment. Scanning
            this QR does not collect money or verify a bank transfer.
          </p>
          <button disabled={busy}>Save QR settings</button>
        </form>
      )}
      {data && (
        <section className="card">
          <h2>Clinic QR</h2>
          {url ? (
            <>
              <QRCodeSVG value={url} size={240} />
              <p>
                <a href={url}>{url}</a>
              </p>
            </>
          ) : (
            <p>Save an address reachable from the patient’s phone to create a usable QR.</p>
          )}
          <p>
            <a href={`/c/${data.slug}/poster`}>Open printable reception poster</a>
          </p>
          <p>
            <a href={`/c/${data.slug}/arrival`}>Preview patient check-in on this computer</a>
          </p>
        </section>
      )}
    </div>
  );
}
