'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useStaffLang } from '../../../../lib/staffText';

type Visit = {
  clinic: string; patientName: string;
  appointments: { id: string; doctor_id: string; doctor: string; starts_at: string; status: string }[];
  instructions: { id: string; body: string; language: string; approved_at: string }[];
  doctors: { id: string; name: string }[];
  reportRequests: { id: string; title: string; due_at: string }[];
  careSteps: { id: string; title: string; message: string; due_at: string; status: string }[];
  queue: { token_number: number; status: string } | null;
  arrival: { status: string; amount_paise: number; online_state: string | null } | null;
};
const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});
export default function MyVisit({ params }: { params: { slug: string } }) {
  const { lang, setLang, x } = useStaffLang();
  const [token, setToken] = useState('');
  const [data, setData] = useState<Visit | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [moveId, setMoveId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [careTaskId, setCareTaskId] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [urgentReply, setUrgentReply] = useState(false);
  const root = `/public/${params.slug}/my-visit`;
  const load = useCallback(async (key: string) => {
    const current = await api<Visit>(root, { body: { token: key } });
    setData(current);
    setDoctorId((old) => old || current.doctors[0]?.id || '');
  }, [root]);
  useEffect(() => {
    const key = location.hash.slice(1);
    setToken(key);
    if (key) void load(key).catch((e) => setError(e.message));
  }, [load]);
  async function act(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); await load(token); setSlots([]); setMoveId(''); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="wrap" style={{ maxWidth: 760 }}>
    <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
    <h1>{x('My visit')}</h1>
    {!token && <p role="alert">{x('Open the private link given to you by the clinic.')}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{x(message)}</p>}
    {urgentReply && <p className="banner urgent" role="alert">{x('Your reply has been flagged for urgent review. If you need immediate help, use local emergency services; do not wait for a clinic message.')}</p>}
    {data && <>
      <p>{data.clinic} · {data.patientName}</p>
      <section className="card"><h2>{x('Today at the clinic')}</h2>
        <p>{data.queue ? <>{x('Your token is')} {data.queue.token_number}. {x('Status:')} {x(data.queue.status.replaceAll('_', ' '))}.</> : x('You have no queue token today.')}</p>
        {data.arrival && <p>{x('Latest QR check-in:')} {x(data.arrival.status.replaceAll('_', ' '))} · ₹{(data.arrival.amount_paise / 100).toFixed(2)}
          {data.arrival.online_state ? ` · ${x('Online payment')} ${x(data.arrival.online_state.replaceAll('_', ' '))}` : ''}.</p>}
      </section>
      <section className="card" aria-label="Approved visit instructions">
        <h2>{lang === 'hi' ? 'डॉक्टर के स्वीकृत निर्देश' : 'Your approved visit instructions'}</h2>
        <p>{lang === 'hi' ? 'अपने निर्देश पढ़ें या प्रिंट करके रखें। यह निजी लिंक केवल आपके लिए है।' : 'Read your instructions or print a copy to keep. This private link is for you.'}</p>
        {!data.instructions?.length && <p>{lang === 'hi' ? 'अभी कोई स्वीकृत निर्देश नहीं है।' : 'No approved instructions are available yet.'}</p>}
        {data.instructions?.map((item) => <article key={item.id}>
          <p>{new Date(item.approved_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}</p>
          <div style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div>
        </article>)}
        {!!data.instructions?.length && <button onClick={() => window.print()}>{lang === 'hi' ? 'प्रिंट करें / PDF के रूप में सहेजें' : 'Print / save as PDF'}</button>}
      </section>
      <section className="card"><h2>{x('Appointments')}</h2>
        {!data.appointments.length && <p>{x('No upcoming appointment.')}</p>}
        {data.appointments.map((a) => <div key={a.id} className="row between" style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
          <div><b>{a.doctor}</b><br />{new Date(a.starts_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {x(a.status.replaceAll('_', ' '))}</div>
          {a.status === 'booked' && <div className="row">
            <button className="ghost small" disabled={busy} onClick={() => { setMoveId(a.id); setDoctorId(a.doctor_id); }}>{x('Change time')}</button>
            <button className="ghost small" disabled={busy} onClick={() => {
              if (confirm(x('Cancel this appointment?'))) void act(() => api(`${root}/cancel`, { body: { token, appointmentId: a.id } }), 'Appointment cancelled.');
            }}>{x('Cancel')}</button>
          </div>}
        </div>)}
      </section>
      <section className="card"><h2>{x(moveId ? 'Choose a new time' : 'Book an appointment')}</h2>
        <label>{x('Doctor')}<select value={doctorId} disabled={!!moveId} onChange={(e) => { setDoctorId(e.target.value); setSlots([]); }}>
          {data.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>{x('Date')}<input type="date" min={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => { setDate(e.target.value); setSlots([]); }} /></label>
        {!moveId && <label>{x('Reason for visit (optional)')}<input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
        <button disabled={busy || !doctorId || !date} onClick={() => {
          setBusy(true); setError(''); setMessage('');
          void api<{ slots: string[] }>(`${root}/slots`, { body: { token, doctorId, date } })
            .then((result) => { setSlots(result.slots); if (!result.slots.length) setMessage('No times are available on this date.'); })
            .catch((e) => setError(e.message)).finally(() => setBusy(false));
        }}>{x('Show available times')}</button>
        {slots.length === 0 && date && <p className="muted">{x('Choose a date and show available times.')}</p>}
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>{slots.map((slot) => <button key={slot} className="ghost" disabled={busy}
          onClick={() => void act(() => api(`${root}/${moveId ? 'reschedule' : 'book'}`, { body: moveId
            ? { token, appointmentId: moveId, newStartsAt: slot }
            : { token, doctorId, startsAt: slot, reason: reason.trim() || undefined } }), moveId ? 'Appointment changed.' : 'Appointment booked.')}>{new Date(slot).toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })}</button>)}</div>
        {moveId && <button className="ghost" onClick={() => { setMoveId(''); setSlots([]); }}>{x('Keep current appointment')}</button>}
      </section>
      <section className="card"><h2>{x('Send a report to your doctor')}</h2>
        <p className="muted">{x('PDF, JPG, PNG or WebP, up to 8 MB. Your doctor will review it; uploading does not mean it has been reviewed.')}</p>
        {data.reportRequests.length > 0 && <label>{x('Requested report (optional)')}
          <select value={careTaskId} onChange={(e) => setCareTaskId(e.target.value)}>
            <option value="">{x('Other report')}</option>
            {data.reportRequests.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select></label>}
        <input aria-label={x('Choose report')} type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button disabled={busy || !file} onClick={() => void act(async () => {
          if (!file) return;
          if (file.size > 8 * 1024 * 1024) throw new Error(x('Choose a file smaller than 8 MB.'));
          await api(`${root}/document`, { body: { token, filename: file.name, base64: await fileBase64(file), careTaskId: careTaskId || undefined } });
          setFile(null);
          setCareTaskId('');
        }, 'Report received by the clinic. The doctor has not reviewed it yet.')}>{x('Upload report')}</button>
      </section>
      {data.careSteps.length > 0 && <section className="card"><h2>{x('Follow-up from your doctor')}</h2>
        <p className="muted">{x('These are the doctor’s approved plans. Your reply goes to the doctor for review. Do not use this form for an emergency.')}</p>
        {data.careSteps.map((step) => <div key={step.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
          <h3>{step.title}</h3><p>{step.message}</p>
          <p className="muted">{x('Due')} {new Date(step.due_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          {step.status === 'needs_review' ? <p>{x('Your reply is with the doctor for review.')}</p> : <>
            <label>{x('Your reply')}<textarea maxLength={2000} value={replies[step.id] ?? ''}
              onChange={(e) => setReplies({ ...replies, [step.id]: e.target.value })} /></label>
            <button disabled={busy || !replies[step.id]?.trim()} onClick={() => void act(async () => {
              const result = await api<{ urgent: boolean }>(`${root}/follow-up-reply`, { body: { token, stepId: step.id, response: replies[step.id] } });
              if (result.urgent) setUrgentReply(true);
            }, 'Your reply was sent to the doctor for review.')}>{x('Send reply')}</button>
          </>}
        </div>)}
      </section>}
      <p className="muted">{x('This private link expires after seven days. If it was shared with someone else, ask the clinic for a new link.')}</p>
    </>}
  </main>;
}
