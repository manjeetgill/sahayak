'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
type Settings = {
  enabled: boolean;
  delayDays: number;
  sendTime: string;
  assignedTo: string | null;
  reminder: boolean;
  waitingQuestion: boolean;
  eveningEnabled: boolean;
  eveningNights: number;
  eveningTime: string;
};
export function FeedbackPreferences() {
  const { x } = useStaffLang();
  const [data, setData] = useState<any>(null),
    [form, setForm] = useState<Settings | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    staff('/staff/patient-checkins/preferences')
      .then((d) => {
        setData(d);
        setForm({
          enabled: d.enabled,
          delayDays: d.delayDays,
          sendTime: d.sendTime,
          assignedTo: d.assignedTo,
          reminder: d.reminder,
          waitingQuestion: d.waitingQuestion,
          eveningEnabled: d.eveningEnabled,
          eveningNights: d.eveningNights,
          eveningTime: d.eveningTime,
        });
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card" aria-label={x('Automatic feedback settings')}>
      <h2>{x('Feedback after my consultations')}</h2>
      <p>
        {x(
          'Set this once. Finishing a visit will schedule feedback automatically for patients who have agreed to WhatsApp messages and follow-ups. You can change it anytime.',
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!form && !error && <p>{x('Loading your settings…')}</p>}
      {form && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              await staff('/staff/patient-checkins/preferences', form, 'PUT');
              setMessage(x('Your patient message choices are saved for future visits.'));
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>{x('While the patient waits')}</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={form.waitingQuestion}
                onChange={(e) => setForm({ ...form, waitingQuestion: e.target.checked })}
              />
              {x('Ask one question on the patient’s private queue page')}
            </label>
            <p className="muted">
              {x(
                'The patient can tell you one thing they want to discuss. Their answer appears in your queue and pre-visit brief. This works even without WhatsApp.',
              )}
            </p>
          </div>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <h3>{x('Evening recovery check-ins')}</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={form.eveningEnabled}
                onChange={(e) => setForm({ ...form, eveningEnabled: e.target.checked })}
              />
              {x('Ask how the patient feels each evening after the visit')}
            </label>
            <label htmlFor="evening-nights">{x('Number of evenings')}</label>
            <select
              id="evening-nights"
              value={form.eveningNights}
              onChange={(e) => setForm({ ...form, eveningNights: Number(e.target.value) })}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label htmlFor="evening-time">
              {x('Evening time')} ({data.timezone})
            </label>
            <input
              id="evening-time"
              type="time"
              min="18:00"
              max="20:59"
              required
              value={form.eveningTime}
              onChange={(e) => setForm({ ...form, eveningTime: e.target.value })}
            />
            <p className="muted">
              {x(
                'Only patients who separately agree to evening messages receive them. Replies appear in the clinic work list. If someone feels worse or asks for help, later automatic messages stop until a person reviews the concern. Live delivery needs a working WhatsApp connection.',
              )}
            </p>
            {!data.eveningDeliveryReady && (
              <p className="banner warn">
                {x(
                  'Evening message delivery is not ready. You can save this choice, but no live evening message will be sent until the WhatsApp sending connection and background jobs are active.',
                )}
              </p>
            )}
          </div>
          <h3>{x('After the consultation')}</h3>
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            {x('Automatically schedule feedback when I finish a visit')}
          </label>
          <label htmlFor="feedback-delay">{x('When should we check on the patient?')}</label>
          <select
            id="feedback-delay"
            value={form.delayDays}
            onChange={(e) => setForm({ ...form, delayDays: Number(e.target.value) })}
          >
            <option value={-1}>{x('About 30 minutes after the visit')}</option>
            {Array.from({ length: 31 }, (_, n) => (
              <option key={n} value={n}>
                {n === 0
                  ? x('Same day')
                  : n === 1
                    ? x('Next day')
                    : `${n} ${x('days after the visit')}`}
              </option>
            ))}
          </select>
          {form.delayDays === -1 ? (
            <p className="muted">
              {x(
                'We use 8 am to 9 pm for this option; visits ending late are checked the next morning.',
              )}
            </p>
          ) : (
            <>
              <label htmlFor="feedback-time">
                {x('Time')} ({data.timezone})
              </label>
              <input
                id="feedback-time"
                type="time"
                min="08:00"
                max="20:59"
                required
                value={form.sendTime}
                onChange={(e) => setForm({ ...form, sendTime: e.target.value })}
              />
              <p className="muted">
                {x(
                  'If that time has already passed, the check-in is scheduled at this time the next day.',
                )}
              </p>
            </>
          )}
          <label htmlFor="feedback-owner">{x('Who will follow up on responses?')}</label>
          <select
            id="feedback-owner"
            value={form.assignedTo ?? ''}
            onChange={(e) => setForm({ ...form, assignedTo: e.target.value || null })}
          >
            <option value="">{x('Me / this patient’s doctor')}</option>
            {data.staff.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name} — {x(u.role === 'doctor' ? 'Doctor' : 'Receptionist')}
              </option>
            ))}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={form.reminder}
              onChange={(e) => setForm({ ...form, reminder: e.target.checked })}
            />
            {x('Allow one reminder after two days without a response')}
          </label>
          <p>
            {x(
              'Uses the patient’s saved language. Changing these settings affects future visit completions; existing check-ins keep their scheduled time. You can cancel them individually.',
            )}
          </p>
          <p className="muted">
            {data.deliveryEnabled
              ? x(
                  'WhatsApp invitations are enabled by your admin. Each send still checks the connection and patient permission.',
                )
              : x(
                  'WhatsApp invitations are paused. Check-ins will still be scheduled; your admin must enable delivery under Admin → Patient check-in messages.',
                )}
          </p>
          <button disabled={busy}>{x(busy ? 'Saving…' : 'Save feedback settings')}</button>
        </form>
      )}
    </section>
  );
}
