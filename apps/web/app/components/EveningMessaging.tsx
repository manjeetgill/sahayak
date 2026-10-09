'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

export function EveningMessaging() {
  const { x } = useStaffLang();
  const [data, setData] = useState<any>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [template, setTemplate] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const [setup, proof] = await Promise.all([
        staff('/staff/evening/messaging'),
        staff('/staff/evening/delivery-evidence'),
      ]);
      setData(setup);
      setEvidence(proof);
      setTemplate(setup.settings.template_id ?? '');
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async (enabled: boolean) => {
    setBusy(true);
    setError('');
    try {
      await staff(
        '/staff/evening/messaging',
        { enabled, templateId: enabled ? template : undefined, reviewed: true },
        'PUT',
      );
      setReviewed(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-label={x('Evening WhatsApp messages')}>
      <h2>{x('Evening WhatsApp messages')}</h2>
      <p>
        {x(
          'Doctors choose which patients to check on. Only patients who explicitly agree to evening messages are eligible. Review the approved WhatsApp message before enabling live sending.',
        )}
      </p>
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
              {x(
                data.settings.enabled
                  ? 'Automatic evening messages enabled'
                  : 'Automatic evening messages paused',
              )}
            </b>
          </p>
          <p>{x(data.message)}</p>
          {!data.jobsEnabled && (
            <p className="banner warn">
              {x(
                'Background jobs are paused. Saved evening messages will not go out automatically.',
              )}
            </p>
          )}
          {data.templates.length > 0 && (
            <>
              <label htmlFor="evening-template">{x('Approved evening message')}</label>
              <select
                id="evening-template"
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">{x('Choose template')}</option>
                {data.templates.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.language}
                  </option>
                ))}
              </select>
              <blockquote>{data.templates.find((t: any) => t.id === template)?.text}</blockquote>
              <p className="muted">
                {x(
                  'This template is sent only to patients whose saved language matches it. Contact other patients personally until you approve a template in their language.',
                )}
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {x(
                  'I reviewed this message. It asks how the patient feels and invites BETTER or WORSE replies without giving medical advice.',
                )}
              </label>
            </>
          )}
          <div className="feedback-actions">
            <button
              disabled={busy || !data.ready || !template || !reviewed}
              onClick={() => void save(true)}
            >
              {x('Enable evening sending')}
            </button>
            {data.settings.enabled && (
              <button className="ghost" disabled={busy} onClick={() => void save(false)}>
                {x('Pause evening sending')}
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
                try {
                  await staff('/staff/evening/delivery-refresh', {});
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
          {evidence && (
            <p>
              {evidence.summary.attempts} {x('messages prepared')} · {evidence.summary.delivered}{' '}
              {x('delivery confirmations')} · {evidence.summary.needs_review} {x('needing review')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
