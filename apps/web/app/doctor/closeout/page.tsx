'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';

type Closeout = {
  clinicDate: string;
  counts: { queueOpen: number; urgentAlerts: number; unsignedNotes: number;
    unsignedDocuments: number; paymentProblems: number; careDue: number;
    messagesWaiting: number; tomorrowBooked: number };
  reviewedAt: string | null;
};
export default function Closeout() {
  const session = useSession('doctor');
  const { lang, x } = useStaffLang();
  const [data, setData] = useState<Closeout | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => staff<Closeout>('/staff/solo/closeout').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => { if (session) void load(); }, [session, load]);
  if (!session) return null;
  const items = data ? [
    ['Patients still in the queue', data.counts.queueOpen, '/doctor'],
    ['Urgent patient alerts', data.counts.urgentAlerts, '/doctor/inbox?category=urgent'],
    ['Messages awaiting your reply', data.counts.messagesWaiting, '/doctor/inbox?category=messages'],
    ['Unsigned visit notes', data.counts.unsignedNotes, '/doctor/inbox?category=draft'],
    ['Unsigned patient documents', data.counts.unsignedDocuments, '/doctor/inbox?category=draft'],
    ['Payments needing checking', data.counts.paymentProblems, '/console/arrivals'],
    ['Care follow-through due', data.counts.careDue, '/doctor/care'],
    ['Tomorrow’s appointments', data.counts.tomorrowBooked, '/doctor'],
  ] as const : [];
  const open = items.slice(0, 7).reduce((total, item) => total + item[1], 0);
  return <main className="wrap" style={{ maxWidth: 800 }}>
    <a href="/doctor">← {x('Today')}</a>
    <h1>{x('Close out your day')}</h1>
    <p>{x('Review what still needs attention before leaving. This checklist records your review; it does not close patients’ tasks or mark messages as answered.')}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!data && !error && <p>{x('Loading today’s work…')}</p>}
    {data && <>
      <p className="muted">{x('Clinic day:')} {data.clinicDate}{data.reviewedAt ? ` · ${x('Last reviewed')} ${new Date(data.reviewedAt).toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN')}` : ''}</p>
      <div className="card">
        {items.map(([label, count, href]) => <div className="row between" key={label} style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
          <span>{x(label)}</span><span><b>{count}</b> · <a href={href}>{x('Open')}</a></span>
        </div>)}
      </div>
      <p>{open ? `${open} ${x('open items remain. You can review the day while keeping them visible for follow-up.')}` : x('No open work was found in these categories.')}</p>
      <button disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void staff<Closeout>('/staff/solo/closeout', { acknowledged: true })
          .then(setData).catch((e) => setError(e.message)).finally(() => setBusy(false));
      }}>{x('I reviewed today’s work')}</button>{' '}
      <button className="ghost" onClick={() => void load()}>{x('Refresh counts')}</button>
    </>}
  </main>;
}
