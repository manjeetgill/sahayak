'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { t } from '@sahayak/shared';
import { api } from '../../../../lib/api';

/** Printable A4 poster for the reception desk: scan to check in, in English and Hindi. */
export default function Poster({ params }: { params: { slug: string } }) {
  const [clinic, setClinic] = useState(''),
    [url, setUrl] = useState('');
  const [payment, setPayment] = useState(false);
  const [online, setOnline] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    api(`/public/${params.slug}`)
      .then((i) => setClinic(i.clinic))
      .catch(() => {});
    api(`/public/${params.slug}/arrival/setup`)
      .then((s) => {
        const base = s.publicWebUrl || location.origin;
        setPayment(s.enabled);
        setOnline(s.onlinePaymentEnabled);
        setUrl(`${base}/c/${params.slug}/${s.enabled ? 'arrival' : 'checkin'}`);
        setUnreachable(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
      })
      .catch(() => setUnreachable(true));
  }, [params.slug]);
  return (
    <div
      className="checkin-poster"
      style={{
        background: '#fff',
        minHeight: '100vh',
        padding: '2.5rem',
        textAlign: 'center',
        color: '#111',
      }}
    >
      <style>{'@media print { .noprint { display: none } @page { margin: 12mm } }'}</style>
      <div className="poster-sheet">
        <h1 style={{ fontSize: '2.6rem', margin: 0 }}>{clinic}</h1>
        <p style={{ fontSize: '1.6rem', margin: '1.5rem 0 .2rem' }}>{t('en', 'tv.scan')}</p>
        <p style={{ fontSize: '1.6rem', margin: '0 0 1.5rem' }}>{t('hi', 'tv.scan')}</p>
        {url && !unreachable && (
          <QRCodeSVG value={url} size={360} style={{ maxWidth: '100%', height: 'auto' }} />
        )}
        {unreachable && (
          <p className="error">
            This address only works on this computer. Ask your admin to save a phone-accessible
            address under Patient check-in QR before printing.
            <br />
            यह पता केवल इस कंप्यूटर पर चलता है। पोस्टर छापने से पहले एडमिन से मरीज़ चेक-इन QR में फ़ोन से खुलने वाला पता सहेजने को कहें।
          </p>
        )}
        {payment && (
          <p>
            Scan → enter your details → {online ? 'pay online or at reception' : 'pay at reception'}{' '}
            → receive your queue token.
            <br />
            स्कैन करें → जानकारी दें → {online ? 'ऑनलाइन या रिसेप्शन पर भुगतान करें' : 'रिसेप्शन पर भुगतान करें'} → टोकन पाएं।
          </p>
        )}
        <p style={{ fontSize: '1.1rem', marginTop: '1.2rem' }}>
          {t('en', 'checkin.title', { clinic })}
        </p>
        <p style={{ color: '#555', wordBreak: 'break-all' }}>{url}</p>
        <p className="noprint">
          <button
            disabled={unreachable || !url}
            onClick={() => window.print()}
            style={{ fontSize: '1.1rem' }}
          >
            Print this poster / पोस्टर छापें
          </button>
        </p>
      </div>
    </div>
  );
}
