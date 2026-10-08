'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, staff } from '../../lib/api';
const labels: Record<string, string> = {
  whatsapp: 'WhatsApp assistant',
  phone: 'Phone assistant',
  reminders: 'Reminders & updates',
};
export default function DoctorAssistantAccess({
  personal = false,
  onAccess,
  onReminders,
}: {
  personal?: boolean;
  onAccess?: (allowed: boolean) => void;
  onReminders?: () => void;
}) {
  const [doctors, setDoctors] = useState<any[]>([]),
    [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const data = await staff('/staff/agents/access');
    setDoctors(data.doctors);
    setLoading(false);
    onAccess?.(!!data.doctors[0]?.assistants.find((a: any) => a.kind === 'reminders')?.allowed);
    if (personal) setStatus(await staff('/staff/agents/my-status'));
  }, [personal, onAccess]);
  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
  }, [load]);
  async function save(doctorId: string, kind: string, value: boolean) {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api(personal ? '/staff/agents/preferences' : '/staff/agents/access', {
        method: 'PUT',
        body: personal ? { kind, enabled: value } : { doctorId, kind, allowed: value },
        auth: true,
      });
      await load();
      setSaved('Saved.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (personal)
    return (
      <section aria-label="Help for my patients">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="assistant-saved" role="status">
            Your choice has been saved.
          </p>
        )}
        {loading && <p role="status">Loading your assistants…</p>}
        {!loading && !doctors.length && !error && (
          <p>Your clinic admin needs to link your doctor profile first.</p>
        )}
        {doctors.map((d) => (
          <div className="assistant-choice-grid" key={d.id}>
            {d.assistants.map((a: any) => {
              const copy = {
                whatsapp: {
                  icon: '✉',
                  title: 'Reply to patients',
                  description:
                    'Help patients with clinic questions and appointment booking on WhatsApp.',
                },
                phone: {
                  icon: '☎',
                  title: 'Help with phone calls',
                  description:
                    'Let the phone assistant answer routine questions and help patients book a visit.',
                },
                reminders: {
                  icon: '◷',
                  title: 'Stay in touch',
                  description:
                    'Prepare a thank-you message, a visit reminder, or your daily summary.',
                },
              }[a.kind as 'whatsapp' | 'phone' | 'reminders'];
              const connected = a.kind === 'reminders' || status?.[a.kind] === true;
              const checking = a.kind !== 'reminders' && status === null;
              const state = a.clinicManaged
                ? 'Managed by clinic'
                : !a.allowed
                  ? 'Ask your admin'
                  : !a.enabled
                    ? 'Paused'
                    : checking
                      ? 'Checking connection'
                      : connected
                        ? 'On for you'
                        : 'Setup needed';
              const help = !a.allowed
                ? a.clinicManaged
                  ? 'Your clinic manages this help. Ask Admin if you would like your own controls.'
                  : 'Ask your clinic admin to give you access to this assistant.'
                : checking
                  ? 'Checking whether the clinic connection is ready.'
                  : !connected
                    ? 'Your admin needs to connect this service. You can save your preference now.'
                    : a.kind === 'reminders'
                      ? 'You review each message and schedule before it starts. Sending also needs a working WhatsApp connection.'
                      : 'Your choice applies to conversations for you. Other doctors keep their own settings.';
              return (
                <article className="assistant-choice-card" key={a.kind}>
                  <div className="assistant-choice-top">
                    <span className="assistant-choice-icon" aria-hidden="true">
                      {copy.icon}
                    </span>
                    <span
                      className={`assistant-state ${a.allowed && a.enabled && connected ? 'is-on' : ''}`}
                    >
                      {state}
                    </span>
                  </div>
                  <h2>{copy.title}</h2>
                  <p>{copy.description}</p>
                  <p className="assistant-choice-help">{help}</p>
                  <div className="assistant-choice-actions">
                    {a.allowed ? (
                      <button
                        className={a.enabled ? 'ghost' : ''}
                        disabled={busy}
                        aria-label={`${a.enabled ? 'Pause' : 'Turn on'} ${labels[a.kind]}`}
                        onClick={() => save(d.id, a.kind, !a.enabled)}
                      >
                        {busy
                          ? 'Saving…'
                          : a.enabled
                            ? 'Pause for me'
                            : connected
                              ? 'Turn on for me'
                              : 'Enable when connected'}
                      </button>
                    ) : (
                      // A greyed-out button reads as broken. This is a decision the clinic admin makes, so say so plainly.
                      <p className="assistant-locked" role="note">
                        🔒 Your clinic admin controls this assistant.
                      </p>
                    )}
                    {a.kind === 'reminders' && a.allowed && (
                      <button className="ghost" onClick={onReminders}>
                        Choose a reminder →
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
        <a className="assistant-inbox-link" href="/doctor/inbox">
          <span>
            <b>Patient messages</b>
            <span>Review questions and concerns that need your team’s attention.</span>
          </span>
          <span aria-hidden="true">→</span>
        </a>
        <details className="assistant-explainer">
          <summary>What happens when I pause an assistant?</summary>
          <p>
            For WhatsApp and phone conversations linked to you, reception takes over. General clinic
            enquiries and other doctors’ assistants keep working. Emergency checks stay on.
          </p>
          <p>
            Pausing personal reminders stops your active tasks and cancels pending runs. When you
            turn them back on, review and resume each task. Your clinic’s shared reminders and
            patient check-in messages are managed separately by Admin.
          </p>
        </details>
      </section>
    );
  return (
    <section className="card" style={{ marginBottom: 24 }}>
      <h2>{personal ? 'My assistant controls' : 'Assistant access for each doctor'}</h2>
      <p>
        {personal
          ? 'Choose which permitted assistants help your patients. Pausing your assistant does not switch off the clinic connection or another doctor’s assistants.'
          : 'Allow each doctor to manage WhatsApp, phone, and reminders separately. The doctor then chooses whether to enable them. Revoking access pauses that doctor’s assistant.'}
      </p>
      <p className="muted">
        Existing clinic-managed services stay as they are until an individual rule is saved. Once
        access is granted, the doctor must enable that assistant. Shared safety rules and
        connections remain under Admin control.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      {loading && <p role="status">Loading assistant access…</p>}
      {!loading && !doctors.length && !error && <p>No active doctor profile is available.</p>}
      {doctors.map((d) => (
        <div key={d.id} className="card" style={{ marginTop: 12 }}>
          <h3>{d.name}</h3>
          {d.assistants.map((a: any) => (
            <div
              key={a.kind}
              className="row between"
              style={{ padding: '12px 0', gap: 12, flexWrap: 'wrap' }}
            >
              <div>
                <b>{labels[a.kind]}</b>
                <p className="muted" style={{ margin: 0 }}>
                  {a.clinicManaged
                    ? 'Clinic-managed · personal access not granted'
                    : !a.allowed
                      ? 'Access not granted'
                      : a.enabled
                        ? 'Enabled by doctor'
                        : 'Allowed · paused by doctor'}
                  {personal && a.kind !== 'reminders' && status && (
                    <>
                      {' '}
                      ·{' '}
                      {status[a.kind]
                        ? 'Clinic connection available'
                        : 'Clinic connection needs Admin setup'}
                    </>
                  )}
                </p>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label={`${personal ? 'Enable' : 'Allow'} ${labels[a.kind]} for ${d.name}`}
                  checked={personal ? a.enabled : a.allowed}
                  disabled={busy || (personal && !a.allowed)}
                  onChange={(e) => save(d.id, a.kind, e.target.checked)}
                />
                {personal ? 'Enable for my patients' : 'Allow doctor to manage'}
              </label>
              {!personal && a.clinicManaged && (
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() => save(d.id, a.kind, false)}
                >
                  Disable for this doctor
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {personal && (
        <p className="muted">
          Reminders &amp; updates controls the personal tasks you create below. Clinic-wide
          appointment reminders and patient check-in campaigns remain managed separately by Admin.
        </p>
      )}
      {personal && (
        <p className="muted">
          WhatsApp and phone settings apply once the conversation is linked to you or the patient
          selects you. General clinic enquiries still use the shared assistant. Enabling a
          preference does not establish a live connection.
        </p>
      )}
      {personal && (
        <p>
          <a href="/doctor/inbox">Open patient messages needing attention</a>
        </p>
      )}
    </section>
  );
}
