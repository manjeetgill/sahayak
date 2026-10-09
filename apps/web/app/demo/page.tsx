'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './showcase.module.css';

const clinics = {
  solo: {
    name: 'Single doctor clinic',
    slug: 'showcase-solo',
    people: [
      ['Doctor and clinic owner', 'doctor@solo.demo.test'],
      ['Optional receptionist', 'desk@solo.demo.test'],
    ],
  },
  hospital: {
    name: 'Clinic or small hospital',
    slug: 'showcase-hospital',
    people: [
      ['Admin', 'admin@hospital.demo.test'],
      ['Doctor', 'kavita@hospital.demo.test'],
      ['Second doctor', 'farah@hospital.demo.test'],
      ['Receptionist', 'desk@hospital.demo.test'],
    ],
  },
} as const;

export default function Demo() {
  const [kind, setKind] = useState<'solo' | 'hospital'>('solo');
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => {
    const host = window.location.hostname;
    setLocal(
      host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '[::1]' ||
        /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host),
    );
  }, []);
  if (local === null) return <main className="wrap">Loading demo…</main>;
  if (!local)
    return (
      <main className="wrap">
        <h1>Local demo only</h1>
        <p>This walkthrough uses fictional clinics in the local database.</p>
      </main>
    );
  const clinic = clinics[kind];
  const c = `/c/${clinic.slug}`;
  return (
    <main className={`wrap ${styles.page}`}>
      <Link href="/">← Sahayak home</Link>
      <div className={styles.hero}>
        <p className={styles.eyebrow}>INTERACTIVE PRODUCT WALKTHROUGH</p>
        <h1>See a clinic day move from arrival to follow-up</h1>
        <Link className="button-link primary" href="/demo/journey">
          Follow one patient from booking to feedback →
        </Link>
        <p>
          Use these fictional patients to demonstrate the assistant, patient arrivals, doctor work,
          and feedback. Each action below creates a visible change in another screen.
        </p>
      </div>
      <div className={styles.switcher} role="group" aria-label="Choose demo clinic">
        {(['solo', 'hospital'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={kind === option ? styles.selected : styles.unselected}
            onClick={() => setKind(option)}
          >
            {clinics[option].name}
          </button>
        ))}
      </div>
      <section className={styles.notice}>
        <strong>{clinic.name} · fictional demo</strong>
        <span>
          Practice chat is simulated. Live WhatsApp, telephone calls, and online payments are not
          connected. Never enter a real patient’s details.
        </span>
      </section>
      <section className={styles.logins}>
        <div>
          <h2>Start with the agent in action</h2>
          <p>
            Watch a fictional WhatsApp booking create an appointment, then check a booked patient
            into the queue. Try clinic answers, human handoff, and urgent safety handling.
          </p>
        </div>
        <Link className={styles.primaryLink} href={`/demo/agents?clinic=${kind}`}>
          Open agent showcase →
        </Link>
      </section>
      <section className={styles.notice}>
        <strong>Real WhatsApp test</strong>
        <span>
          Sign in to the separate clinic that owns your WhatsApp number. The Assistants screen now
          shows a live journey checklist and connection evidence. The fictional clinics above use
          practice chat only.
        </span>
        <Link href="/admin/agents#whatsapp">Open live test checklist →</Link>
      </section>
      <section className={styles.logins}>
        <div>
          <h2>Choose who is using Sahayak</h2>
          <p>
            Sign out before switching roles. Every demo account uses password <code>demo1234</code>.
          </p>
        </div>
        <Link className={styles.primaryLink} href="/login">
          Open sign-in →
        </Link>
        <div className={styles.roleGrid}>
          {clinic.people.map(([role, email]) => (
            <div className={styles.role} key={email}>
              <b>{role}</b>
              <code>{email}</code>
            </div>
          ))}
        </div>
      </section>
      <h2 className={styles.sectionTitle}>Run the interactive walkthrough</h2>
      <ol className={styles.steps}>
        <li>
          <div className={styles.stepHead}>
            <span>1</span>
            <h3>Ask the assistant a clinic question</h3>
          </div>
          <p>
            Open the practice chat. Send “What are your hours?” from the suggested made-up number.
            The assistant answers and saves the conversation. Then send “Let me speak to the
            receptionist” to create a handoff. The typed phone practice shows what a caller would
            hear.
          </p>
          <Link href={`${c}/sim`}>Practice WhatsApp →</Link>{' '}
          <Link href={`${c}/call`}>Practice phone →</Link>{' '}
          <Link href="/doctor/inbox">See the work list →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>2</span>
            <h3>Show an arrival and the queue</h3>
          </div>
          <p>
            Open the QR arrival page with a new made-up patient number. The receptionist confirms
            payment, then the patient gets a queue token and can send one question for the doctor
            while waiting. Asha Demo already has a waiting-room note; Ravi Demo has been called.
          </p>
          <Link href={`${c}/arrival`}>Patient arrival →</Link>{' '}
          <Link href="/console/arrivals">Reception arrivals →</Link>{' '}
          <Link href="/doctor">Doctor queue →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>3</span>
            <h3>Run a consultation</h3>
          </div>
          <p>
            Sign in as Dr. Kavita Rao. Open Ravi Demo from Today’s clinic. Review the pre-visit
            information and his unsigned draft note. The doctor must check and sign clinical content
            personally. Review the completion checklist, then finish the visit.
          </p>
          <Link href="/doctor">Today’s clinic →</Link> <Link href="/doctor/care">Care work →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>4</span>
            <h3>Watch feedback get scheduled</h3>
          </div>
          <p>
            Refresh Patient feedback after Ravi’s visit finishes. His experience form appears
            automatically because the doctor enabled it. Submit fictional answers about how he
            feels, how the visit went, and what to improve. Meena Demo has a practice evening reply
            on the same screen. You can enable up to three evenings for future opted-in visits under
            the doctor’s saved setting. This demo sends no WhatsApp message.
          </p>
          <Link href="/doctor/checkins">Patient feedback →</Link>{' '}
          <Link href="/doctor/checkins#settings">Doctor’s saved setting →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>5</span>
            <h3>Respond and improve the clinic</h3>
          </div>
          <p>
            Return to Patient feedback and refresh. Record who will follow up and what the clinic
            did. Meena Demo already has an open waiting-time concern; Kabir Demo has a completed
            example. The work list also shows a human callback and an urgent safety example.
          </p>
          <Link href="/doctor/checkins">Feedback cases →</Link>{' '}
          <Link href="/doctor/checkins#improve">Clinic improvements →</Link>{' '}
          <Link href="/doctor/inbox">Needs attention →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>6</span>
            <h3>Show the rest of the care loop</h3>
          </div>
          <p>
            Review Meena’s uploaded sample report and pending care task, the waiting-list offer for
            Kabir, and the doctor’s visit closeout. These are linked fictional records, ready for
            staff to work through.
          </p>
          <Link href="/doctor/care">Care work →</Link>{' '}
          <Link href="/doctor/waitlist">Waiting list →</Link>{' '}
          <Link href="/doctor/closeout">Visit closeout →</Link>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span>7</span>
            <h3>Explain what the admin controls</h3>
          </div>
          <p>
            {kind === 'solo'
              ? 'The single doctor is also the clinic owner and can open setup.'
              : 'Switch to the hospital admin account to show clinic setup and team access.'}{' '}
            Admin approves separate WhatsApp templates for visit feedback and evening messages.
            Channel connection and background jobs must be ready before live scheduled sending
            starts.
          </p>
          <Link href="/admin/agents">Assistant tasks →</Link>{' '}
          <Link href="/admin/messages">Message delivery →</Link>{' '}
          <Link href="/admin/qr-checkin">QR and payments →</Link>
        </li>
      </ol>
      <p className={styles.footer}>
        Before another demonstration, run <code>pnpm demo:reset</code> locally. It replaces only the
        two exact DEMO clinics and clears their practice changes.
      </p>
    </main>
  );
}
