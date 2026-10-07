'use client';
import { useState } from 'react';
import { staff } from '../../../../lib/api';
type Ready = {
  ready: boolean;
  code: string;
  message: string;
  enabled: boolean;
  live_call_verified: boolean;
};
type Call = {
  id: string;
  state: 'ACTIVE' | 'HANDOFF' | 'COMPLETED' | 'FAILED';
  last_turn: number;
  duration_seconds: number | null;
  created_at: string;
};
const states = {
  ACTIVE: 'In progress',
  HANDOFF: 'Reception follow-up needed',
  COMPLETED: 'Ended',
  FAILED: 'Failed',
};
export function CallingSetup({
  canManage,
  onChanged,
}: {
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [readiness, setReadiness] = useState<Ready | null>(null),
    [calls, setCalls] = useState<Call[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false),
    [charges, setCharges] = useState(false),
    [notice, setNotice] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await run(async () => {
      const r = await staff<Ready>('/staff/agents/calling/readiness');
      setReadiness(r);
      setCharges(false);
      await onChanged();
    });
  }
  async function history(more = false) {
    await run(async () => {
      const r = await staff<{ calls: Call[]; next_before: string | null }>(
        '/staff/agents/calling/calls' +
          (more && cursor ? '?before=' + encodeURIComponent(cursor) : ''),
      );
      setCalls(more ? [...calls, ...r.calls] : r.calls);
      setCursor(r.next_before);
      setChecked(true);
    });
  }
  async function activation(enabled: boolean) {
    await run(async () => {
      const r = await staff<{ enabled: boolean; live_call_verified: boolean }>(
        '/staff/agents/calling/activation',
        { enabled },
      );
      setReadiness((v) => (v ? { ...v, enabled: r.enabled } : v));
      setCharges(false);
      setNotice(
        enabled
          ? 'Incoming calling enabled. Place a real test call before relying on it.'
          : 'Incoming calling paused. A booking already being processed may still finish.',
      );
      await onChanged();
    });
  }
  return (
    <section className="card" aria-label="Calling connection controls">
      <h3>Connect and test incoming calls</h3>
      <p>
        The setup team connects a voice provider and routes the clinic number. The provider check
        verifies ownership, incoming voice support and webhook routing.
      </p>
      <button className="ghost small" disabled={busy} onClick={() => void refresh()}>
        Check voice connection
      </button>
      {readiness && <p role="status">{readiness.message}</p>}
      {canManage && readiness && !readiness.enabled && readiness.ready && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={charges}
              onChange={(e) => setCharges(e.target.checked)}
            />{' '}
            Enable incoming calls on the configured clinic number. I understand the voice provider
            may charge for calls.
          </label>
          <button disabled={busy || !charges} onClick={() => void activation(true)}>
            Enable incoming calling
          </button>
        </div>
      )}
      {canManage && readiness?.enabled && (
        <button disabled={busy} onClick={() => void activation(false)}>
          Pause incoming calling
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3>Real phone test</h3>
      <ol>
        <li>
          Once the connection is ready and enabled, call the clinic number from another phone.
        </li>
        <li>
          Ask for an appointment, provide a test name and consent, choose a slot and say yes to
          confirm.
        </li>
        <li>Check the appointment in the clinic app and refresh call activity below.</li>
      </ol>
      <p>
        A readiness check does not verify real audio or a completed booking. Reception follow-up
        ends the call; it does not transfer it. Outbound calls and recordings are disabled.
      </p>
      <h3>Phone activity</h3>
      <button className="ghost small" disabled={busy} onClick={() => void history()}>
        Refresh call activity
      </button>
      {checked && !calls.length && <p>No incoming calls recorded yet.</p>}
      {!!calls.length && (
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Result</th>
              <th>Turns</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.created_at).toLocaleString()}</td>
                <td>{states[c.state]}</td>
                <td>{c.last_turn}</td>
                <td>
                  {c.duration_seconds === null
                    ? 'Awaiting provider status'
                    : c.duration_seconds + ' seconds'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cursor && (
        <button disabled={busy} onClick={() => void history(true)}>
          Load older calls
        </button>
      )}
    </section>
  );
}
