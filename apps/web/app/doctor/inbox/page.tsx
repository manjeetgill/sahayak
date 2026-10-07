'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useLive, useSession } from '../../../lib/api';

export default function Inbox() {
  const session = useSession('doctor');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('all'),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<any>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await staff(`/staff/inbox?page=${page}&view=${view}&category=${filter}`));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, [page, view, filter]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);
  useLive(session ? `/ws?token=${session.token}` : null, (event) => {
    if (['flag_raised', 'flag_resolved', 'conversation_updated'].includes(event.type)) void load();
  });
  const review = async (key: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError('');
    try {
      await staff('/staff/workbench/inbox-review', { key, action, ...extra });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [session, load]);
  const openConversation = async (item: any) => {
    setLoadingThread(true);
    setThread(null);
    try {
      setThread({ item, ...(await staff(`/staff/inbox/conversations/${item.conversation_id}`)) });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingThread(false);
    }
  };
  if (!session) return null;
  return (
    <main className="wrap attention-page" style={{ maxWidth: 960 }}>
      <a href="/doctor">← Today’s clinic</a>
      <h1>Needs my attention</h1>
      <p>
        Open alerts, reports and care tasks across your clinic, plus your own unsigned drafts.
        Priorities use recorded urgency and due dates.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="ghost" onClick={() => void load()}>
        Refresh list
      </button>
      {!data && !error && <p role="status">Loading clinic work…</p>}
      {data && (
        <>
          <p role="status">
            <b>{data.total} outstanding items</b> · {data.urgent} urgent · {data.overdue} overdue
          </p>
          {data.urgent > 0 && (
            <p className="banner urgent">
              {data.urgent} urgent conversation(s) need review.{' '}
              <button
                onClick={() => {
                  setView('all');
                  setPage(0);
                  setFilter('urgent');
                }}
              >
                Show urgent items
              </button>
            </p>
          )}
          <div className="attention-filters">
            <label>
              Work list
              <select
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All clinic work</option>
                <option value="mine">Assigned to me</option>
                <option value="later">Remind me later ({data.later})</option>
              </select>
            </label>
            <label>
              Show{' '}
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">All outstanding work</option>
                <option value="checkin">Patient check-ins</option>
                <option value="urgent">Urgent alerts</option>
                <option value="task">Care tasks</option>
                <option value="result">Test results needing review</option>
                <option value="insurance">Insurance paperwork</option>
                <option value="followup">Follow-up plans</option>
                <option value="report">New reports and photos</option>
                <option value="draft">My unsigned drafts</option>
                <option value="messages">Patient messages and alerts</option>
              </select>
            </label>
          </div>
          {data.total > data.items.length && (
            <p>
              Showing page {page + 1}, with up to 50 items. Category filters apply across all
              recorded work.
            </p>
          )}
          {data.total === 0 && (
            <p>No outstanding items recorded. New work will appear here as it arrives.</p>
          )}
          {data.items.map((i: any) => (
            <article
              className={`card attention-card priority-${i.priority}`}
              key={i.key}
              style={{ marginTop: 12 }}
              data-testid="inbox-item"
            >
              <span className="tag">
                {i.priority === 0
                  ? 'Urgent'
                  : i.priority === 1
                    ? 'Overdue'
                    : i.priority === 3
                      ? 'Waiting for completion'
                      : 'Needs review'}
              </span>
              <h2>{i.title}</h2>
              <p>
                <b>{i.patient_name || 'Patient not yet identified'}</b>
              </p>
              <p>{i.reason}</p>
              {i.alerts.map((a: any) => (
                <p key={a.id}>{a.summary}</p>
              ))}
              <p className="muted">
                {i.review?.assigned_name
                  ? `Inbox owner: ${i.review.assigned_name}`
                  : i.assignee
                    ? `Responsible: ${i.assignee}`
                    : 'No responsible person recorded'}{' '}
                · Added {new Date(i.happened_at).toLocaleString()}
                {i.due_at && <> · Due {new Date(i.due_at).toLocaleString()}</>}
              </p>
              <p>
                {i.review?.acknowledged_at
                  ? `Acknowledged ${new Date(i.review.acknowledged_at).toLocaleString()}`
                  : i.priority === 0 && Date.now() - Date.parse(i.happened_at) > 15 * 60000
                    ? 'Urgent alert awaiting acknowledgement for over 15 minutes.'
                    : 'Not yet acknowledged'}
              </p>
              <fieldset disabled={busy}>
                <legend>Who will handle this?</legend>
                <select
                  aria-label="Assign inbox owner"
                  value={i.review?.assigned_to ?? ''}
                  onChange={(e) => review(i.key, 'assign', { assignedTo: e.target.value })}
                >
                  <option value="" disabled>
                    Choose doctor
                  </option>
                  {data.staff.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <button onClick={() => review(i.key, 'acknowledge')}>Acknowledge</button>{' '}
                {view === 'later' ? (
                  <button onClick={() => review(i.key, 'restore')}>Bring back now</button>
                ) : (
                  <button
                    disabled={i.priority === 0}
                    title={i.priority === 0 ? 'Urgent alerts stay visible' : ''}
                    onClick={() =>
                      review(i.key, 'later', {
                        until: new Date(Date.now() + 86400000).toISOString(),
                      })
                    }
                  >
                    Remind me tomorrow
                  </button>
                )}
                {['alert', 'conversation'].includes(i.kind) && (
                  <button
                    onClick={() => {
                      const reason = prompt(
                        'What action did you take? Record why this item is handled.',
                      );
                      if (reason?.trim()) void review(i.key, 'handled', { reason });
                    }}
                  >
                    Mark handled
                  </button>
                )}
              </fieldset>
              <div className="row">
                {i.path && <a href={i.path}>Review the original record</a>}
                {i.conversation_id && (
                  <button disabled={loadingThread} onClick={() => void openConversation(i)}>
                    Read conversation
                  </button>
                )}
                {i.patient_id && <a href={`/doctor/patients/${i.patient_id}`}>Open patient</a>}
              </div>
            </article>
          ))}
          <p>
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous page
            </button>{' '}
            <button disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>
              Next page
            </button>
          </p>
          <p className="muted">
            Finish the work in its original record, then refresh this list. Reading an item does not
            mark it handled.
          </p>
        </>
      )}
      {loadingThread && <p role="status">Opening conversation…</p>}
      {thread && (
        <section className="card" aria-label="Source conversation" style={{ marginTop: 20 }}>
          <h2>Conversation: {thread.item.patient_name || 'Unregistered patient'}</h2>
          <p>
            Latest 100 messages. Your reception team handles replies. Reading here does not close
            the alert.
          </p>
          <button onClick={() => setThread(null)}>Close conversation</button>
          {thread.messages.length === 0 && <p>No messages recorded.</p>}
          {thread.messages.map((m: any, n: number) => (
            <p key={n}>
              <b>{m.direction === 'in' ? 'Patient' : 'Clinic'}</b> ·{' '}
              {new Date(m.created_at).toLocaleString()}
              <br />
              {m.body}
            </p>
          ))}
        </section>
      )}
    </main>
  );
}
