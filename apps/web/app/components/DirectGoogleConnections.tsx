'use client';
import { useEffect, useRef, useState } from 'react';
import { staff } from '../../lib/api';

type Kind = 'calendar' | 'sheets';
type Connection = {
  kind: Kind;
  target_id: string | null;
  target_name: string | null;
  setup_state: 'ready' | 'creating' | 'unknown';
  enabled: boolean;
  last_error: string | null;
  last_synced_at: string | null;
  counts: { pending: number; failed: number; synced: number };
  recent: { appointment_id: string; status: string; last_error: string | null }[];
};
const path = '/staff/integrations/google';
const names = { calendar: 'Google Calendar', sheets: 'Google Sheets' };
export default function DirectGoogleConnections() {
  const [data, setData] = useState<{ configured: boolean; connections: Connection[] } | null>(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState({ calendar: false, sheets: false });
  const [upcoming, setUpcoming] = useState({ calendar: false, sheets: false });
  const returned = useRef(false);
  const load = async () => setData(await staff(path));
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy(false);
    }
  };
  useEffect(() => {
    if (returned.current) return;
    returned.current = true;
    const query = new URLSearchParams(window.location.search);
    const outcome = query.get('google'),
      state = query.get('state');
    if (outcome) {
      query.delete('google');
      query.delete('state');
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (query.size ? '?' + query : '') + window.location.hash,
      );
    }
    if (outcome === 'complete' && state) {
      let proof: string | null = null;
      try {
        proof = sessionStorage.getItem('sahayak.google.' + state);
      } catch {
        /* unavailable */
      }
      void run(async () => {
        if (!proof)
          throw new Error(
            'Open the connection in the same browser and Admin account that started it. Choose Connect Google to start again.',
          );
        await staff(path + '/complete', { state, proof });
        sessionStorage.removeItem('sahayak.google.' + state);
      }, 'Google sign-in completed. Review the connection below; create its destination or turn on updates if needed.');
    } else {
      if (outcome === 'cancelled')
        setMessage('Google sign-in was cancelled. Nothing new was connected.');
      if (outcome === 'failed')
        setError(
          'Google sign-in could not be completed. Start again and allow the requested access.',
        );
      void load().catch((e) => setError(e.message));
    }
  }, []);
  const connect = (kind: Kind) =>
    run(async () => {
      const result = await staff(path + '/' + kind + '/start', {});
      sessionStorage.setItem('sahayak.google.' + result.state, result.proof);
      window.location.assign(result.url);
    }, 'Opening Google sign-in…');
  return (
    <section aria-labelledby="direct-connections-title" className="direct-connections">
      <h2 id="direct-connections-title">Connect your everyday tools</h2>
      <p>
        Keep an appointment calendar or a simple appointment register in Google. Sahayak sends the
        updates directly. No extra automation software is needed.
      </p>
      <p className="muted">
        Changes flow from Sahayak to Google only. Continue booking and changing visits in Sahayak.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <button
        className="ghost"
        disabled={busy}
        onClick={() => run(async () => {}, 'Status refreshed.')}
      >
        Refresh status
      </button>
      {!data && <p role="status">Loading connections…</p>}
      {data && !data.configured && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>One-time Google setup is needed</b>
          <p>
            Your setup team needs to register Sahayak with Google. After that, you can sign in here
            and choose when to start sharing updates.
          </p>
          <details>
            <summary>Setup details for your technical team</summary>
            <p>
              Enable the Google Calendar and Google Sheets APIs, configure the Google consent
              screen, and create a Web application OAuth client. Save these settings privately on
              the API server and restart it:
            </p>
            <ul>
              <li>
                <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>
              </li>
              <li>
                <code>GOOGLE_CONNECTION_ENCRYPTION_KEY</code> — a stable, secret 64-character
                hexadecimal key
              </li>
              <li>
                <code>GOOGLE_REDIRECT_URI</code> — the API address followed by{' '}
                <code>/integrations/google/callback</code>
              </li>
              <li>
                <code>GOOGLE_APP_WEB_URL</code> — the Sahayak website origin
              </li>
            </ul>
            <p>
              Local callback example:{' '}
              <code>http://localhost:4000/integrations/google/callback</code>. Local website:{' '}
              <code>http://localhost:3000</code>. Use HTTPS when hosted. Add the exact callback to
              the Google OAuth client.
            </p>
            <p>
              The repository guide is <code>docs/direct-google-connections.md</code>. Do not enter
              secrets in patient messages.
            </p>
          </details>
        </div>
      )}
      <div className="direct-connections-grid">
        {(['calendar', 'sheets'] as Kind[]).map((kind) => {
          const c = data?.connections.find((x) => x.kind === kind);
          const title =
            kind === 'calendar' ? 'See appointments on a calendar' : 'Keep an appointment register';
          return (
            <article key={kind} className="card direct-connection-card">
              <span className="eyebrow">{names[kind]}</span>
              <h3>{title}</h3>
              <p>
                {kind === 'calendar'
                  ? 'Creates a separate clinic calendar. Bookings and time changes update its entries; cancellations remove them.'
                  : 'Creates a separate spreadsheet. Each appointment has one row that updates when its time or status changes.'}
              </p>
              <b>
                {!c
                  ? 'Not connected'
                  : !c.target_id
                    ? 'Sign-in complete · setup needed'
                    : c.enabled
                      ? 'Automatic updates on'
                      : 'Automatic updates paused'}
              </b>
              {c?.target_name && <p>{c.target_name}</p>}
              <p className="muted">
                Shared: appointment reference, doctor reference, start and end times, and
                appointment status. Patient names, phone numbers and medical notes are not sent.
              </p>
              {c?.last_error && (
                <p className="error" role="alert">
                  {c.last_error}
                </p>
              )}
              {c && !c.target_id && c.setup_state !== 'ready' && (
                <p>
                  Creation has an uncertain or unfinished result. Ask your setup team to check
                  Google before disconnecting and starting again, so you do not create another
                  destination.
                </p>
              )}
              {(!c || !c.enabled) && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={share[kind]}
                    onChange={(e) => setShare({ ...share, [kind]: e.target.checked })}
                  />
                  <span>
                    I am allowed to share these appointment details with the clinic’s Google
                    account.
                  </span>
                </label>
              )}
              {c?.target_id && !c.enabled && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={upcoming[kind]}
                    onChange={(e) => setUpcoming({ ...upcoming, [kind]: e.target.checked })}
                  />
                  <span>
                    Also include existing booked and checked-in appointments in the next 90 days.
                  </span>
                </label>
              )}
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 16 }}>
                {!c && (
                  <button
                    disabled={busy || !data?.configured || !share[kind]}
                    onClick={() => connect(kind)}
                  >
                    Connect {names[kind]}
                  </button>
                )}
                {c && !c.target_id && c.setup_state === 'ready' && (
                  <button
                    disabled={busy || !data?.configured || !share[kind]}
                    onClick={() =>
                      run(
                        () => staff(`${path}/${kind}/prepare`, { acceptsExport: true }),
                        'Clinic destination created. Turn on automatic updates when ready.',
                      )
                    }
                  >
                    Create clinic {kind === 'calendar' ? 'calendar' : 'spreadsheet'}
                  </button>
                )}
                {c?.target_id && (
                  <>
                    <button
                      disabled={busy || !data?.configured || (!c.enabled && !share[kind])}
                      onClick={() =>
                        run(
                          () =>
                            staff(
                              `${path}/${kind}/settings`,
                              {
                                enabled: !c.enabled,
                                acceptsExport: share[kind],
                                includeUpcoming: upcoming[kind],
                              },
                              'PUT',
                            ),
                          c.enabled
                            ? 'Automatic updates paused.'
                            : 'Automatic updates enabled. Due updates are checked every 30 seconds.',
                        )
                      }
                    >
                      {c.enabled ? 'Pause updates' : 'Turn on automatic updates'}
                    </button>
                    <button
                      className="ghost"
                      disabled={busy || !data?.configured}
                      onClick={() =>
                        run(
                          () => staff(`${path}/${kind}/check`, {}),
                          'Google access checked successfully. This does not confirm that an appointment was sent.',
                        )
                      }
                    >
                      Check connection
                    </button>
                    <a
                      href={
                        kind === 'calendar'
                          ? 'https://calendar.google.com/'
                          : `https://docs.google.com/spreadsheets/d/${encodeURIComponent(c.target_id)}/edit`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {names[kind]}
                    </a>
                  </>
                )}
                {c && (
                  <>
                    <button
                      className="ghost"
                      disabled={busy || !data?.configured}
                      onClick={() => connect(kind)}
                    >
                      Reconnect Google
                    </button>
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            'Disconnect this tool? Updates will stop. The calendar or spreadsheet and information already sent will stay in Google.',
                          )
                        )
                          void run(
                            () => staff(`${path}/${kind}`, undefined, 'DELETE'),
                            'Disconnected. Existing Google data is unchanged.',
                          );
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
              {c?.target_id && (
                <div style={{ marginTop: 20 }}>
                  <p>
                    <b>{c.counts.synced}</b> up to date · <b>{c.counts.pending}</b> waiting ·{' '}
                    <b>{c.counts.failed}</b> need attention
                  </p>
                  <p className="muted">
                    Last successful appointment update:{' '}
                    {c.last_synced_at
                      ? new Date(c.last_synced_at).toLocaleString()
                      : 'Not yet sent'}
                  </p>
                  {(c.counts.pending > 0 || c.counts.failed > 0) && (
                    <button
                      className="ghost"
                      disabled={busy || !data?.configured || !c.enabled}
                      onClick={() =>
                        run(
                          () => staff(`${path}/${kind}/retry`, {}),
                          'An update attempt has finished. Check the counts and any errors below; remaining updates run in the background.',
                        )
                      }
                    >
                      Retry waiting updates
                    </button>
                  )}
                  <details>
                    <summary>Recent appointment updates</summary>
                    {c.recent.length ? (
                      <ul>
                        {c.recent.map((item) => (
                          <li key={item.appointment_id}>
                            Reference {item.appointment_id.slice(0, 8)} ·{' '}
                            {item.status === 'synced'
                              ? 'Up to date'
                              : item.status === 'pending'
                                ? 'Waiting'
                                : 'Needs attention'}
                            {item.last_error && <p>{item.last_error}</p>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No appointment updates yet.</p>
                    )}
                  </details>
                </div>
              )}
              <details style={{ marginTop: 16 }}>
                <summary>What happens when I pause or disconnect?</summary>
                <p>
                  Pause stops future delivery and keeps pending changes for when you turn updates
                  back on. Disconnect removes saved Google credentials and queued updates from
                  Sahayak. Information already copied to Google remains there; remove it in Google
                  if needed.
                </p>
                {kind === 'sheets' && (
                  <p>
                    Keep the Appointments tab and row order unchanged. Use a separate tab for your
                    own analysis. The register supports 9,999 appointments per connection.
                  </p>
                )}
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
