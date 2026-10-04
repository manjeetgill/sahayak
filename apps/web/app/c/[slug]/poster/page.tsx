'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { t } from '@sahayak/shared';
import { api } from '../../../../lib/api';

/** Printable A4 poster for the reception desk: scan to check in, in English and Hindi. */
export default function Poster({ params }: { params: { slug: string } }) {
  const [clinic, setClinic] = useState(''),
    [url, setUrl] = useState('');
  useEffect(() => {
    api(`/public/${params.slug}`)
      .then((i) => setClinic(i.clinic))
      .catch(() => {});
    setUrl(`${location.origin}/c/${params.slug}/checkin`);
  }, [params.slug]);
  return (
    <div
      style={{
        background: '#fff',
        minHeight: '100vh',
        padding: '2.5rem',
        textAlign: 'center',
        color: '#111',
      }}
    >
      <style>{'@media print { .noprint { display: none } @page { margin: 12mm } }'}</style>
      <h1 style={{ fontSize: '2.6rem', margin: 0 }}>{clinic}</h1>
      <p style={{ fontSize: '1.6rem', margin: '1.5rem 0 .2rem' }}>{t('en', 'tv.scan')}</p>
      <p style={{ fontSize: '1.6rem', margin: '0 0 1.5rem' }}>{t('hi', 'tv.scan')}</p>
      {url && <QRCodeSVG value={url} size={360} />}
      <p style={{ fontSize: '1.1rem', marginTop: '1.2rem' }}>
        {t('en', 'checkin.title', { clinic })}
      </p>
      <p style={{ color: '#555', wordBreak: 'break-all' }}>{url}</p>
      <p className="noprint">
        <button onClick={() => window.print()} style={{ fontSize: '1.1rem' }}>
          Print this poster
        </button>
      </p>
    </div>
  );
}
