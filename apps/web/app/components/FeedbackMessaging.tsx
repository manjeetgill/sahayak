'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
export function FeedbackMessaging() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [evidence, setEvidence] = useState<any>(null);
  const load = async () => {
    try {
      const d = await staff('/staff/feedback/messaging');
      setData(d);
      setTemplate(d.settings.template_id ?? '');
      setEvidence(await staff('/staff/feedback/delivery-evidence'));
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="card">
      <h2>WhatsApp check-in messages</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>Checking the clinic connection…</p>}
      {data && (
        <>
          <p>
            <b>
              {data.settings.enabled
                ? 'Automatic invitations enabled'
                : 'Automatic invitations paused'}
            </b>
          </p>
          <p>{data.message}</p>
          <p>
            Messages go out between 8am and 9pm in the clinic’s time zone. A check-in may have one
            reminder, two days after confirmed delivery, if explicitly selected and no response has
            arrived. Patients can reply STOP.
          </p>
          {data.templates.length > 0 && (
            <>
              <label>
                Clinic-approved invitation
                <select
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    setReviewed(false);
                  }}
                >
                  <option value="">Choose template</option>
                  {data.templates.map((t: any) => (
                    <option value={t.id} key={t.id}>
                      {t.name} · {t.language}
                    </option>
                  ))}
                </select>
              </label>
              <blockquote>{data.templates.find((t: any) => t.id === template)?.text}</blockquote>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed this invitation, which asks patients to reply FEEDBACK, and approve it
                for scheduled, opted-in patients.
              </label>
            </>
          )}
          {evidence && (
            <section>
              <h3>Delivery evidence</h3>
              <p>
                <strong>
                  {evidence.summary.delivered > 0
                    ? 'Provider delivery confirmed'
                    : 'No confirmed delivery yet'}
                </strong>
              </p>
              <p>
                {evidence.summary.attempts} invitations prepared · {evidence.summary.delivered}{' '}
                delivered · {evidence.summary.read} read ·{' '}
                {evidence.summary.responses_after_delivery} patient responses after delivery ·{' '}
                {evidence.summary.needs_review} needing review
              </p>
              <p>
                Queued or accepted means the provider received the request. Only a delivery receipt
                counts as delivered. A completed live test also needs the patient to open the form
                and submit a response.
              </p>
              {evidence.receipts.slice(0, 10).map((r: any) => (
                <p key={r.id}>
                  {r.kind === 'initial' ? 'Invitation' : 'Reminder'}:{' '}
                  <strong>{r.delivered_at ? 'Delivery confirmed' : r.state}</strong>
                  {r.last_checked_at
                    ? ' · Checked ' + new Date(r.last_checked_at).toLocaleString()
                    : ''}
                  {r.detail ? ' · ' + r.detail : ''}
                </p>
              ))}
            </section>
          )}
          <div className="feedback-actions">
            <button
              disabled={busy || !data.ready || !reviewed || !template}
              onClick={async () => {
                setBusy(true);
                try {
                  await staff(
                    '/staff/feedback/messaging',
                    { enabled: true, templateId: template, reviewed: true },
                    'PUT',
                  );
                  await load();
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Enable scheduled invitations
            </button>
            {data.settings.enabled && (
              <button
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await staff(
                      '/staff/feedback/messaging',
                      { enabled: false, reviewed: true },
                      'PUT',
                    );
                    await load();
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Pause future invitations
              </button>
            )}
            <button className="ghost" disabled={busy} onClick={() => void load()}>
              Check connection again
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await staff('/staff/feedback/delivery-refresh', {});
                  await load();
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh delivery status
            </button>
          </div>
        </>
      )}
    </section>
  );
}
