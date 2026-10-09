'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function AttentionSummary({ solo = false }: { solo?: boolean }) {
  const { x } = useStaffLang();
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
  // Nothing to do: one calm line, with the detail one click away, so it does not push the patient down the page.
  if (data && data.total === 0 && !error) {
    return (
      <section className="card attention-summary attention-clear">
        <div className="panel-heading">
          <p>
            <b>{x('Nothing needs your attention.')}</b>{' '}
            <span className="muted">{x('No outstanding work. New items will appear here.')}</span>
          </p>
          <a href="/doctor/inbox">{x('View all')} 0</a>
        </div>
        {brief && (
          <details className="attention-detail">
            <summary>{x('Care to follow through')}</summary>
            <p>
              {brief.followups} {x('follow-up steps due within 24 hours or overdue')} · {brief.no_reply}{' '}
              {x('overdue replies')} · {brief.messages} {x('staff conversations needing a reply')}
            </p>
            <p>
              {brief.investigations} {x('outstanding report tasks')} · {brief.referrals} {x('referrals')} ·{' '}
              {brief.insurance} {x('insurance cases')} · {brief.outside_range} {x('results outside supplied ranges awaiting review')}
            </p>
          </details>
        )}
      </section>
    );
  }
  return (
    <section className="card attention-summary">
      <div className="panel-heading">
        <div>
          <h2>{x(solo ? 'Needs me' : 'Needs your attention')}</h2>
          <p className="muted">{x('Ordered by urgency and due time')}</p>
        </div>
        <a href="/doctor/inbox">{x('View all')}{data ? ` ${data.total}` : ''}</a>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : data ? (
        <p>
          <b>{data.urgent} {x('urgent')}</b> · {data.overdue} {x('overdue')} · {data.total} {x('outstanding items')}
        </p>
      ) : (
        <p>{x('Loading outstanding work…')}</p>
      )}
      {data?.items?.slice(0, solo ? 5 : 3).map((item: any) => (
        <div className={`prototype-task-row priority-${item.priority}`} key={item.key}>
          <span className="task-signal" />
          <div>
            <strong>{item.title}</strong>
            <small>
              {item.patient_name || x('Patient not yet identified')} · {item.reason}
            </small>
          </div>
          <a className="button-link" href={item.path || '/doctor/inbox'}>
            {x('Review')}
          </a>
        </div>
      ))}
      {data?.total === 0 && (
        <p className="muted">{x('No outstanding work. New items will appear here.')}</p>
      )}
      {brief && (
        <details className="attention-detail">
          <summary>{x('Care to follow through')}</summary>
          <p>
            {brief.followups} {x('follow-up steps due within 24 hours or overdue')} · {brief.no_reply}{' '}
            {x('overdue replies')} · {brief.messages} {x('staff conversations needing a reply')}
          </p>
          <p>
            {brief.investigations} {x('outstanding report tasks')} · {brief.referrals} {x('referrals')} ·{' '}
            {brief.insurance} {x('insurance cases')} · {brief.outside_range} {x('results outside supplied ranges awaiting review')}
          </p>
          <p>
            {brief.references_due} {x('clinic references due for another review. Counts describe recorded work and may overlap.')}
          </p>
        </details>
      )}

      <button className="ghost small" onClick={() => void load()}>
        {x('Refresh counts')}
      </button>
    </section>
  );
}
