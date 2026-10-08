'use client';
import { ClinicShell } from '../components/ClinicShell';
import { useSession } from '../../lib/api';

type Task = { q: string; a: string; href?: string; go?: string };
const DOCTOR: Task[] = [
  {
    q: 'See the next patient',
    a: 'Press "Next patient" on Today. The patient\'s card appears at the top.',
    href: '/doctor',
    go: 'Open Today',
  },
  {
    q: 'Write a visit note',
    a: 'Open the patient, choose the Visit tab, then speak or type. The assistant arranges your words under headings; you review and sign.',
    href: '/doctor#patient-search',
    go: 'Find a patient',
  },
  {
    q: 'Write a prescription or certificate',
    a: 'On the Visit tab, below the note. You review it and sign with your password before anything reaches the patient.',
  },
  {
    q: "I'm running late",
    a: 'On Today, type how late you are under "Running late?". You see who is affected and nothing is sent until you confirm.',
    href: '/doctor',
    go: 'Open Today',
  },
  {
    q: 'Ask about the clinic',
    a: 'Ask in plain words, for example "who did not show up yesterday?".',
    href: '/doctor#ask-clinic',
    go: 'Ask your clinic',
  },
  {
    q: 'Something needs my attention',
    a: 'The inbox lists urgent alerts, reports and unsigned drafts, most urgent first.',
    href: '/doctor/inbox',
    go: 'Open the inbox',
  },
];
const RECEPTION: Task[] = [
  {
    q: 'Check in a patient',
    a: 'Press "Check in patient" on Today and enter their mobile number.',
    href: '/console',
    go: 'Open Today',
  },
  {
    q: 'A patient scanned the QR code',
    a: 'QR arrivals shows who has arrived and what is still to do.',
    href: '/console/arrivals',
    go: 'Open QR arrivals',
  },
  {
    q: 'A patient asks for a person',
    a: 'Open Conversations, take over the chat and reply. The assistant stays quiet until you hand it back.',
    href: '/console#conversations',
    go: 'Open Conversations',
  },
  {
    q: 'Someone cancelled',
    a: 'The waiting list offers the free slot to the next patient automatically.',
    href: '/doctor/waitlist',
    go: 'Open the waiting list',
  },
  {
    q: 'A patient wants their data deleted',
    a: 'Use Privacy requests to find the patient and export or erase their data.',
    href: '/console/privacy',
    go: 'Open Privacy requests',
  },
];
const ADMIN: Task[] = [
  {
    q: 'Finish setting up the clinic',
    a: 'The setup checklist shows what is still needed before patients use it.',
    href: '/admin/setup',
    go: 'Open the checklist',
  },
  {
    q: 'Add a doctor or receptionist',
    a: 'Doctors & team lets you add people and set their access.',
    href: '/admin/team',
    go: 'Open Doctors & team',
  },
  {
    q: 'Connect WhatsApp, calls or Google',
    a: 'Connections guides you step by step and shows whether each service is working.',
    href: '/admin/integrations',
    go: 'Open Connections',
  },
];

/** Plain answers to "how do I...?", with a link straight to the right place. */
export default function Help() {
  const s = useSession();
  if (!s) return null;
  const tasks =
    s.user.role === 'admin' ? ADMIN : s.user.role === 'receptionist' ? RECEPTION : DOCTOR;
  return (
    <ClinicShell>
      <div className="help-page">
        <header className="doctor-page-heading">
          <div>
            <span className="page-eyebrow">Help</span>
            <h1>How do I…?</h1>
            <p className="muted">Short answers for the things you do every day.</p>
          </div>
        </header>
        <div className="list" data-testid="help-list">
          {tasks.map((t) => (
            <section key={t.q} className="card" style={{ marginBottom: '.8rem' }}>
              <h2>{t.q}</h2>
              <p>{t.a}</p>
              {t.href && (
                <a className="button-link" href={t.href}>
                  {t.go} →
                </a>
              )}
            </section>
          ))}
        </div>
        <section className="card">
          <h2>Something looks wrong?</h2>
          <p>
            Tell your clinic admin what you were doing and what you saw. The safety report shows
            what the assistants have done and whether anything needs attention.
          </p>
          {s.user.role !== 'admin' && (
            <a className="button-link" href="/safety">
              Open the safety report →
            </a>
          )}
        </section>
      </div>
    </ClinicShell>
  );
}
