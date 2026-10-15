'use client';
import { useState } from 'react';
import { api, session } from '../../lib/api';
import styles from './showcase.module.css';

type Capability = {
  title: string;
  group: string;
  benefit: string;
  show: string;
  path: string;
  role: 'doctor' | 'admin' | 'reception' | 'patient';
  connection?: boolean;
};
const items: Capability[] = [
  {
    title: 'Book through a conversation',
    group: 'Before the visit',
    benefit: 'Patients can ask for a slot without calling reception.',
    show: 'Run the agent showcase. Confirm a booking, then open the saved appointment. Booking and arrival are separate steps.',
    path: '/demo/agents',
    role: 'doctor',
  },
  {
    title: 'Answer everyday clinic questions',
    group: 'Before the visit',
    benefit: 'Reduce repeated calls about hours, fees and directions.',
    show: 'Ask the practice chat about clinic hours, then review the saved conversation.',
    path: '/c/CLINIC/sim',
    role: 'patient',
  },
  {
    title: 'Patient arrival and payment review',
    group: 'Before the visit',
    benefit: 'Collect arrival details once and put the patient into the queue after staff review.',
    show: 'Use a fictional number on the arrival form. Review payment in Reception arrivals; confirming arrival creates the token.',
    path: '/c/CLINIC/arrival',
    role: 'patient',
  },
  {
    title: 'Reception arrivals',
    group: 'Before the visit',
    benefit: 'See who has arrived and which payments need checking.',
    show: 'Open an arrival, record the practice payment and confirm queue entry. A patient saying “paid” is not payment verification.',
    path: '/console/arrivals',
    role: 'reception',
  },
  {
    title: 'Queue and waiting-room display',
    group: 'Before the visit',
    benefit: 'Keep staff and patients informed when the doctor calls the next patient.',
    show: 'Open this display in a second window, then call a patient from Today’s clinic and watch the token change.',
    path: '/c/CLINIC/tv',
    role: 'patient',
  },
  {
    title: 'Doctor running late',
    group: 'Before the visit',
    benefit: 'Adjust affected appointments and keep patients informed.',
    show: 'Enter “running 15 minutes late”, preview the impact and confirm. Practice notices appear in patient chat; replies update the summary.',
    path: '/doctor',
    role: 'doctor',
  },
  {
    title: 'Fill a cancelled appointment',
    group: 'Before the visit',
    benefit: 'Offer an opening to patients who opted into the waiting list.',
    show: 'Review waiting patients and offers. Accept an unexpired offer in practice chat with ACCEPT and its code; check the new appointment.',
    path: '/doctor/waitlist',
    role: 'doctor',
  },
  {
    title: 'Planned leave',
    group: 'Before the visit',
    benefit: 'Make the doctor’s planned absence visible to the clinic.',
    show: 'Add a future absence and review it before removing the practice entry.',
    path: '/doctor/away',
    role: 'doctor',
  },
  {
    title: 'Pre-visit patient brief',
    group: 'During consultation',
    benefit: 'See the patient’s concern, intake answers, earlier visits and reports together.',
    show: 'Open Ravi Demo from the queue or search Meena Demo. Review source records before starting the consultation.',
    path: '/doctor',
    role: 'doctor',
  },
  {
    title: 'Dictation and consultation notes',
    group: 'During consultation',
    benefit: 'Reduce typing while keeping the doctor responsible for the clinical record.',
    show: 'Open a patient’s Visit tab. Dictate or type, arrange a draft, correct it and sign. Conversation capture requires patient consent and browser microphone permission.',
    path: '/doctor#patient-search',
    role: 'doctor',
  },
  {
    title: 'Symptoms and prescriptions',
    group: 'During consultation',
    benefit:
      'Record reported symptoms and prepare a prescription from medicines the doctor chooses.',
    show: 'Open the patient’s Visit tab, select symptoms, then create a prescription. Enter medicine instructions and review before signing; symptoms do not choose treatment.',
    path: '/doctor#patient-search',
    role: 'doctor',
  },
  {
    title: 'Saved note and medicine shortcuts',
    group: 'During consultation',
    benefit: 'Reuse the doctor’s wording and frequently entered medicine lines.',
    show: 'Review starter note templates and medicine favourites, then use them in a patient’s editable draft.',
    path: '/doctor/shortcuts',
    role: 'doctor',
  },
  {
    title: 'Instructions and follow-up plans',
    group: 'During consultation',
    benefit: 'Keep the next steps clear and linked to the visit.',
    show: 'Open a patient record, review instructions and the follow-up date, then approve the plan. Reusable care plans are available here.',
    path: '/doctor/templates',
    role: 'doctor',
  },
  {
    title: 'Certificates and patient documents',
    group: 'During consultation',
    benefit: 'Keep signed documents with the patient’s record.',
    show: 'Open a patient’s Visit tab, create a certificate, review its details and sign with the doctor’s password. Patient delivery is a separate step.',
    path: '/doctor#patient-search',
    role: 'doctor',
  },
  {
    title: 'Clinic reference library',
    group: 'During consultation',
    benefit: 'Keep useful sources easy to find during a consultation.',
    show: 'Review the saved reference material and its source links. This is a reference library, not automatic treatment advice.',
    path: '/doctor/references',
    role: 'doctor',
  },
  {
    title: 'Visit completion checklist',
    group: 'During consultation',
    benefit: 'Catch unfinished documentation before closing a visit.',
    show: 'Review unsigned notes, missing items, instructions and follow-up work before finishing the patient’s visit.',
    path: '/doctor/closeout',
    role: 'doctor',
  },
  {
    title: 'Reports and referrals tracker',
    group: 'After the visit',
    benefit: 'Keep requested tests and referrals from being forgotten.',
    show: 'Open Meena Demo’s task. Move it through report received, doctor reviewed and patient informed; assign responsibility.',
    path: '/doctor/care',
    role: 'doctor',
  },
  {
    title: 'Feedback after consultation',
    group: 'After the visit',
    benefit: 'Find out what patients experienced and what the clinic can improve.',
    show: 'Finish a visit with feedback enabled, open its private practice form, submit a fictional response and assign the follow-up.',
    path: '/doctor/checkins',
    role: 'doctor',
  },
  {
    title: 'Waiting-room and evening check-ins',
    group: 'After the visit',
    benefit: 'Give patients a way to share concerns before and after their consultation.',
    show: 'Review the waiting-room question and Meena’s evening response. Configure the doctor’s preference; live invitations need approved templates and delivery setup.',
    path: '/doctor/checkins#settings',
    role: 'doctor',
  },
  {
    title: 'Patient concerns and human handoff',
    group: 'After the visit',
    benefit: 'Bring unresolved questions and urgent flags to a person’s attention.',
    show: 'Open the inbox, read the original conversation and review the assigned work. Practice chat can request a receptionist handoff.',
    path: '/doctor/inbox',
    role: 'doctor',
  },
  {
    title: 'Clinic improvements from feedback',
    group: 'After the visit',
    benefit: 'Turn feedback into assigned work and record what changed.',
    show: 'Review Meena’s waiting-time concern and Kabir’s closed example. Record ownership and the clinic’s response.',
    path: '/doctor/checkins#improve',
    role: 'doctor',
  },
  {
    title: 'Reminders and daily summaries',
    group: 'Clinic management',
    benefit: 'Prepare supported routine tasks with a clear audience and schedule.',
    show: 'Open Reminders & updates, prepare a daily-summary or reminder draft and check what it will do. Review before approval; live sending needs a connection.',
    path: '/doctor/agents',
    role: 'doctor',
  },
  {
    title: 'Doctor access to assistants',
    group: 'Clinic management',
    benefit: 'Let each authorised doctor choose their own assistant preferences.',
    show: 'Review doctor access in Admin, then use the Doctor role to enable or pause personal help.',
    path: '/admin/agents',
    role: 'admin',
  },
  {
    title: 'Team roles and clinic settings',
    group: 'Clinic management',
    benefit: 'Separate clinical decisions, front-desk work and clinic setup.',
    show: 'Review doctor and receptionist logins. Use Clinic details for hours, fees, intake questions and saved answers.',
    path: '/admin/team',
    role: 'admin',
  },
  {
    title: 'Activity and collections',
    group: 'Clinic management',
    benefit: 'Review recorded visits, collections and outstanding work.',
    show: 'Inspect practice activity and recorded payment totals. These figures reflect entered records, not verified bank settlements.',
    path: '/doctor/practice',
    role: 'doctor',
  },
  {
    title: 'Import an existing patient list',
    group: 'Clinic management',
    benefit: 'Reduce retyping when starting with a clinic.',
    show: 'Upload a fictional CSV, preview valid and invalid rows, then import. Importing does not send messages or grant messaging consent.',
    path: '/console/import',
    role: 'reception',
  },
  {
    title: 'Public clinic page and sharing',
    group: 'Clinic management',
    benefit: 'Give patients one place to find clinic information and entry points.',
    show: 'Open the fictional clinic page. Localhost works on this computer; patients using phones need a reachable address.',
    path: '/c/CLINIC',
    role: 'patient',
  },
  {
    title: 'Share links and patient sources',
    group: 'Clinic management',
    benefit: 'Share the clinic’s entry links and review where patients came from.',
    show: 'Review the share kit and source-labelled links before copying a clinic link.',
    path: '/doctor/share',
    role: 'doctor',
  },
  {
    title: 'Safety, consent and privacy',
    group: 'Clinic management',
    benefit: 'Keep human review and patient permissions visible.',
    show: 'Inspect safety protections and recorded actions. Admin or reception can review privacy requests separately.',
    path: '/safety',
    role: 'admin',
  },
  {
    title: 'Privacy requests',
    group: 'Clinic management',
    benefit: 'Give staff a defined way to handle requests about patient records.',
    show: 'Find a fictional patient and review the request process. Use only demo records when demonstrating changes.',
    path: '/console/privacy',
    role: 'reception',
  },
  {
    title: 'Live WhatsApp and phone service',
    group: 'Connections',
    benefit: 'Connect patient conversations to the clinic’s working services.',
    show: 'Review readiness and the live test checklist. Fictional clinics have no live number; practice phone chat never dials a phone.',
    path: '/admin/agents',
    role: 'admin',
    connection: true,
  },
  {
    title: 'Online payments and clinic QR',
    group: 'Connections',
    benefit: 'Collect payments through the configured payment provider and verify their status.',
    show: 'Review Razorpay and QR settings. Actual checkout needs provider keys and webhook verification. Practice cash records are available without them.',
    path: '/admin/qr-checkin',
    role: 'admin',
    connection: true,
  },
  {
    title: 'Automatic message delivery',
    group: 'Connections',
    benefit: 'Send approved feedback and evening invitations when delivery requirements are met.',
    show: 'Review consent, template approval, public form address, background jobs and delivery evidence. An approved schedule alone does not prove delivery.',
    path: '/admin/messages',
    role: 'admin',
    connection: true,
  },
  {
    title: 'Calendar, sheets and other software',
    group: 'Connections',
    benefit: 'Connect supported clinic data with external tools.',
    show: 'Review Google Calendar, Google Sheets and connection options. Each external service needs its own authorisation and live verification.',
    path: '/admin/integrations',
    role: 'admin',
    connection: true,
  },
];

