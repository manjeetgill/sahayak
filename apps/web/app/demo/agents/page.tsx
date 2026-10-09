'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, session, staff } from '../../../lib/api';
import styles from '../showcase.module.css';

type ClinicKind = 'solo' | 'hospital';
type Reply = { replies: string[]; handledBy: 'agent' | 'human'; redFlag: boolean };
type Line = { sent: string; reply: string };
type Appointment = { starts_at: string; status: string };
type Snapshot = {
  doctorId: string;
  devId: string;
  booked: Appointment | null;
  arrivalName: 'Dev Demo' | 'Anaya Demo';
  arrivalAppointment: Appointment | null;
  arrivalQueue: { token_number: number; status: string } | null;
};

const clinics = {
  solo: { slug: 'showcase-solo', email: 'doctor@solo.demo.test', name: 'Single doctor clinic' },
  hospital: { slug: 'showcase-hospital', email: 'kavita@hospital.demo.test', name: 'Small hospital' },
} as const;
const phones = {
  booking: '+910000000009',
  arrival: '+910000000008',
  hours: '+910000000094',
  handoff: '+910000000093',
  safety: '+910000000092',
};
const clinicDate = (value: Date | string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(value));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function AgentShowcase() {
  const [kind, setKind] = useState<ClinicKind>('solo');
  const [local, setLocal] = useState<boolean | null>(null);
  const [account, setAccount] = useState('');
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const clinic = clinics[kind];

  useEffect(() => {
    const host = location.hostname;
    setLocal(host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
      /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host));
    if (new URLSearchParams(location.search).get('clinic') === 'hospital') setKind('hospital');
  }, []);

  const refresh = useCallback(async () => {
    const active = session.get();
    setAccount(active?.user.name ?? '');
    setSnapshot(null);
    if (!active) return null;
    const setup = await staff<{ slug: string }>('/staff/setup');
    if (setup.slug !== clinic.slug || active.user.role !== 'doctor') return null;
    const [publicInfo, dev, today, queue] = await Promise.all([
      api<{ doctors: { id: string; name: string }[] }>(`/public/${clinic.slug}`),
      staff<{ id: string }[]>(`/staff/patients?phone=${encodeURIComponent(phones.booking)}`),
      staff<{ patient: string; starts_at: string; status: string }[]>('/staff/today'),
      staff<{ patient_name: string; token_number: number; status: string }[]>('/staff/queue'),
    ]);
    const doctorId = publicInfo.doctors.find((d) => d.name === 'Dr. Kavita Rao')?.id;
    if (!doctorId || !dev[0]) throw new Error('The fictional clinic needs pnpm demo:reset.');
    const record = await staff<{ upcoming: Appointment[] }>(`/staff/patients/${dev[0].id}/record`);
    const booked = record.upcoming[0] ?? null;
    const devToday = !!booked && clinicDate(booked.starts_at) === clinicDate(new Date());
    const arrivalName = devToday ? 'Dev Demo' : 'Anaya Demo';
    const current: Snapshot = {
      doctorId,
      devId: dev[0].id,
      booked,
      arrivalName,
      arrivalAppointment: today.find((a) => a.patient === arrivalName) ?? null,
      arrivalQueue: queue.find((q) => q.patient_name === arrivalName &&
        ['waiting', 'called', 'in_consultation', 'on_hold'].includes(q.status)) ?? null,
    };
    setSnapshot(current);
    return current;
  }, [clinic.slug, version]);

  useEffect(() => {
    if (local) void refresh().catch((e) => setError(e.message));
  }, [local, refresh]);

  async function signIn() {
    setBusy('sign-in');
    setError('');
    try {
      const auth = await api<{ token: string; user: Parameters<typeof session.set>[0]['user'] }>(
        '/auth/login', { body: { email: clinic.email, password: 'demo1234' } },
      );
      session.set(auth);
      setVersion((n) => n + 1);
      setNotice(`Using ${clinic.name}'s fictional doctor account.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function send(from: string, text: string, doctorId: string) {
    const result = await api<Reply>(`/sim/${clinic.slug}/message`, {
      body: { from, text, doctorId },
    });
    setLines((previous) => [...previous, {
      sent: text,
      reply: result.replies.join(' ') || (result.handledBy === 'human' ? 'A person now owns this conversation.' : 'No reply.'),
    }]);
    return result;
  }

  async function run(which: 'booking' | 'hours' | 'handoff' | 'safety' | 'arrival' | 'queue') {
    if (!snapshot || busy) return;
    setBusy(which);
    setError('');
    setNotice('');
    setLines([]);
    try {
      if (which === 'booking') {
        if (snapshot.booked) throw new Error('Dev already has a booking. Run pnpm demo:reset to replay it.');
        for (const text of ['Hello', '1', '1', 'earliest', '1', 'yes', 'no']) {
          const result = await send(phones.booking, text, snapshot.doctorId);
          if (result.handledBy !== 'agent' || !result.replies.length)
            throw new Error('The booking assistant handed this conversation to the clinic. Review the transcript.');
          await wait(450);
        }
        if (!(await refresh())?.booked)
          throw new Error('The assistant did not save an appointment. Review the transcript.');
        setNotice('The assistant saved Dev Demo’s appointment. Dev declined optional reminders. The visit appears in the doctor’s patient record.');
      } else if (which === 'arrival') {
        if (snapshot.arrivalQueue) throw new Error('This patient already has a queue token.');
        const result = await api<{ token: number }>(`/public/${clinic.slug}/checkin`, {
          body: {
            phone: snapshot.arrivalName === 'Dev Demo' ? phones.booking : phones.arrival,
            doctorId: snapshot.doctorId,
            language: 'en',
            consent: { visit_data: true, whatsapp_messaging: false, reminders_followups: false },
          },
        });
        if (!(await refresh())?.arrivalQueue)
          throw new Error('Check-in returned, but the patient is not visible in the queue yet. Refresh the doctor screen.');
        setNotice(`${snapshot.arrivalName} checked in. Appointment linked; queue token ${result.token} issued automatically.`);
      } else if (which === 'queue') {
        if (!snapshot.arrivalQueue) throw new Error('Check in a booked patient first.');
        const from = snapshot.arrivalName === 'Dev Demo' ? phones.booking : phones.arrival;
        const result = await send(from, 'What is my token number?', snapshot.doctorId);
        setNotice(result.replies.length
          ? 'The assistant read this patient’s current queue position without changing the intake answers.'
          : 'A person now owns this conversation. Review the clinic work list.');
      } else {
        const examples = {
          hours: [phones.hours, 'What are your hours?'],
          handoff: [phones.handoff, 'Let me speak to the receptionist'],
          safety: [phones.safety, 'DEMO: I have chest pain now'],
        } as const;
        const [from, text] = examples[which];
        const result = await send(from, text, snapshot.doctorId);
        setNotice(which === 'hours'
          ? 'The assistant used the clinic’s saved answer.'
          : which === 'handoff'
            ? result.handledBy === 'human' ? 'A person now owns this conversation.' : 'Review the response and handoff setting.'
            : result.redFlag ? 'The safety check raised an urgent alert for human review.' : 'Review the safety response.');
      }
      if (!['booking', 'arrival'].includes(which)) await refresh();
    } catch (e: any) {
      setError(e.message);
      await refresh().catch(() => {});
    } finally {
      setBusy('');
    }
  }

  if (local === null) return <main className="wrap">Loading agent demo…</main>;
  if (!local) return <main className="wrap"><h1>Local demo only</h1></main>;
  const ready = !!snapshot;
  return (
    <main className={`wrap ${styles.page}`}>
      <Link href="/demo">← Full clinic walkthrough</Link>
      <div className={styles.hero}>
        <p className={styles.eyebrow}>AGENT CAPABILITIES · PRACTICE ONLY</p>
        <h1>Watch the assistant do the work</h1>
        <p>Run a fictional chat and see what changes in the clinic. These buttons use Sahayak’s actual assistant and patient workflows.</p>
      </div>
      <div className={styles.switcher} role="group" aria-label="Choose demo clinic">
        {(['solo', 'hospital'] as const).map((option) =>
          <button type="button" key={option} disabled={!!busy} className={kind === option ? styles.selected : styles.unselected}
            onClick={() => { setKind(option); setLines([]); setNotice(''); setError(''); }}>
            {clinics[option].name}
          </button>)}
      </div>
      <section className={styles.notice}>
        <strong>How the assistant makes a decision</strong>
        <span>It checks every message for urgent concerns, understands whether the patient wants clinic information, a booking, or a person, then reads the clinic’s saved hours, available slots, or queue. It asks for a clear yes before booking and hands uncertain or sensitive work to staff.</span>
        <span>After booking: patient arrival → check-in → queue token → doctor visit → feedback when enabled. Booking alone does not add anyone to today’s queue. Payment-required QR arrivals wait for verification.</span>
      </section>
      <section className={styles.logins}>
        <div><h2>Use a fictional doctor account</h2><p>{account ? `Signed in as ${account}.` : 'Start the practice in one click.'} This changes the current local Sahayak sign-in.</p></div>
        <button type="button" disabled={!!busy} onClick={() => void signIn()}>{account ? 'Switch to this demo doctor' : 'Start agent demo'}</button>
        <p className={styles.fullWidth}>The two demo clinics have no live WhatsApp number, calling line, or online payment connection. All contact numbers below are fictional.</p>
      </section>
      <section className={styles.notice}>
        <strong>Want to test from your own WhatsApp?</strong>
        <span>Use the separate connected clinic, not either fictional demo clinic. Sign in as its clinic owner and open Assistants → WhatsApp → Test a real patient journey. That page checks the connection, received messages, late-notice delivery, feedback setup, and the separate phone-call path.</span>
        <Link href="/admin/agents#whatsapp">Open live journey checklist →</Link>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      <h2 className={styles.sectionTitle}>Choose a capability</h2>
      <div className={styles.capabilities}>
        <section className={styles.capability}>
          <span className={styles.number}>01</span><h3>Book through chat</h3>
          <p>Dev Demo asks for a visit. The assistant offers available times, gets a yes, and creates the appointment.</p>
          <button disabled={!ready || !!busy || !!snapshot?.booked} onClick={() => void run('booking')}>{busy === 'booking' ? 'Booking…' : snapshot?.booked ? 'Appointment booked' : 'Run booking conversation'}</button>
          <p className={styles.state}>{snapshot?.booked ? `Saved appointment: ${new Date(snapshot.booked.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Waiting for the agent to book.'}</p>
          {snapshot?.booked && <Link href={`/doctor/patients/${snapshot.devId}`}>Open Dev’s patient record →</Link>}
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>02</span><h3>Add an arrival to the queue</h3>
          <p>{snapshot?.arrivalName ?? 'A booked patient'} arrives on the appointment day. Check-in links the booking and issues the next token. {snapshot?.booked && snapshot.arrivalName === 'Anaya Demo' ? 'Dev’s new appointment is on a later day, so Anaya shows today’s arrival.' : ''}</p>
          <button disabled={!ready || !!busy || !!snapshot?.arrivalQueue || snapshot?.arrivalAppointment?.status !== 'booked'} onClick={() => void run('arrival')}>{busy === 'arrival' ? 'Checking in…' : snapshot?.arrivalQueue ? 'Queue token issued' : 'Check in booked patient'}</button>
          <p className={styles.state}>{snapshot?.arrivalQueue ? `Token ${snapshot.arrivalQueue.token_number} · ${snapshot.arrivalQueue.status}` : snapshot?.arrivalAppointment ? `Appointment: ${snapshot.arrivalAppointment.status}` : 'No appointment found for today.'}</p>
          <Link href="/doctor">See doctor’s queue →</Link> <Link href={`/c/${clinic.slug}/arrival`}>See payment-required QR check-in →</Link>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>03</span><h3>Answer from clinic information</h3>
          <p>Ask about hours. The answer comes from this clinic’s saved information.</p>
          <button disabled={!ready || !!busy} onClick={() => void run('hours')}>Ask about hours</button>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>04</span><h3>Tell a patient their queue position</h3>
          <p>After check-in, the assistant can read the live token and wait. It can do this even while intake questions are in progress.</p>
          <button disabled={!ready || !!busy || !snapshot?.arrivalQueue} onClick={() => void run('queue')}>Ask “What is my token?”</button>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>05</span><h3>Pass to a person</h3>
          <p>A request for the receptionist moves the conversation to human ownership.</p>
          <button disabled={!ready || !!busy} onClick={() => void run('handoff')}>Ask for reception</button>
          <Link href="/doctor/inbox">See the work list →</Link>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>06</span><h3>Spot an urgent concern</h3>
          <p>A fictional urgent phrase gets an emergency response and a staff alert. The assistant gives no diagnosis.</p>
          <button disabled={!ready || !!busy} onClick={() => void run('safety')}>Run safety example</button>
          <Link href="/doctor/inbox">See the urgent alert →</Link>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>07</span><h3>Finish and follow up</h3>
          <p>The doctor reviews the visit. Finishing it schedules feedback; a private patient response appears in the clinic’s feedback list.</p>
          <Link href="/doctor">Finish Ravi’s visit →</Link> <Link href="/doctor/checkins">See feedback →</Link>
        </section>
        <section className={styles.capability}>
          <span className={styles.number}>08</span><h3>Approve an automatic summary</h3>
          <p>A sample daily clinic summary is saved as a draft. The doctor can preview and approve it. Sending the summary needs a staff contact and message connection.</p>
          <Link href="/doctor/agents">Open my assistants →</Link> <Link href={`/c/${clinic.slug}/call`}>Try a phone conversation →</Link>
        </section>
      </div>
      {lines.length > 0 && <section className={styles.transcript} aria-label="Practice conversation">
        <div className={styles.transcriptHead}><h2>What the agent said</h2><button className="ghost" onClick={() => setLines([])}>Clear view</button></div>
        {lines.map((line, index) => <div className={styles.turn} key={index}><p><b>Patient:</b> {line.sent}</p><p><b>Assistant:</b> {line.reply}</p></div>)}
      </section>}
      <p className={styles.footer}>Replay the full story with <code>set -a; . ./.env; set +a; pnpm demo:reset</code> in the repository. Only the two fictional DEMO clinics are reset.</p>
    </main>
  );
}
