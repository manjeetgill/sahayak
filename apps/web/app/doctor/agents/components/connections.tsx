'use client';
import { useStaffLang } from '../../../../lib/staffText';
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
const taskHelp: Record<string, { when: string; example: string; control: string; needs: string }> =
  {
    checkin: {
      when: 'A patient completes the clinic’s check-in flow.',
      example: 'Their arrival is recorded and they receive a token for the selected doctor.',
      control:
        'Reception handles corrections. In the payment-based QR flow, payment must be confirmed before the patient joins the queue.',
      needs:
        'Patient details and consent. Any message sent to their phone also needs a working messaging connection.',
    },
    queue: {
      when: 'A patient asks about their turn or staff update the queue.',
      example:
        'The patient can check their token and estimated wait while the team sees queue progress.',
      control:
        'The doctor or receptionist calls the next patient. The assistant does not decide who should receive priority care.',
      needs:
        'An up-to-date queue. Phone messages need a working connection; the clinic queue screen works separately.',
    },
    intake: {
      when: 'The clinic starts intake for a checked-in patient.',
      example:
        'It asks why the patient is visiting and collects answers to your saved intake questions.',
      control:
        'The doctor reviews the patient’s answers and summary. The assistant does not diagnose or prescribe.',
      needs:
        'Saved intake questions and a patient conversation. Sending questions on WhatsApp needs a working connection.',
    },
    front_desk: {
      when: 'A patient asks a routine clinic question or wants help booking.',
      example:
        'It can share opening hours, location and saved answers, and help find an appointment.',
      control:
        'Your team keeps clinic details correct and handles questions that need a person. Medical questions need clinical review.',
      needs:
        'Current clinic details and appointment availability. Real WhatsApp or phone conversations need that service connected.',
    },
    schedule: {
      when: 'A doctor or staff member records a delay.',
      example:
        'For a 30-minute delay, it prepares affected appointment changes and patient notifications.',
      control:
        'Staff review and approve the proposed changes. Patients can respond to keep the new time or ask for another slot.',
      needs:
        'Booked appointments, the delay entered by staff, and a working messaging connection for notifications.',
    },
    followup: {
      when: 'A saved follow-up or eligible reminder becomes due.',
      example: 'A patient who agreed to reminders receives a prompt about a follow-up visit.',
      control:
        'The doctor sets the care plan. Staff review patient concerns; the assistant does not change treatment.',
      needs:
        'A follow-up plan or reminder schedule, patient consent, and a working messaging connection. Feedback invitation delivery has separate setup.',
    },
    leads: {
      when: 'A new patient contacts the clinic.',
      example:
        'It collects their name and reason for contacting the clinic, then helps with the next booking step.',
      control:
        'Reception follows up on enquiries that need a person. An enquiry alone is not a confirmed appointment.',
      needs:
        'Patient-provided details and an incoming conversation. Real messages need a working connection.',
    },
    records: {
      when: 'A patient uploads a supported report or document.',
      example: 'The uploaded file is saved with the patient’s records for the doctor to review.',
      control:
        'The doctor checks the original document and any extracted information. Uploading a report does not mean it has been medically reviewed.',
      needs:
        'A supported file and the patient record. Receiving it through WhatsApp also needs a connected service.',
    },
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
  canManage,
  view = 'overview',
}: {
  canManage: boolean;
  view?: 'overview' | 'whatsapp' | 'phone';
}) {
  const { x: ui } = useStaffLang();
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
      setMessage(`${ui(labels[name])} ${ui(enabled ? '— task enabled' : '— task paused')}.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`connections-workspace connections-${view}`}
      aria-label={ui('Patient contact options and clinic tasks')}
    >
      <div className="connection-main">
        <div className="connection-status-panel">
          <h2>
            {view === 'overview'
              ? ui('Patient messages and calls')
              : view === 'phone'
                ? ui('Phone calls')
                : ui('WhatsApp messages')}
          </h2>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="ghost small" disabled={busy} onClick={() => void load()}>
            {ui("Refresh status")}
          </button>
          {!connections && !error && <p role="status">{ui("Loading connections…")}</p>}
          {connections && (
            <>
              <p className="muted">
                {ui('These connections carry messages and calls to real patients. “Task enabled” on the left does not confirm that a message was delivered or a phone call worked.')}
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
                    <h3>{ui(name)}</h3>
                    <p>
                      {connections.liveChannelOwner === 'platform'
                        ? configured
                          ? ui('Connection configured · test a real conversation')
                          : ui('Not connected yet · practice only')
                        : configured
                          ? ui('Setup entered · a real conversation still needs testing')
                          : ui('Not connected yet · practice only')}
                    </p>
                    {name === 'Phone' && connections.phone.requestedNumber && (
                      <p>
                        {ui('Intended calling number:')} <b>{connections.phone.requestedNumber}</b>
                      </p>
                    )}
                    {name === 'Phone' && connections.phone.bookingAdapter && (
                      <p role="status">
                        {connections.phone.state === 'UNAVAILABLE'
                          ? ui('Agent service unavailable. Other clinic features remain available.')
                          : connections.phone.state === 'AWAITING_VOICE_PROVIDER'
                            ? ui('Appointment flow ready. Voice number authorization is still required before a real phone test.')
                            : connections.phone.configured
                              ? ui('Calling enabled. Complete a real phone test before relying on it.')
                              : ui('Calling is paused.')}
                      </p>
                    )}
                    <p className="muted">
                      {ui('Uses the clinic tasks you choose under Everyday help. Turning a task on does not connect live messages or calls.')}
                    </p>
                    {simulator && connections.slug && (
                      <a href={`/c/${encodeURIComponent(connections.slug)}/${path}`}>
                        {ui('Try a')} {ui(name === 'Phone' ? 'phone' : 'WhatsApp')} {ui('conversation')}
                      </a>
                    )}
                    {!simulator && <p className="muted">{ui("Practice conversations are unavailable.")}</p>}
                  </div>
                ))}
              <p className="muted">
                {ui('Practice conversations are saved in the clinic. Use made-up patient details. No real message is sent and no phone is called.')}
              </p>
            </>
          )}
          {view === 'whatsapp' && <WhatsAppSetup canManage={canManage} />}
          {view === 'phone' && <CallingSetup canManage={canManage} onChanged={load} />}
        </div>
        {view !== 'overview' && (
          <aside className="workspace-stack">
            {connections?.liveChannelOwner === 'platform' ? (
              <p role="status">
                {view === 'whatsapp' && connections.whatsapp.configured
                  ? ui('Send Hi to your connected clinic number from another WhatsApp number to test a real appointment conversation.')
                  : ui('Live service is not connected yet. Your setup team needs to finish connecting it. You can try the assistant below without contacting a patient.')}
              </p>
            ) : view !== 'phone' ? (
              <Diagnostics />
            ) : null}
            {connections?.simulator && (
              <GuidedTest key={view} channel={view === 'phone' ? 'voice' : 'whatsapp'} />
            )}
          </aside>
        )}
      </div>
      {view === 'overview' && (
        <div className="card everyday-tasks">
          <h2>{ui("What would you like help with?")}</h2>
          <p className="muted">
            {ui('These are the jobs your clinic assistant can help with. They are shared clinic settings; each doctor’s personal access is managed above. Emergency checks always stay on.')}
          </p>
          <div className="task-status-explanation">
            <b>{ui("Task enabled means permission to help.")}</b>
            <p>
              {ui('It does not mean the task is running now. Each task needs its starting event and setup. WhatsApp messages and phone calls also need a working connection. Use “How this works” below to see what the assistant does and what your team still handles.')}
            </p>
          </div>
          {agents &&
            AGENT_NAMES.map((name) => (
              <div className="row between" key={name} style={{ margin: '8px 0' }}>
                <div style={{ flex: 1 }}>
                  <div className="task-title-row">
                    <b>{ui(labels[name])}</b>
                    <span
                      className={`task-setting-status ${agents[name] === false ? 'is-paused' : ''}`}
                    >
                      {ui(agents[name] !== false ? 'Task enabled' : 'Task paused')}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: '4px 0' }}>
                    {ui(descriptions[name])}
                  </p>
                  <details open={canManage} className="task-help">
                    <summary aria-label={`${ui('How this works')}: ${ui(labels[name])}`}>{ui("How this works")}</summary>
                    <dl>
                      <dt>{ui("When it starts")}</dt>
                      <dd>{ui(taskHelp[name].when)}</dd>
                      <dt>{ui("What it does")}</dt>
                      <dd>{ui(taskHelp[name].example)}</dd>
                      <dt>{ui("Your team’s role")}</dt>
                      <dd>{ui(taskHelp[name].control)}</dd>
                      <dt>{ui("What it needs")}</dt>
                      <dd>{ui(taskHelp[name].needs)}</dd>
                    </dl>
                  </details>
                </div>
                {canManage && (
                  <button
                    className="small ghost"
                    disabled={busy}
                    aria-label={`${ui(agents[name] !== false ? 'Pause' : 'Enable')} ${ui('task:')} ${ui(labels[name])}`}
                    onClick={() => void toggle(name, agents[name] === false)}
                  >
                    {ui(agents[name] !== false ? 'Pause task' : 'Enable task')}
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
      {canManage && (
        <p className="connection-footer">
          <a href="/admin/settings">{ui("Edit clinic details and patient safety settings")}</a>
        </p>
      )}
      <details open={canManage} className="card connection-footer" style={{ marginTop: 16 }}>
        <summary>{ui("Connection details for your setup team")}</summary>
        <p>
          {ui('Live channel owner:')}{' '}
          {connections?.liveChannelOwner === 'platform' ? 'AI-Agent-Platform' : 'Sahayak'}.
        </p>
        <p>
          {ui('Draft service:')}{' '}
          {connections?.platform.configured
            ? ui('AI-Agent-Platform configured; availability not verified')
            : ui('Sahayak local builder')}
          .
        </p>
        {canManage && <a href="/admin/integrations">{ui("Connected software setup")}</a>}
      </details>
    </section>
  );
}
