'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { staff } from '../../../../lib/api';
import { useStaffLang } from '../../../../lib/staffText';

type Status = {
  whatsapp: {
    active: boolean;
    number: string | null;
    inbound: { count: number; latest_at: string | null };
  };
  lateNoticeDeliveryReady: boolean;
  feedbackPublicFormsReady: boolean;
  backgroundJobsEnabled: boolean;
};
type Feedback = { ready: boolean; settings: { enabled: boolean }; message: string };

export function LiveJourney() {
  const { x, lang } = useStaffLang();
  const [status, setStatus] = useState<Status | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError('');
    setStatus(null);
    setFeedback(null);
    const [liveResult, feedbackResult] = await Promise.allSettled([
        staff<Status>('/staff/agents/live-test'),
        staff<Feedback>('/staff/feedback/messaging'),
    ]);
    if (liveResult.status === 'fulfilled') setStatus(liveResult.value);
    else setError(liveResult.reason?.message ?? x('Connection status is unavailable.'));
    if (feedbackResult.status === 'fulfilled') setFeedback(feedbackResult.value);
    setBusy(false);
  }
  useEffect(() => { void refresh(); }, []);
  return <section className="card" aria-label={x('Test a real patient journey')}>
    <h3>{x('Test a real patient journey')}</h3>
    <p>{x('Use only a WhatsApp number you control and test patient details. A practice chat does not prove a real message was delivered.')}</p>
    <button className="ghost small" type="button" disabled={busy} onClick={() => void refresh()}>{x('Refresh live test status')}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {status && <>
      <p role="status"><b>{status.whatsapp.active ? x('WhatsApp replies are active') : x('WhatsApp needs connection review')}</b>
        {status.whatsapp.number ? ` · ${status.whatsapp.number}` : ''}</p>
      <ol>
        <li>{x('Send Hi from your own WhatsApp to the connected clinic number. Ask for an appointment, choose a slot and confirm it.')} {status.whatsapp.active ? '' : x('This step is paused until the clinic connection is verified.')}</li>
        <li>{x('Refresh this status after the reply. A received bridge event appears below; then check the patient record for the saved appointment. Booking does not issue a queue token.')} <Link href="/doctor">{x('Today’s clinic')}</Link></li>
        <li>{x('On the visit day, check in through the clinic arrival page. Reception verifies any required payment; then the patient receives a queue token.')} <Link href="/doctor">{x('Today’s clinic')}</Link></li>
        <li>{x('If the doctor is late, review the affected appointments and confirm the change in Today’s clinic.')} {status.lateNoticeDeliveryReady ? x('A live delivery adapter is configured; verify a real message before relying on it.') : x('Live late notices are unavailable here. Staff must contact affected patients.')} </li>
        <li>{x('Finish the visit to schedule feedback. An invitation needs patient consent, an approved WhatsApp template and a public HTTPS form.')} <Link href="/doctor/checkins">{x('Patient feedback')}</Link> · <Link href="/admin/messages">{x('Message delivery setup')}</Link></li>
        <li>{x('Phone calls use separate voice setup. Check Phone calls before trying an incoming or outgoing call.')} <Link href="/admin/agents#phone">{x('Phone calls')}</Link></li>
      </ol>
      <p><b>{x('Real WhatsApp messages received by Sahayak:')}</b> {status.whatsapp.inbound.count}
        {status.whatsapp.inbound.latest_at ? ` · ${x('Latest:')} ${new Date(status.whatsapp.inbound.latest_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}` : ''}</p>
      <p><b>{x('Automatic feedback invitations:')}</b> {feedback
        ? <>{feedback.settings.enabled ? x('On') : x('Paused')}{' · '}{feedback.ready ? x('Delivery setup ready') : x('Delivery setup incomplete')}</>
        : x('Feedback delivery status unavailable')}</p>
      {!status.backgroundJobsEnabled && <p>{x('Background sending is paused on this server. Scheduled invitations and reminders will not run automatically yet.')}</p>}
      {!status.feedbackPublicFormsReady && <p>{x('A public HTTPS patient form address is still needed for live feedback links.')}</p>}
      {feedback && <p className="muted">{x(feedback.message)}</p>}
      <p className="muted">{x('A received event confirms Sahayak handled a provider callback. Confirm the reply on your phone, the saved appointment, and the delivery receipt before calling the journey complete.')}</p>
    </>}
  </section>;
}
