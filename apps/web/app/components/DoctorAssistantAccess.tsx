'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, staff, useSession } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
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
  const { x } = useStaffLang();
  const current = useSession();
  const clinicOwner = personal && current?.user.role === 'doctor' && current.user.clinicAdmin;
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
      setSaved(x('Saved.'));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (personal)
    return (
      <section aria-label={x('Help for my patients')}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="assistant-saved" role="status">
            {x('Your choice has been saved.')}
          </p>
        )}
        {loading && <p role="status">{x('Loading your assistants…')}</p>}
        {!loading && !doctors.length && !error && (
          <p>{x('Your clinic admin needs to link your doctor profile first.')}</p>
        )}
        {doctors.map((d) => (
          <div className="assistant-choice-grid" key={d.id}>
            {d.assistants.map((a: any) => {
              const copy = {
                whatsapp: {
                  icon: '✉',
                  title: x('Reply to patients'),
                  description: x('Help patients with clinic questions and appointment booking on WhatsApp.'),
                },
                phone: {
                  icon: '☎',
                  title: x('Help with phone calls'),
                  description: x('Let the phone assistant answer routine questions and help patients book a visit.'),
                },
                reminders: {
                  icon: '◷',
                  title: x('Stay in touch'),
                  description: x('Prepare a thank-you message, a visit reminder, or your daily summary.'),
                },
              }[a.kind as 'whatsapp' | 'phone' | 'reminders'];
              const connected = a.kind === 'reminders' || status?.[a.kind] === true;
              const checking = a.kind !== 'reminders' && status === null;
              const allowed = a.allowed || clinicOwner;
              const enabled = a.clinicManaged && clinicOwner ? true : a.enabled;
              const state = a.clinicManaged && !clinicOwner
                ? x('Managed by clinic')
                : !allowed
                  ? x('Ask your admin')
                  : !enabled
                    ? x('Paused')
                    : checking
                      ? x('Checking connection')
                      : connected
                        ? x('On for you')
                        : x('Setup needed');
              const help = !allowed
                ? a.clinicManaged
                  ? x('Your clinic manages this help. Ask Admin if you would like your own controls.')
                  : x('Ask your clinic admin to give you access to this assistant.')
                : checking
                  ? x('Checking whether the clinic connection is ready.')
                  : !connected
                    ? clinicOwner
                      ? x('Connect this service under Clinic setup. You can save your choice now.')
                      : x('Your admin needs to connect this service. You can save your preference now.')
                    : a.kind === 'reminders'
                      ? x('You review each message and schedule before it starts. Sending also needs a working WhatsApp connection.')
                      : x('Your choice applies to conversations for you. Other doctors keep their own settings.');
              return (
                <article className="assistant-choice-card" key={a.kind}>
                  <div className="assistant-choice-top">
                    <span className="assistant-choice-icon" aria-hidden="true">
                      {copy.icon}
                    </span>
                    <span
                      className={`assistant-state ${allowed && enabled && connected ? 'is-on' : ''}`}
                    >
                      {state}
                    </span>
                  </div>
                  <h2>{copy.title}</h2>
                  <p>{copy.description}</p>
                  <p className="assistant-choice-help">{help}</p>
                  <div className="assistant-choice-actions">
                    {allowed ? (
                      <button
                        className={enabled ? 'ghost' : ''}
                        disabled={busy}
                        aria-label={`${x(enabled ? 'Pause' : 'Turn on')} ${x(labels[a.kind])}`}
                        onClick={() => save(d.id, a.kind, !enabled)}
                      >
                        {busy
                          ? x('Saving…')
                          : enabled
                            ? x('Pause for me')
                            : connected
                              ? x('Turn on for me')
                              : x('Enable when connected')}
                      </button>
                    ) : (
                      // A greyed-out button reads as broken. This is a decision the clinic admin makes, so say so plainly.
                      <p className="assistant-locked" role="note">
                        🔒 {x('Your clinic admin controls this assistant.')}
                      </p>
                    )}
                    {a.kind === 'reminders' && allowed && onReminders && (
                      <button className="ghost" onClick={onReminders}>
                        {x('Choose a reminder →')}
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
            <b>{x('Patient messages')}</b>
            <span>{x('Review questions and concerns that need your team’s attention.')}</span>
          </span>
          <span aria-hidden="true">→</span>
        </a>
        <details className="assistant-explainer">
          <summary>{x('What happens when I pause an assistant?')}</summary>
          <p>
            {x('For WhatsApp and phone conversations linked to you, the clinic work list receives requests that need a person. Emergency checks stay on.')}
          </p>
          <p>
            {x('Pausing personal reminders stops your active tasks and cancels pending runs. When you turn them back on, review and resume each task.')}
          </p>
        </details>
      </section>
    );
  return (
    <section className="card" style={{ marginBottom: 24 }}>
      <h2>{x(personal ? 'My assistant controls' : 'Assistant access for each doctor')}</h2>
      <p>
        {x(personal
          ? 'Choose which permitted assistants help your patients. Pausing your assistant does not switch off the clinic connection or another doctor’s assistants.'
          : 'Allow each doctor to manage WhatsApp, phone, and reminders separately. The doctor then chooses whether to enable them. Revoking access pauses that doctor’s assistant.')}
      </p>
      <p className="muted">
        {x("Existing clinic-managed services stay as they are until an individual rule is saved. Once access is granted, the doctor must enable that assistant. Shared safety rules and connections remain under Admin control.")}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && <p role="status">{x(saved)}</p>}
      {loading && <p role="status">{x("Loading assistant access…")}</p>}
      {!loading && !doctors.length && !error && <p>{x("No active doctor profile is available.")}</p>}
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
                <b>{x(labels[a.kind])}</b>
                <p className="muted" style={{ margin: 0 }}>
                  {x(a.clinicManaged
                    ? 'Clinic-managed · personal access not granted'
                    : !a.allowed
                      ? 'Access not granted'
                      : a.enabled
                        ? 'Enabled by doctor'
                        : 'Allowed · paused by doctor')}
                  {personal && a.kind !== 'reminders' && status && (
                    <>
                      {' '}
                      ·{' '}
                      {x(status[a.kind]
                        ? 'Clinic connection available'
                        : 'Clinic connection needs Admin setup')}
                    </>
                  )}
                </p>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label={`${x(personal ? 'Enable' : 'Allow')} ${x(labels[a.kind])} ${x('for')} ${d.name}`}
                  checked={personal ? a.enabled : a.allowed}
                  disabled={busy || (personal && !a.allowed)}
                  onChange={(e) => save(d.id, a.kind, e.target.checked)}
                />
                {x(personal ? 'Enable for my patients' : 'Allow doctor to manage')}
              </label>
              {!personal && a.clinicManaged && (
                <button
                  className="ghost small"
                  disabled={busy}
                  onClick={() => save(d.id, a.kind, false)}
                >
                  {x("Disable for this doctor")}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {personal && (
        <p className="muted">
          {x("Reminders &amp; updates controls the personal tasks you create below. Clinic-wide appointment reminders and patient check-in campaigns remain managed separately by Admin.")}
        </p>
      )}
      {personal && (
        <p className="muted">
          {x("WhatsApp and phone settings apply once the conversation is linked to you or the patient selects you. General clinic enquiries still use the shared assistant. Enabling a preference does not establish a live connection.")}
        </p>
      )}
      {personal && (
        <p>
          <a href="/doctor/inbox">{x("Open patient messages needing attention")}</a>
        </p>
      )}
    </section>
  );
}
