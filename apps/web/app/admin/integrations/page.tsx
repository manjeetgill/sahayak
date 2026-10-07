'use client';
import { displayLabel } from '../../../lib/labels';
import { useEffect, useState } from 'react';
import { API, staff, useSession } from '../../../lib/api';

/** Integrations: API keys and webhooks, for connecting Sahayak to n8n, spreadsheets, billing tools and more. */
export default function Integrations() {
  const s = useSession('admin');
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const [newKey, setNewKey] = useState<{ key: string } | null>(null),
    [newSecret, setNewSecret] = useState<string | null>(null);
  const [kname, setKname] = useState(''),
    [kscope, setKscope] = useState('write');
  const [url, setUrl] = useState(''),
    [events, setEvents] = useState<string[]>(['appointment.booked']),
    [level, setLevel] = useState('minimal');
  const [open, setOpen] = useState<string | null>(null),
    [deliv, setDeliv] = useState<any[]>([]);
  const load = () =>
    staff('/staff/integrations')
      .then(setD)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    if (s) load();
  }, [s]);
  if (!s || !d) return null;
  const run = async (fn: () => Promise<any>) => {
    setErr('');
    setMsg('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const toggle = (e: string) =>
    setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);

  return (
    <div>
      <div className="topbar">
        <b>Connected software</b>
        <a href="/admin/settings">← Clinic settings</a>
      </div>
      <div className="wrap integrations-page" style={{ maxWidth: 1120 }}>
        <header className="screen-heading">
          <span className="eyebrow">For your setup team</span>
          <h1>Connected software</h1>
        </header>
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}
        {msg && (
          <div role="status" style={{ color: 'var(--ok)', fontWeight: 700 }}>
            {msg}
          </div>
        )}
        <p className="muted">
          For your setup team: configure access for another system to exchange supported clinic
          information. A developer must set up each connection. This is optional and is not needed
          for daily consultations. Keys give access to this clinic only.
        </p>

        <div className="workspace-split">
          <div className="card access-panel">
            <h2>Access keys for other software</h2>
            <p className="muted">
              <b>View only</b>: view doctors, slots, appointments, queue ·{' '}
              <b>View and make changes</b>: also book/cancel/move appointments and message
              consenting patients · <b>Manage connections</b>: also manage update connections.
            </p>
            {newKey && (
              <div
                className="card"
                style={{ background: '#fffbeb', margin: '8px 0' }}
                role="status"
                data-testid="new-key"
              >
                <b>Copy this key now. It will not be shown again.</b>
                <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', margin: '6px 0' }}>
                  {newKey.key}
                </div>
                <button
                  className="small"
                  onClick={() => navigator.clipboard?.writeText(newKey.key)}
                >
                  Copy
                </button>{' '}
                <button className="small ghost" onClick={() => setNewKey(null)}>
                  I saved it
                </button>
              </div>
            )}
            <div className="list">
              {d.keys.map((k: any) => (
                <div key={k.id} className="row between">
                  <span>
                    <b>{k.name}</b> <span className="tag">{k.scopes.join(',')}</span>{' '}
                    <span className="muted">
                      shy_{k.prefix}_… ·{' '}
                      {k.revoked_at
                        ? 'revoked'
                        : k.last_used_at
                          ? `last used ${new Date(k.last_used_at).toLocaleDateString()}`
                          : 'never used'}
                    </span>
                  </span>
                  {!k.revoked_at && (
                    <button
                      className="small danger"
                      onClick={() =>
                        confirm(
                          `Revoke "${k.name}"? Anything using it stops working immediately.`,
                        ) &&
                        run(() => staff(`/staff/integrations/keys/${k.id}`, undefined, 'DELETE'))
                      }
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              {!d.keys.length && <p className="muted">No keys yet.</p>}
            </div>
            <form
              className="row"
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  setNewKey(
                    await staff('/staff/integrations/keys', { name: kname, scope: kscope }),
                  );
                  setKname('');
                });
              }}
            >
              <input
                aria-label="Key name"
                placeholder="Name, e.g. n8n"
                value={kname}
                onChange={(e) => setKname(e.target.value)}
                required
              />
              <select
                aria-label="Key access"
                value={kscope}
                onChange={(e) => setKscope(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="read">View only</option>
                <option value="write">View and make changes</option>
                <option value="admin">Manage connections</option>
              </select>
              <button type="submit">Create key</button>
            </form>
          </div>

          <div className="card updates-panel">
            <h2>Send updates to other software</h2>
            {newSecret && (
              <div
                className="card"
                style={{ background: '#fffbeb', margin: '8px 0' }}
                role="status"
                data-testid="new-secret"
              >
                <b>Connection verification key (shown once):</b>
                <div style={{ wordBreak: 'break-all', fontFamily: 'monospace', margin: '6px 0' }}>
                  {newSecret}
                </div>
                <button className="small ghost" onClick={() => setNewSecret(null)}>
                  I saved it
                </button>
              </div>
            )}
            <div className="list">
              {d.hooks.map((h: any) => (
                <div key={h.id}>
                  <div className="row between">
                    <span style={{ wordBreak: 'break-all' }}>
                      <b>{h.url}</b>
                      <div className="muted">
                        {h.events.map(displayLabel).join(', ')} ·{' '}
                        {h.level === 'minimal'
                          ? 'Reference numbers only'
                          : 'Patient details included'}{' '}
                        · {h.sent_7d} sent / {h.failed_7d} failed (7 days)
                        {h.pending ? ` · ${h.pending} pending` : ''}
                      </div>
                    </span>
                    <span className="row">
                      <button
                        className="small ghost"
                        onClick={() =>
                          run(() =>
                            staff(
                              `/staff/integrations/webhooks/${h.id}`,
                              { active: !h.active },
                              'PATCH',
                            ),
                          )
                        }
                      >
                        {h.active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        className="small ghost"
                        onClick={async () => {
                          setOpen(open === h.id ? null : h.id);
                          setDeliv(
                            (await staff(`/staff/integrations/webhooks/${h.id}/deliveries`))
                              .deliveries,
                          );
                        }}
                      >
                        Log
                      </button>
                      <button
                        className="small danger"
                        onClick={() =>
                          confirm('Delete this update connection?') &&
                          run(() =>
                            staff(`/staff/integrations/webhooks/${h.id}`, undefined, 'DELETE'),
                          )
                        }
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  {open === h.id && (
                    <div className="muted" style={{ fontSize: '.85rem' }}>
                      {deliv.map((x) => (
                        <div key={x.id}>
                          {new Date(x.created_at).toLocaleString()} · {displayLabel(x.event_type)} ·{' '}
                          {displayLabel(x.status)}
                          {x.last_error ? ` (${x.last_error})` : ''}
                        </div>
                      ))}
                      {!deliv.length && 'No deliveries yet'}
                    </div>
                  )}
                </div>
              ))}
              {!d.hooks.length && <p className="muted">No update connections yet.</p>}
            </div>
            <form
              style={{ marginTop: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const r = await staff('/staff/integrations/webhooks', { url, events, level });
                  setNewSecret(r.secret);
                  setUrl('');
                });
              }}
            >
              <input
                aria-label="Address to send updates to"
                placeholder="https://your-n8n.example.com/webhook/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <div style={{ margin: '8px 0' }}>
                {d.events
                  .filter((e: string) => e !== 'ping')
                  .map((e: string) => (
                    <label
                      key={e}
                      className="check"
                      style={{ display: 'inline-flex', marginRight: 14 }}
                    >
                      <input
                        type="checkbox"
                        checked={events.includes(e)}
                        onChange={() => toggle(e)}
                      />
                      {displayLabel(e)}
                    </label>
                  ))}
              </div>
              <label htmlFor="lvl">What to send about patients</label>
              <select id="lvl" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="minimal">Reference numbers only (recommended)</option>
                <option value="full">Include patient name and phone (and message text)</option>
              </select>
              {level === 'full' && (
                <p className="muted">
                  Only choose this for tools you trust and that you are allowed to share patient
                  details with. Patients are told their data is used to manage their visit.
                </p>
              )}
              <p className="row">
                <button type="submit" disabled={!events.length}>
                  Add update connection
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    run(async () => {
                      await staff('/staff/integrations/test', {});
                      setMsg('Test event queued. Check the Log.');
                    })
                  }
                >
                  Send test event
                </button>
              </p>
            </form>
          </div>
        </div>
        <details className="card technical-reference" style={{ marginTop: '1rem' }}>
          <summary>Try it — technical reference</summary>
          <h2>Try it</h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: '.8rem',
              background: '#f1f5f9',
              padding: 10,
              borderRadius: 8,
            }}
          >{`curl ${API}/v1/doctors \\\n  -H "Authorization: Bearer shy_xxxxxxxx_..."`}</pre>
          <p className="muted">
            Full reference:{' '}
            <a href={`${API}/v1/openapi.json`} target="_blank" rel="noreferrer">
              {API}/v1/openapi.json
            </a>
            . There is also an n8n node (see <code>packages/n8n-nodes-sahayak</code>).
          </p>
        </details>
      </div>
    </div>
  );
}
