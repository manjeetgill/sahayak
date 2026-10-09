'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, session, staff } from '../../../lib/api';
import styles from '../showcase.module.css';

export default function DemoJourney() {
  const [kind, setKind] = useState<'solo' | 'hospital'>('solo');
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [chat, setChat] = useState<any[]>([]),
    [form, setForm] = useState('');
  const [note, setNote] = useState(
    'DEMO: Patient attended for a clinic workflow demonstration. No examination findings, diagnosis or medicines were recorded.',
  );
  const [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false);
  async function start() {
    setBusy('start');
    setError('');
    setForm('');
    setChat([]);
    setConsent(false);
    setReviewed(false);
    try {
      const auth = await api('/auth/login', {
        body: {
          email: kind === 'solo' ? 'doctor@solo.demo.test' : 'kavita@hospital.demo.test',
          password: 'demo1234',
        },
      });
      session.set(auth);
      setData(await staff('/staff/demo/journey', { confirmed: true }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  async function run(step: string) {
    setBusy(step);
    setError('');
    try {
      const accessToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      const result = await staff(`/staff/demo/journey/${data.patient.id}/${step}`, {
        confirmed: true,
        ...(step === 'arrive' ? { accessToken } : {}),
        ...(step === 'note' ? { note } : {}),
      });
      setData(result);
      if (result.transcript) setChat(result.transcript);
      if (result.arrivalPath) setForm(result.arrivalPath);
      if (result.path) setForm(result.path);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  async function refresh() {
    if (!data) return;
    try {
      setData(await staff(`/staff/demo/journey/${data.patient.id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  const button = (step: string, label: string, disabled = false) => (
    <button disabled={!data || !!busy || disabled} onClick={() => void run(step)}>
      {busy === step ? 'Working…' : label}
    </button>
  );
  return (
    <main className={`wrap ${styles.page}`}>
      <Link href="/demo">← Demo home</Link>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>ONE PATIENT · START TO FINISH</p>
        <h1>A visit that stays connected</h1>
        <p>
          Show the booking, arrival, doctor’s work and feedback using the same fictional patient.
          Every completed step is saved in Sahayak.
        </p>
      </header>
      <section className={styles.notice}>
        <strong>Practice clinic only</strong>
        <span>
          No real WhatsApp message, phone call or online payment is made here. Cash payment is a
          practice record. The connected WhatsApp clinic remains separate.
        </span>
        <span>
          Starting a rehearsal extends this fictional clinic’s opening hours for evening demos and
          enables the demo doctor’s next-day feedback preference. Calling this patient places other
          waiting/called practice patients on hold.
        </span>
      </section>
      <section className={styles.logins}>
        <label>
          Clinic view{' '}
          <select
            value={kind}
            disabled={!!busy}
            onChange={(e) => {
              setKind(e.target.value as any);
              setData(null);
              setForm('');
              setChat([]);
            }}
          >
            <option value="solo">Single doctor</option>
            <option value="hospital">Clinic or small hospital</option>
          </select>
        </label>
        <button disabled={!!busy} onClick={() => void start()}>
          {busy === 'start'
            ? 'Preparing…'
            : data
              ? 'Start another rehearsal'
              : 'Start a fresh rehearsal'}
        </button>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <section className={styles.notice}>
          <strong>
            {data.patient.name} · {data.patient.phone}
          </strong>
          <span>
            Appointment: {data.appointment?.status ?? 'not booked'} · Queue:{' '}
            {data.queue ? `${data.queue.token_number} — ${data.queue.status}` : 'not checked in'} ·
            Note: {data.note?.status ?? 'not drafted'} · Feedback:{' '}
            {data.feedback?.work_status ?? 'not scheduled'}
          </span>
          <div>
            <button className="ghost" onClick={() => void refresh()}>
              Refresh progress
            </button>{' '}
            <Link href={`/doctor/patients/${data.patient.id}`}>Open this patient’s record →</Link>
          </div>
        </section>
      )}
      <div className={styles.capabilities}>
        <section className={styles.capability}>
          <span className={styles.number}>01</span>
          <h2>Patient books through chat</h2>
          <p>The assistant offers actual free slots and asks for confirmation.</p>
          {button('book', 'Run booking conversation', !!data?.appointment)}
          {data?.appointment && (
            <p>Booked: {new Date(data.appointment.starts_at).toLocaleString('en-IN')}</p>
          )}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>02</span>
          <h2>Patient arrives using QR check-in</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            For this fictional patient, demonstrate agreement to visit data, WhatsApp and follow-up
            messages.
          </label>
          {button(
            'arrive',
            'Submit practice QR check-in',
            !data?.appointment || !!data?.arrival || !consent,
          )}
          <p>Arrival waits for staff payment confirmation. No queue token is issued yet.</p>
          {data && (
            <Link href={`/c/${data.slug}/arrival`} target="_blank">
              Open blank patient QR form →
            </Link>
          )}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>03</span>
          <h2>Confirm practice cash payment</h2>
          <p>
            This records fictional cash already received and adds this patient to the queue. In the
            hospital demo, this step uses the fictional receptionist account.
          </p>
          {button(
            'payment',
            'Record practice cash and issue token',
            data?.arrival?.status !== 'awaiting_payment',
          )}
          <p>
            {data?.queue
              ? `Queue token ${data.queue.token_number}`
              : 'Waiting for check-in and payment.'}
          </p>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>04</span>
          <h2>Call patient and open the brief</h2>
          <p>
            Other waiting/called demo patients go on hold for this rehearsal. The doctor starts this
            patient’s consultation.
          </p>
          {button('call', 'Call this patient and start visit', data?.queue?.status !== 'waiting')}
          {data && (
            <Link href={`/doctor/patients/${data.patient.id}`}>
              Review intake and previous records →
            </Link>
          )}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>05</span>
          <h2>Review and sign the doctor’s note</h2>
          <label>
            Practice note
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!!data?.note}
            />
          </label>
          {button(
            'note',
            'Save structured draft',
            data?.queue?.status !== 'in_consultation' || !!data?.note,
          )}
          {data?.note && (
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {Object.entries(data.note.note)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n\n')}
            </pre>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the displayed draft and instructions for this fictional visit.
          </label>
          {button('sign', 'Sign reviewed note', data?.note?.status !== 'draft' || !reviewed)}
          {button(
            'instructions',
            'Approve displayed instructions',
            data?.note?.status !== 'signed' ||
              !reviewed ||
              data?.instructions?.status === 'approved',
          )}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>06</span>
          <h2>Finish visit → feedback scheduled</h2>
          <p>The doctor’s saved preference schedules feedback for this same visit.</p>
          {button(
            'finish',
            'Finish reviewed visit',
            data?.queue?.status !== 'in_consultation' || data?.instructions?.status !== 'approved',
          )}
          <p>
            {data?.feedback
              ? `Feedback scheduled: ${new Date(data.feedback.scheduled_at).toLocaleString('en-IN')}`
              : 'Feedback will appear after the visit finishes.'}
          </p>
          {button(
            'feedback-link',
            'Open private patient feedback form',
            !data?.feedback || !!data?.response,
          )}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>07</span>
          <h2>Patient response → human follow-up</h2>
          <p>
            Submit the private form below, refresh progress, then assign the response to the doctor.
          </p>
          <button className="ghost" disabled={!data || !!busy} onClick={() => void refresh()}>
            Refresh patient response
          </button>
          {data?.response && (
            <p>
              Feeling: {data.response.recovery} · Experience: {data.response.experience} ·
              Suggestion: {data.response.suggestion}
            </p>
          )}
          {button('handoff', 'Assign feedback to the doctor', !data?.response)}
          <Link href="/doctor/checkins">Open patient feedback work list →</Link>
        </section>
      </div>
      {!!chat.length && (
        <section className={styles.transcript}>
          <h2>Booking conversation</h2>
          {chat.map((turn, i) => (
            <div className={styles.turn} key={i}>
              <p>
                <b>Patient:</b> {turn.sent}
              </p>
              <p>
                <b>Assistant:</b> {turn.reply}
              </p>
            </div>
          ))}
        </section>
      )}
      {form && (
        <section className="card">
          <h2>Patient’s view</h2>
          <a href={form} target="_blank" rel="noreferrer">
            Open this private form in a separate tab
          </a>
          <iframe
            title="Private patient form"
            src={form}
            style={{ width: '100%', height: 760, border: 0 }}
          />
        </section>
      )}
    </main>
  );
}
