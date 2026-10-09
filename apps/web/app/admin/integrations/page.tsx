'use client';
import DirectGoogleConnections from '../../components/DirectGoogleConnections';
import { displayLabel } from '../../../lib/labels';
import { useEffect, useState } from 'react';
import { API, staff, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';

/** Direct connections plus optional developer access for other clinic software. */
export default function Integrations() {
  const { x, lang } = useStaffLang();
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
  if (!s) return null;
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
        <b>{x("Connected software")}</b>
        <nav className="row" aria-label={x('Return links')}>
          <a href="/">{x("Home")}</a>
          <a href="/admin/settings">{x("← Clinic settings")}</a>
        </nav>
      </div>
      <div className="wrap integrations-page" style={{ maxWidth: 1120 }}>
        <header className="screen-heading">
          <span className="eyebrow">{x("Clinic connections")}</span>
          <h1>{x("Connect other clinic software")}</h1>
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
        <DirectGoogleConnections />
        {d && (
          <details open className="card" style={{ marginTop: 24 }}>
            <summary>{x("Custom connections — for your setup team")}</summary>
            <p className="muted">{x("For your setup team: configure access for another system to exchange supported clinic information. A developer must set up each connection. This is optional and is not needed for daily consultations. Keys give access to this clinic only.")}</p>

            <div className="workspace-split">
              <div className="card access-panel">
                <h2>{x("Access keys for other software")}</h2>
                <p className="muted">
                  <b>{x('View only')}</b>: {x('view doctors, slots, appointments, queue')} ·{' '}
                  <b>{x('View and make changes')}</b>: {x('also book/cancel/move appointments and message consenting patients')} ·{' '}
                  <b>{x('Manage connections')}</b>: {x('also manage update connections.')}
                </p>
                {newKey && (
                  <div
                    className="card"
                    style={{ background: '#fffbeb', margin: '8px 0' }}
                    role="status"
                    data-testid="new-key"
                  >
                    <b>{x("Copy this key now. It will not be shown again.")}</b>
                    <div
                      style={{ wordBreak: 'break-all', fontFamily: 'monospace', margin: '6px 0' }}
                    >
                      {newKey.key}
                    </div>
                    <button
                      className="small"
                      onClick={() => navigator.clipboard?.writeText(newKey.key)}
                    >{x("Copy")}</button>{' '}
                    <button className="small ghost" onClick={() => setNewKey(null)}>{x("I saved it")}</button>
                  </div>
                )}
                <div className="list">
                  {d.keys.map((k: any) => (
                    <div key={k.id} className="row between">
                      <span>
                        <b>{k.name}</b> <span className="tag">{k.scopes.join(',')}</span>{' '}
                        <span className="muted">
                          {x("shy_")}{k.prefix}_… ·{' '}
                          {k.revoked_at
                            ? x('revoked')
                            : k.last_used_at
                              ? `${x('last used')} ${new Date(k.last_used_at).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN')}`
                              : x('never used')}
                        </span>
                      </span>
                      {!k.revoked_at && (
                        <button
                          className="small danger"
                          onClick={() =>
                            confirm(`${x('Revoke')} "${k.name}"? ${x('Anything using it stops working immediately.')}`) &&
                            run(() =>
                              staff(`/staff/integrations/keys/${k.id}`, undefined, 'DELETE'),
                            )
                          }
                        >{x("Revoke")}</button>
                      )}
                    </div>
                  ))}
                  {!d.keys.length && <p className="muted">{x("No keys yet.")}</p>}
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
                    aria-label={x('Key name')}
                    placeholder={x('Name, e.g. clinic billing system')}
                    value={kname}
                    onChange={(e) => setKname(e.target.value)}
                    required
                  />
                  <select
                    aria-label={x('Key access')}
                    value={kscope}
                    onChange={(e) => setKscope(e.target.value)}
                    style={{ width: 'auto' }}
                  >
                    <option value="read">{x("View only")}</option>
                    <option value="write">{x("View and make changes")}</option>
                    <option value="admin">{x("Manage connections")}</option>
                  </select>
                  <button type="submit">{x("Create key")}</button>
                </form>
              </div>

              <div className="card updates-panel">
                <h2>{x("Send updates to other software")}</h2>
                {newSecret && (
                  <div
                    className="card"
                    style={{ background: '#fffbeb', margin: '8px 0' }}
                    role="status"
                    data-testid="new-secret"
                  >
                    <b>{x("Connection verification key (shown once):")}</b>
                    <div
                      style={{ wordBreak: 'break-all', fontFamily: 'monospace', margin: '6px 0' }}
                    >
                      {newSecret}
                    </div>
                    <button className="small ghost" onClick={() => setNewSecret(null)}>{x("I saved it")}</button>
                  </div>
                )}
                <div className="list">
                  {d.hooks.map((h: any) => (
                    <div key={h.id}>
                      <div className="row between">
                        <span style={{ wordBreak: 'break-all' }}>
                          <b>{h.url}</b>
                          <div className="muted">
                            {h.events.map((e: string) => x(displayLabel(e))).join(', ')} ·{' '}
                            {h.level === 'minimal'
                              ? x('Reference numbers only')
                              : x('Patient details included')}{' '}
                            · {h.sent_7d} {x('sent')} / {h.failed_7d} {x('failed (7 days)')}
                            {h.pending ? ` · ${h.pending} ${x('pending')}` : ''}
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
                            {x(h.active ? 'Pause' : 'Resume')}
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
                          >{x("Log")}</button>
                          <button
                            className="small danger"
                            onClick={() =>
                              confirm(x('Delete this update connection?')) &&
                              run(() =>
                                staff(`/staff/integrations/webhooks/${h.id}`, undefined, 'DELETE'),
                              )
                            }
                          >{x("Delete")}</button>
                        </span>
                      </div>
                      {open === h.id && (
                        <div className="muted" style={{ fontSize: '.85rem' }}>
                          {deliv.map((delivery) => (
                            <div key={delivery.id}>
                              {new Date(delivery.created_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')} ·{' '}
                              {x(displayLabel(delivery.event_type))} · {x(displayLabel(delivery.status))}
                              {delivery.last_error ? ` (${delivery.last_error})` : ''}
                            </div>
                          ))}
                          {!deliv.length && x('No deliveries yet')}
                        </div>
                      )}
                    </div>
                  ))}
                  {!d.hooks.length && <p className="muted">{x("No update connections yet.")}</p>}
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
                    aria-label={x('Address to send updates to')}
                    placeholder="https://your-clinic-software.example.com/updates"
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
                          {x(displayLabel(e))}
                        </label>
                      ))}
                  </div>
                  <label htmlFor="lvl">{x("What to send about patients")}</label>
                  <select id="lvl" value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="minimal">{x("Reference numbers only (recommended)")}</option>
                    <option value="full">{x("Include patient name and phone (and message text)")}</option>
                  </select>
                  {level === 'full' && (
                    <p className="muted">{x("Only choose this for tools you trust and that you are allowed to share patient details with. Patients are told their data is used to manage their visit.")}</p>
                  )}
                  <p className="row">
                    <button type="submit" disabled={!events.length}>{x("Add update connection")}</button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        run(async () => {
                          await staff('/staff/integrations/test', {});
                          setMsg(x('Test event queued. Check the Log.'));
                        })
                      }
                    >{x("Send test event")}</button>
                  </p>
                </form>
              </div>
            </div>
            <details open className="card technical-reference" style={{ marginTop: '1rem' }}>
              <summary>{x("Try it — technical reference")}</summary>
              <h2>{x("Try it")}</h2>
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
                {x('Full reference:')}{' '}
                <a href={`${API}/v1/openapi.json`} target="_blank" rel="noreferrer">
                  {API}{x("/v1/openapi.json")}
                </a>
                . {x('These connections do not require n8n.')}
              </p>
            </details>
          </details>
        )}
      </div>
    </div>
  );
}