export default function CapabilityExplorer({ kind }: { kind: 'solo' | 'hospital' }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const slug = `showcase-${kind}`;
  const visible = items.filter(
    (item) =>
      (group === 'All' || item.group === group) &&
      `${item.title} ${item.benefit} ${item.show}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function open(item: Capability) {
    if (busy) return;
    setBusy(item.title);
    setError('');
    try {
      if (item.role !== 'patient') {
        const email =
          kind === 'solo'
            ? item.role === 'reception'
              ? 'desk@solo.demo.test'
              : 'doctor@solo.demo.test'
            : { doctor: 'kavita', admin: 'admin', reception: 'desk' }[item.role] +
              '@hospital.demo.test';
        session.set(await api('/auth/login', { body: { email, password: 'demo1234' } }));
      }
      window.location.href =
        item.path.replace('CLINIC', slug) + (item.path === '/demo/agents' ? `?clinic=${kind}` : '');
    } catch {
      setError('Could not open the demo account. Run pnpm demo:ready and try again.');
      setBusy('');
    }
  }
  return (
    <section aria-labelledby="capability-heading" id="capabilities">
      <h2 id="capability-heading" className={styles.sectionTitle}>
        What can Sahayak help with?
      </h2>
      <p>
        Explore {items.length} capabilities already in the app. Each button opens the selected
        fictional clinic with the appropriate role. Switching roles also changes the account used by
        other tabs in this browser.
      </p>
      <div className={styles.switcher}>
        <label>
          Find a capability
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Try feedback, medicines or payments"
          />
        </label>
        <label>
          Part of the clinic day
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {['All', ...new Set(items.map((item) => item.group))].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status">{visible.length} capabilities shown</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.capabilities}>
        {visible.map((item) => (
          <article key={item.title} className={styles.capability}>
            <span className={styles.number}>{item.group}</span>
            <h3>{item.title}</h3>
            <p>{item.benefit}</p>
            <span className={styles.state}>
              {item.connection ? 'External connection required' : 'Explore with saved demo data'} ·{' '}
              {item.role === 'patient'
                ? 'Patient view'
                : kind === 'solo' && item.role === 'admin'
                  ? 'Doctor and owner'
                  : item.role}
            </span>
            <details>
              <summary>What to demonstrate</summary>
              <p>{item.show}</p>
            </details>
            <button disabled={!!busy} onClick={() => open(item)}>
              {busy === item.title ? 'Opening…' : `Open ${item.title}`}
            </button>
          </article>
        ))}
      </div>
      {!visible.length && <p>No matches. Try another word or choose All.</p>}
      <p>
        <a href="/demo">Return to the demo start page</a> to choose another capability or role.
      </p>
    </section>
  );
}
