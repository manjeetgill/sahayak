'use client';
import { displayLabel } from '../../lib/labels';
import { useCallback, useEffect, useState } from 'react';
import { API, session, staff, useSession } from '../../lib/api';

const FILTERS = [
  { v: '', l: 'All entries' },
  { v: 'red_flag', l: 'Emergency alerts' },
  { v: 'error', l: 'Errors' },
  { v: 'tool_call', l: 'Actions' },
  { v: 'message', l: 'Messages' },
];

/** Safety report: proof, not promises. Live checks, 30-day activity, latest eval run, and the audit log. */
export default function Safety() {
  const s = useSession();
  const [rep, setRep] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [kind, setKind] = useState(''),
    [onlyFailed, setOnlyFailed] = useState(false);
  const [more, setMore] = useState(true),
    [err, setErr] = useState('');

  const q = useCallback(
    (before?: number) =>
      `/staff/audit?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(onlyFailed ? { ok: 'false' } : {}), ...(before ? { before: String(before) } : {}) })}`,
    [kind, onlyFailed],
  );
  useEffect(() => {
    if (s)
      staff('/staff/safety-report')
        .then(setRep)
        .catch((e) => setErr(e.message));
  }, [s]);
  useEffect(() => {
    if (s)
      staff(q())
        .then((r) => {
          setRows(r);
          setMore(r.length === 50);
        })
        .catch((e) => setErr(e.message));
  }, [s, q]);
  if (!s) return null;

  const loadMore = async () => {
    const r = await staff(q(rows[rows.length - 1]?.id));
    setRows([...rows, ...r]);
    setMore(r.length === 50);
  };
  const csv = async () => {
    const res = await fetch(`${API}/staff/audit.csv?days=90`, {
      headers: { authorization: `Bearer ${session.get()?.token}` },
    });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const a = rep?.activity,
    ev = rep?.eval;
  const stat = (label: string, v: any, bad = false) => (
    <div
      className="card"
      style={{ flex: '1 1 150px', borderColor: bad ? 'var(--danger)' : undefined }}
    >
      <div className="muted" style={{ fontSize: '.8rem' }}>
        {label}
      </div>
      <div
        style={{ fontSize: '1.6rem', fontWeight: 800, color: bad ? 'var(--danger)' : undefined }}
      >
        {v}
      </div>
    </div>
  );
  return (
    <div>
      <div className="topbar">
        <b>Safety report</b>
        <a href={s.user.role === 'doctor' ? '/doctor' : '/console'}>← Back</a>
      </div>
      <div className="wrap safety-page" style={{ maxWidth: 1120 }}>
        <header className="screen-heading">
          <span className="eyebrow">Clinic assurance</span>
          <h1>Safety report</h1>
          <p className="muted">Protections, current status and activity history.</p>
        </header>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        {rep && (
          <div className="safety-overview">
            <div className="card protections-panel">
              <h2>Protections, checked just now</h2>
              <div className="list" data-testid="controls">
                {rep.controls.map((c: any) => (
                  <div key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <span
                      aria-label={c.ok ? 'ok' : 'attention'}
                      style={{ color: c.ok ? 'var(--ok)' : 'var(--danger)', fontWeight: 800 }}
                    >
                      {c.ok ? '✓' : '!'}
                    </span>
                    <span>
                      <b>{c.label}</b>
                      <div className="muted">{c.detail}</div>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <section className="safety-metrics">
              <h2 style={{ marginTop: '1.2rem' }}>Last 30 days</h2>
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                {stat('Patient messages', a.messages_in)}
                {stat('Emergency alerts', a.red_flags)}
                {stat(
                  'Emergency alerts not yet handled (>15 min)',
                  a.red_flags_unhandled,
                  a.red_flags_unhandled > 0,
                )}
                {stat('Avg minutes to handle an alert', a.red_flag_minutes_to_resolve)}
                {stat('Medical questions (no advice given)', a.medical_questions)}
                {stat('Handed to a person', a.handoffs)}
                {stat('Blocked actions', a.permission_denied)}
                {stat('Assistant problems', a.agent_errors, a.agent_errors > 0)}
                {stat('Undelivered messages', a.undelivered_messages, a.undelivered_messages > 0)}
                {stat('Privacy requests', a.privacy_requests)}
              </div>
            </section>
            <div className="card evaluation-panel" data-testid="eval">
              <h2>Safety test results</h2>
              {!ev ? (
                <p className="muted">
                  No safety test results recorded yet. Ask your setup team to run the checks.
                </p>
              ) : (
                <>
                  <p className="muted">
                    {new Date(ev.ranAt).toLocaleString()} · {ev.passed}/{ev.total} sample messages
                    (Hindi, Hinglish, English) passed · mode:{' '}
                    {ev.mode === 'llm'
                      ? 'with AI model'
                      : 'built-in rules only (AI model not exercised)'}
                  </p>
                  <div className="list">
                    {ev.rules.map((r: any) => (
                      <div key={r.rule}>
                        <div className="row between">
                          <span>{r.label}</span>
                          <b
                            style={{ color: r.passed === r.total ? 'var(--ok)' : 'var(--danger)' }}
                          >
                            {r.passed}/{r.total}
                          </b>
                        </div>
                        {r.failures.map((f: any) => (
                          <div key={f.id} className="muted">
                            #{f.id} “{f.text}”: {f.why}
                          </div>
                        ))}
                      </div>
                    ))}
                    <div className="row between">
                      <span>No reply contained medical advice</span>
                      <b style={{ color: ev.noMedicalAdvice ? 'var(--ok)' : 'var(--danger)' }}>
                        {ev.noMedicalAdvice ? 'Yes' : 'No'}
                      </b>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ marginTop: '1.2rem' }}>
          <div className="row between">
            <h2>Activity history</h2>
            <button className="ghost small" onClick={csv}>
              Download activity spreadsheet (90 days)
            </button>
          </div>
          <p className="muted">
            Recorded assistant messages, actions and decisions. Entries cannot be edited or deleted.
          </p>
          <div className="row" style={{ margin: '.5rem 0' }}>
            <select
              aria-label="Filter"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              style={{ width: 'auto' }}
            >
              {FILTERS.map((f) => (
                <option key={f.v} value={f.v}>
                  {f.l}
                </option>
              ))}
            </select>
            <label className="check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={onlyFailed}
                onChange={(e) => setOnlyFailed(e.target.checked)}
              />
              Only failed or blocked
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}
              data-testid="audit"
            >
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th>Time</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Patient</th>
                  <th>Result</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td>
                      {new Date(r.at).toLocaleString('en-IN', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>{displayLabel(r.agent)}</td>
                    <td>{displayLabel(r.tool ?? r.kind)}</td>
                    <td>{r.patient ?? ''}</td>
                    <td style={{ color: r.ok ? 'var(--ok)' : 'var(--danger)' }}>
                      {r.ok ? 'Completed' : 'Blocked or unsuccessful'}
                    </td>
                    <td
                      className="muted"
                      style={{
                        maxWidth: 320,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <details>
                        <summary>Details for your setup team</summary>
                        {r.detail}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more && rows.length > 0 && (
            <p>
              <button className="ghost" onClick={loadMore}>
                Load more
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
