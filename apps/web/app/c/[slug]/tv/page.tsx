'use client';
import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { t } from '@sahayak/shared';
import { api, useLive } from '../../../../lib/api';

type Board = { clinic: string; doctors: { id: string; name: string; nowServing: number | null; next: number[]; waitingCount: number; estimatedWaitMinutes: number }[] };

export default function TV({ params }: { params: { slug: string } }) {
  const [b, setB] = useState<Board | null>(null);
  const [url, setUrl] = useState('');
  const load = useCallback(() => { api<Board>(`/public/${params.slug}/board`).then(setB).catch(() => {}); }, [params.slug]);
  useEffect(() => { load(); setUrl(`${location.origin}/c/${params.slug}/checkin`); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load, params.slug]);
  useLive(`/ws/public/${params.slug}`, (e) => { if (e.type === 'queue_changed') load(); });
  if (!b) return <div className="tv">…</div>;
  return (
    <div className="tv">
      <div className="row between"><h1>{b.clinic}</h1>
        <div className="row" style={{ gap: '1rem' }}>
          <div style={{ textAlign: 'right' }}><div>{t('en', 'tv.scan')}</div><div>{t('hi', 'tv.scan')}</div></div>
          {url && <div style={{ background: '#fff', padding: 8, borderRadius: 8 }}><QRCodeSVG value={url} size={110} /></div>}
        </div></div>
      <div className="tvgrid">
        {b.doctors.map((d) => (
          <div className="tvcard" key={d.id}>
            <h2>{d.name}</h2>
            <div>{t('en', 'tv.now_serving')} · {t('hi', 'tv.now_serving')}</div>
            <div className="tvnow" data-testid="now-serving">{d.nowServing ?? '–'}</div>
            <div style={{ margin: '1rem 0 .3rem' }}>{t('en', 'tv.next')} · {t('hi', 'tv.next')}</div>
            <div className="tvnext">{d.next.length ? d.next.map((n) => <span key={n}>{n}</span>) : <span>–</span>}</div>
            <p style={{ fontSize: '1.6rem', marginTop: '1rem' }}>{t('en', 'tv.wait')} / {t('hi', 'tv.wait')}: <b>{d.estimatedWaitMinutes}</b> {t('en', 'tv.minutes')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
