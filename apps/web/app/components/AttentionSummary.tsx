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
    <section className="card attention-summary">
      <div className="panel-heading">
        <div>
          <h2>Needs your attention</h2>
          <p className="muted">Ordered by urgency and due time</p>
        </div>
        <a href="/doctor/inbox">View all{data ? ` ${data.total}` : ''}</a>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : data ? (
        <p>
          <b>{data.urgent} urgent</b> · {data.overdue} overdue · {data.total} outstanding items
        </p>
      ) : (
        <p>Loading outstanding work…</p>
      )}
      {data?.items?.slice(0, 3).map((item: any) => (
        <div className={`prototype-task-row priority-${item.priority}`} key={item.key}>
          <span className="task-signal" />
          <div>
            <strong>{item.title}</strong>
            <small>
              {item.patient_name || 'Patient not yet identified'} · {item.reason}
            </small>
          </div>
          <a className="button-link" href={item.path || '/doctor/inbox'}>
            Review
          </a>
        </div>
      ))}
      {data?.total === 0 && (
        <p className="muted">No outstanding work. New items will appear here.</p>
      )}
      {brief && (
        <details className="attention-detail">
          <summary>Care to follow through</summary>
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
        </details>
      )}

      <button className="ghost small" onClick={() => void load()}>
        Refresh counts
      </button>
    </section>
  );
}
