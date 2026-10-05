'use client';
import { CallingSetup } from './calling-setup';
import { WhatsAppSetup } from './whatsapp-setup';
import { useCallback, useEffect, useState } from 'react';
import { AGENT_NAMES } from '@sahayak/shared';
import { staff } from '../../../../lib/api';
import { GuidedTest } from './testing';
import { Diagnostics } from './diagnostics';

const labels: Record<string, string> = {
  checkin: 'Help patients check in',
  queue: 'Keep the patient queue moving',
  intake: 'Ask patients why they are visiting',
  front_desk: 'Answer clinic questions',
  schedule: 'Help when the doctor is running late',
  followup: 'Remind patients about follow-up visits',
  leads: 'Collect new patient enquiries',
  records: 'Receive patient documents',
};
const descriptions: Record<string, string> = {
  checkin: 'Give arriving patients a token after they share their details and consent.',
  queue: 'Keep patients and staff updated as the consultation queue changes.',
  intake: 'Collect the patient’s concern and your intake answers before consultation.',
  front_desk: 'Answer questions using your clinic’s hours, fees and saved answers.',
  schedule: 'Prepare appointment changes and notifications for your approval.',
  followup: 'Send eligible reminders to patients who agreed to receive them.',
  leads: 'Record enquiries that your reception team can follow up.',
  records: 'Keep uploaded reports available for the doctor to review.',
};
type Connections = {
  liveChannelOwner?: 'platform' | 'local';
  slug?: string;
  simulator: boolean;
  voiceSimulator: boolean;
  platform: { configured: boolean };
  whatsapp: { configured: boolean; provider: string | null };
  phone: {
    configured: boolean;
    requestedNumber?: string | null;
    bookingAdapter?: boolean;
    state?: string;
  };
};

export function Connections({
  isDoctor,
  view = 'overview',
}: {
  isDoctor: boolean;
  view?: 'overview' | 'whatsapp' | 'phone';
}) {
  const [connections, setConnections] = useState<Connections | null>(null);
  const [agents, setAgents] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [c, settings] = await Promise.all([
        staff<Connections>('/staff/agents/connections'),
        staff('/staff/settings'),
      ]);
      setConnections(c);
      setAgents(settings.agents);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (name: string, enabled: boolean) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await staff('/staff/settings', { agents: { [name]: enabled } }, 'PUT');
      await load();
      setMessage(`${labels[name]} ${enabled ? 'activated' : 'paused'}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Patient contact options and clinic tasks">
      {view === 'whatsapp' && <WhatsAppSetup isDoctor={isDoctor} />}
      {view === 'phone' && <CallingSetup isDoctor={isDoctor} onChanged={load} />}
      <h2>
        {view === 'overview'
          ? 'Patient messages and calls'
          : view === 'phone'
            ? 'Phone calls'
            : 'WhatsApp messages'}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button className="ghost small" disabled={busy} onClick={() => void load()}>
        Refresh status
      </button>
      {!connections && !error && <p role="status">Loading connections…</p>}
      {connections && (
        <>
          <p className="muted">
            Check whether patients can reach your clinic. You can try a practice conversation before
            live service is ready.
          </p>
          {(
            [
              ['WhatsApp', connections.whatsapp.configured, connections.simulator, 'sim'],
              ['Phone', connections.phone.configured, connections.voiceSimulator, 'call'],
            ] as const
          )
            .filter(([name]) => view === 'overview' || name.toLowerCase() === view)
            .map(([name, configured, simulator, path]) => (
              <div className="card" key={name} style={{ marginTop: 10 }}>
                <h3>{name}</h3>
                <p>
                  {connections.liveChannelOwner === 'platform'
                    ? configured
                      ? 'Connected through agent platform · replies enabled'
                      : 'Not connected yet · practice only'
                    : configured
                      ? 'Setup entered · a real conversation still needs testing'
                      : 'Not connected yet · practice only'}
                </p>
                {name === 'Phone' && connections.phone.requestedNumber && (
                  <p>
                    Intended calling number: <b>{connections.phone.requestedNumber}</b>
                  </p>
                )}
                {name === 'Phone' && connections.phone.bookingAdapter && (
                  <p role="status">
                    {connections.phone.state === 'UNAVAILABLE'
                      ? 'Agent service unavailable. Other clinic features remain available.'
                      : connections.phone.state === 'AWAITING_VOICE_PROVIDER'
                        ? 'Appointment flow ready. Voice number authorization is still required before a real phone test.'
                        : connections.phone.configured
                          ? 'Calling enabled. Complete a real phone test before relying on it.'
                          : 'Calling is paused.'}
                  </p>
                )}
                <p className="muted">
                  Uses the clinic tasks you choose under Everyday help. Turning a task on does not
                  connect live messages or calls.
                </p>
                {simulator && connections.slug && (
                  <a href={`/c/${encodeURIComponent(connections.slug)}/${path}`}>
                    Try a {name === 'Phone' ? 'phone' : 'WhatsApp'} conversation
                  </a>
                )}
                {!simulator && <p className="muted">Practice conversations are unavailable.</p>}
              </div>
            ))}
          <p className="muted">
            Practice conversations are saved in the clinic. Use made-up patient details. No real
            message is sent and no phone is called.
          </p>
        </>
      )}
      {view !== 'overview' && (
        <>
          {connections?.liveChannelOwner === 'platform' ? (
            <p role="status">
              {view === 'whatsapp' && connections.whatsapp.configured
                ? 'Send Hi to your connected clinic number from another WhatsApp number to test a real appointment conversation.'
                : 'Live service is not connected yet. Your setup team needs to finish connecting it. You can try the assistant below without contacting a patient.'}
            </p>
          ) : view !== 'phone' ? (
            <Diagnostics />
          ) : null}
          {connections?.simulator && (
            <GuidedTest key={view} channel={view === 'phone' ? 'voice' : 'whatsapp'} />
          )}
        </>
      )}
      {view === 'overview' && (
        <>
          <h2>What would you like help with?</h2>
          <p className="muted">
            Choose the routine tasks your clinic needs. These choices apply wherever the assistant
            is used. Emergency alerts always stay on.
          </p>
          {agents &&
            AGENT_NAMES.map((name) => (
              <div className="row between" key={name} style={{ margin: '8px 0' }}>
                <div style={{ flex: 1 }}>
                  <b>{labels[name]}</b> · {agents[name] !== false ? 'On' : 'Paused'}
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {descriptions[name]}
                  </p>
                </div>
                {isDoctor && (
                  <button
                    className="small ghost"
                    disabled={busy}
                    onClick={() => void toggle(name, agents[name] === false)}
                  >
                    {agents[name] !== false ? 'Pause' : 'Turn on'}
                  </button>
                )}
              </div>
            ))}
        </>
      )}
      {isDoctor && (
        <p>
          <a href="/doctor/settings">Edit clinic details and patient safety settings</a>
        </p>
      )}
      <details style={{ marginTop: 16 }}>
        <summary>Connection details for your setup team</summary>
        <p>
          Live channel owner:{' '}
          {connections?.liveChannelOwner === 'platform'
            ? 'AI-Agent-Platform (connection pending)'
            : 'Sahayak'}
          .
        </p>
        <p>
          Draft service:{' '}
          {connections?.platform.configured
            ? 'AI-Agent-Platform configured; availability not verified'
            : 'Sahayak local builder'}
          .
        </p>
        {isDoctor && <a href="/doctor/integrations">Connected software setup</a>}
      </details>
    </section>
  );
}
