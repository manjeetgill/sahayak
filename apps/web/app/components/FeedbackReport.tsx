'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { feedbackLabel } from './FeedbackWorkspace';
export function FeedbackReport() {
  const [data, setData] = useState<any>(null),
    [team, setTeam] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''),
    [owner, setOwner] = useState(''),
    [due, setDue] = useState(''),
    [source, setSource] = useState('');
  const load = async () => {
    try {
      const [r, w] = await Promise.all([staff('/staff/feedback/report'), staff('/staff/feedback')]);
      setData(r);
      setTeam(w.staff);
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section>
      <h2>What patients are telling us</h2>
      <p>
        Last 30 days. These are patient-reported experiences, not clinical outcome measures or
        predictions about whether someone will return.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="feedback-metrics">
            {[
              [data.counts.scheduled, 'Check-ins scheduled'],
              [data.counts.contacted, 'Confirmed contact or delivery'],
              [data.counts.responded, 'Patient responses'],
              [data.counts.unresolved, 'Responses still open'],
            ].map(([v, l]) => (
              <div className="card" key={l}>
                <strong>{v}</strong>
                <p>{l}</p>
              </div>
            ))}
          </div>
          <p>
            {data.counts.responded} responses / {data.counts.scheduled} scheduled check-ins
            {data.counts.scheduled
              ? ` (${Math.round((100 * data.counts.responded) / data.counts.scheduled)}%)`
              : ''}
            . Links may be shared manually; a prepared link is not counted as confirmed delivery.
          </p>
          <p>
            Average time from response to recorded first contact:{' '}
            {data.counts.hours_to_contact === null
              ? 'Not enough recorded contacts'
              : `${data.counts.hours_to_contact} hours`}
            .
          </p>
          <h3>Repeated clinic feedback</h3>
          {!data.themes.length && <p>No service themes reported yet.</p>}
          {data.themes.map((t: any) => (
            <div className="card" key={t.theme}>
              <h4>
                {feedbackLabel(t.theme)} · {t.count}
              </h4>
              <p>Based on the topic patients selected.</p>
              <div className="feedback-actions">
                {t.sources.map((s: any) => (
                  <a key={s.id} href={`/doctor/checkins#case-${s.id}`}>
                    {s.patient} — original response
                  </a>
                ))}
              </div>
              <button
                className="ghost"
                onClick={() => {
                  setTitle(`Improve ${feedbackLabel(t.theme).toLowerCase()}`);
                  setSource(t.sources[0]?.id ?? '');
                }}
              >
                Create improvement from this feedback
              </button>
            </div>
          ))}
          <h3>Did our response help?</h3>
          {!data.resolutions.length ? (
            <p>No patient confirmations yet.</p>
          ) : (
            data.resolutions.map((r: any) => (
              <p key={r.answer}>
                {feedbackLabel(r.answer)}: {r.count}
              </p>
            ))
          )}
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await staff('/staff/feedback/improvements', {
                  title,
                  assignedTo: owner,
                  dueAt: new Date(due).toISOString(),
                  ...(source ? { sourceId: source } : {}),
                });
                setTitle('');
                setSource('');
                await load();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Make a clinic improvement</h3>
            <label>
              What will change?
              <input
                required
                minLength={3}
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <p className="muted">
              Describe a clinic process change. Keep patient details in the linked response.
            </p>
            <label>
              Responsible person
              <select required value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Choose staff</option>
                {team
                  .filter((u) => u.role !== 'admin')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Review date
              <input
                required
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <button disabled={busy}>Add improvement</button>
          </form>
          <h3>Improvement tasks</h3>
          {data.improvements.map((i: any) => (
            <article className="card" key={i.id}>
              <h4>{i.title}</h4>
              <p>
                {i.assignee} · Review {new Date(i.due_at).toLocaleString()} ·{' '}
                {i.status === 'done'
                  ? 'Completed'
                  : new Date(i.due_at) < new Date()
                    ? 'Overdue'
                    : 'Open'}
              </p>
              {i.source_checkin_id && (
                <a href={`/doctor/checkins#case-${i.source_checkin_id}`}>Original feedback</a>
              )}
              {i.status === 'open' && (
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await staff('/staff/feedback/improvements', {
                        id: i.id,
                        title: i.title,
                        assignedTo: i.assigned_to,
                        dueAt: i.due_at,
                        done: true,
                      });
                      await load();
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Mark improvement completed
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
