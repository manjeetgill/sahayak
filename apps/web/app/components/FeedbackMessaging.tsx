'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function FeedbackMessaging() {
  const { x, lang } = useStaffLang();
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
      <h2>{x('WhatsApp check-in messages')}</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>{x('Checking the clinic connection…')}</p>}
      {data && (
        <>
          <p>
            <b>
              {data.settings.enabled
                ? x('Automatic invitations enabled')
                : x('Automatic invitations paused')}
            </b>
          </p>
          <p>{x(data.message)}</p>
          {!data.jobsEnabled && (
            <p className="banner warn">
              {x(
                'Automatic patient messages are paused. Your saved invitations will wait until sending is switched on.',
              )}
            </p>
          )}
          <p>
            {x(
              'Messages go out between 8am and 9pm in the clinic’s time zone. A check-in may have one reminder, two days after confirmed delivery, if explicitly selected and no response has arrived. Patients can reply STOP.',
            )}
          </p>
          {data.templates.length > 0 && (
            <>
              <label>
                {x('Clinic-approved invitation')}
                <select
                  value={template}
                  onChange={(e) => {
                    setTemplate(e.target.value);
                    setReviewed(false);
                  }}
                >
                  <option value="">{x('Choose template')}</option>
                  {data.templates.map((t: any) => (
                    <option value={t.id} key={t.id}>
                      {t.name} · {x(t.language === 'hi' ? 'Hindi' : 'English')}
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
                {x(
                  'I reviewed this invitation, which asks patients to reply FEEDBACK, and approve it for scheduled, opted-in patients.',
                )}
              </label>
            </>
          )}
          {evidence && (
            <section>
              <h3>{x('Delivery evidence')}</h3>
              <p>
                <strong>
                  {evidence.summary.delivered > 0
                    ? x('Provider delivery confirmed')
                    : x('No confirmed delivery yet')}
                </strong>
              </p>
              <p>
                {evidence.summary.attempts} {x('invitations prepared')} ·{' '}
                {evidence.summary.delivered} {x('delivered')} · {evidence.summary.read} {x('read')}{' '}
                · {evidence.summary.responses_after_delivery}{' '}
                {x('patient responses after delivery')} · {evidence.summary.needs_review}{' '}
                {x('needing review')}
              </p>
              <p>
                {x(
                  'Queued or accepted means the provider received the request. Only a delivery receipt counts as delivered. A completed live test also needs the patient to open the form and submit a response.',
                )}
              </p>
              {evidence.receipts.slice(0, 10).map((r: any) => (
                <p key={r.id}>
                  {x(r.kind === 'initial' ? 'Invitation' : 'Reminder')}:{' '}
                  <strong>{r.delivered_at ? x('Delivery confirmed') : x(r.state)}</strong>
                  {r.last_checked_at
                    ? ` · ${x('Checked')} ${new Date(r.last_checked_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}`
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
              {x('Enable scheduled invitations')}
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
                {x('Pause future invitations')}
              </button>
            )}
            <button className="ghost" disabled={busy} onClick={() => void load()}>
              {x('Check connection again')}
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
              {x('Refresh delivery status')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
