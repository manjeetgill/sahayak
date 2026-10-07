'use client';
import { useEffect, useState } from 'react';
import { FeedbackWorkspace } from './FeedbackWorkspace';
import { staff } from '../../lib/api';
export function PatientCheckins({ patientId, visitId }: { patientId?: string; visitId?: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [date, setDate] = useState(''),
    [owner, setOwner] = useState(''),
    [language, setLanguage] = useState('en'),
    [consent, setConsent] = useState(false);
  const [reminder, setReminder] = useState(false);
  const load = async () => {
    try {
      setData(await staff(`/staff/patient-checkins${patientId ? `?patientId=${patientId}` : ''}`));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, [patientId]);
  const active = data?.checkins.some(
    (c: any) => c.queue_entry_id === visitId && c.status === 'scheduled',
  );
  if (!visitId) return <FeedbackWorkspace patientId={patientId} />;
  return (
    <section aria-label="Patient check-ins">
      <h3>Patient check-ins</h3>
      <p className="muted">
        Plan when the clinic should check how the patient is doing. WhatsApp invitations require
        delivery setup in Admin → Patient check-in messages. Your automatic check-in settings apply
        when you finish the visit; use this form only for a different time.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading check-ins…</p>}
      {visitId && patientId && data && !active && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await staff('/staff/patient-checkins', {
                patientId,
                queueEntryId: visitId,
                assignedTo: owner,
                scheduledAt: new Date(date).toISOString(),
                language,
                consent,
                reminder,
              });
              setConsent(false);
              await load();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Check-in date and time (your local time)
            <input
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Responsible person
            <select required value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Choose a staff member</option>
              {data.staff.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.role === 'doctor' ? 'Doctor' : 'Reception'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Patient’s preferred language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            The patient agreed to this check-in and knows they can opt out through the clinic or by
            replying STOP.
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={reminder}
              onChange={(e) => setReminder(e.target.checked)}
            />
            Allow one reminder after two days if there is no response.
          </label>
          <button disabled={busy}>{busy ? 'Saving…' : 'Schedule check-in'}</button>
        </form>
      )}
      {data?.checkins.length === 0 && <p>No patient check-ins recorded.</p>}
      <div className="list">
        {data?.checkins.map((c: any) => (
          <article key={c.id} className="card">
            {!patientId && <a href={`/doctor/patients/${c.patient_id}`}>{c.patient_name}</a>}
            <p>
              <strong>
                {c.status === 'cancelled'
                  ? 'Cancelled'
                  : c.overdue
                    ? 'Due — needs staff attention'
                    : 'Scheduled'}
              </strong>{' '}
              · {new Date(c.scheduled_at).toLocaleString()}
            </p>
            <p>
              {c.assignee} · {c.language === 'hi' ? 'Hindi' : 'English'}
            </p>
            <p className="muted">
              Patient agreement recorded {new Date(c.consented_at).toLocaleString()}
              {c.cancellation_reason === 'consent_withdrawn'
                ? ' · Messaging permission withdrawn'
                : ''}
            </p>
            {c.status === 'scheduled' && (
              <button
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await staff(`/staff/patient-checkins/${c.id}`, undefined, 'DELETE');
                    await load();
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cancel check-in
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
