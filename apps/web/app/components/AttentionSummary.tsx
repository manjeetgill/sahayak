'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';
export function AttentionSummary() {
  const [brief, setBrief] = useState<any>(null);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await staff('/staff/inbox'));
      setBrief(await staff('/staff/workbench/daily-brief', {}));
      setError('');
    } catch {
      setError('Could not load outstanding work. Open the inbox to try again.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <section className="card" style={{ margin: '1rem' }}>
      <h2>Needs my attention</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : data ? (
        <p>
          <b>{data.urgent} urgent</b> · {data.overdue} overdue · {data.total} outstanding items
        </p>
      ) : (
        <p>Loading outstanding work…</p>
      )}
      {brief && (
        <>
          <h3>Care to follow through</h3>
          <p>
            {brief.followups} follow-up steps due within 24 hours or overdue · {brief.no_reply}{' '}
            overdue replies · {brief.messages} staff conversations needing a reply
          </p>
          <p>
            {brief.investigations} outstanding report tasks · {brief.referrals} referrals ·{' '}
            {brief.insurance} insurance cases · {brief.outside_range} results outside supplied
            ranges awaiting review
          </p>
          <p>
            {brief.references_due} clinic references due for another review. Counts describe
            recorded work and may overlap.
          </p>
        </>
      )}
      <p>
        Clinic alerts, reports and care tasks, together with your unsigned drafts. Refreshes every
        30 seconds.
      </p>
      <a href="/doctor/inbox">Review outstanding work</a>{' '}
      <button className="ghost small" onClick={() => void load()}>
        Refresh counts
      </button>
    </section>
  );
}
