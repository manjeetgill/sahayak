'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';

type Feature = [string, string, string];
const groups: { id: string; title: string; items: Feature[] }[] = [
  {
    id: 'setup',
    title: 'Clinic setup & payments',
    items: [
      [
        'Clinic settings',
        'Hours, fees, contact details, intake questions, saved answers, follow-up rules and safety controls.',
        '/admin/settings#all',
      ],
      [
        'Doctors & team',
        'Create staff logins, assign roles and manage doctor details.',
        '/admin/team',
      ],
      [
        'Payments & patient check-in',
        'Consultation fee, online payment setup, payment activity, clinic QR and printable poster.',
        '/admin/qr-checkin',
      ],
      [
        'Setup checklist',
        'Walk through clinic registration, team setup and readiness checks.',
        '/admin/setup',
      ],
      [
        'Public clinic settings',
        'Clinic introduction, feedback settings and public rating controls.',
        '/admin/settings#public-page',
      ],
    ],
  },
  {
    id: 'assistants',
    title: 'AI assistants & connected services',
    items: [
      [
        'All clinic assistants',
        'Everyday tasks, doctor access, WhatsApp, phone calls, reminders and custom tasks in one view.',
        '/admin/agents',
      ],
      [
        'WhatsApp assistant',
        'Connection setup, practice conversations and live-service checks.',
        '/admin/agents#whatsapp',
      ],
      [
        'Phone assistant',
        'Connection readiness, phone setup and test conversations. A working telephone service is required for real calls.',
        '/admin/agents#phone',
      ],
      [
        'Reminders & custom tasks',
        'Build supported tasks, review their audience and actions, then activate or pause them.',
        '/admin/agents#automations',
      ],
      [
        'Patient check-in messages',
        'Feedback invitations, approved templates, public form address and delivery evidence.',
        '/admin/messages',
      ],
      [
        'Connected software',
        'Google Calendar, Google Sheets, access keys, update connections and technical reference.',
        '/admin/integrations',
      ],
      [
        'Daily staff summary',
        'Configure the daily update for the clinic team.',
        '/admin/settings#messaging',
      ],
    ],
  },
  {
    id: 'care',
    title: 'Doctor workspace — Admin can review',
    items: [
      [
        'Today’s clinic',
        'Queue, appointments, urgent alerts, delayed appointments and visit completion checks.',
        '/doctor',
      ],
      [
        'Patients & clinical records',
        'Search a patient to see the pre-visit brief, previous visits, dictation and notes, reports, clinical entries, instructions, follow-up plans, prescriptions, certificates, billing and insurance work.',
        '/doctor#patient-search',
      ],
      [
        'Doctor inbox & human handoff',
        'Patient messages, urgent concerns, reports, unsigned documents and work needing follow-through.',
        '/doctor/inbox',
      ],
      [
        'Reports, referrals & follow-up tasks',
        'Track requests, received documents, doctor review and patient updates.',
        '/doctor/care',
      ],
      [
        'Patient feedback & check-ins',
        'Read responses, review unresolved concerns and clinic improvements, and inspect each doctor’s automatic feedback settings.',
        '/doctor/checkins',
      ],
      [
        'Waiting list & cancelled slots',
        'Opted-in waiting patients, slot offers, expiry and booking status.',
        '/doctor/waitlist',
      ],
      [
        'Reusable care plans',
        'Review saved task wording and follow-up schedules.',
        '/doctor/templates',
      ],
      ['Medical references', 'Review the clinic’s saved source library.', '/doctor/references'],
      [
        'Clinic activity & collections',
        'Recorded visits, payment totals, overdue work and follow-through measures.',
        '/doctor/practice',
      ],
    ],
  },
  {
    id: 'reception',
    title: 'Reception, safety & audit — Admin can review',
    items: [
      [
        'Reception workspace',
        'Arrivals, queue, staff alerts and patient conversations.',
        '/console',
      ],
      [
        'Arrivals & payments',
        'QR arrivals, payment status and queue entry confirmation.',
        '/console/arrivals',
      ],
      [
        'Patient conversations',
        'View messages and conversations handed to a human.',
        '/console#conversations',
      ],
      [
        'Reception check-ins',
        'View patient responses and follow-up work assigned to the clinic team.',
        '/console/checkins',
      ],
      [
        'Privacy requests',
        'Find patient records and inspect the privacy request workflow.',
        '/console/privacy',
      ],
      [
        'Safety report & audit',
        'Safety checks, emergency flags, recorded actions and audit history.',
        '/safety',
      ],
    ],
  },
];
export default function AllFeatures() {
  const { x } = useStaffLang();
  const [slug, setSlug] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    staff('/staff/setup')
      .then((d) => setSlug(d.slug))
      .catch((e) => setError(e.message));
  }, []);
  const patientPages: Feature[] = slug
    ? [
        ['Public clinic page', 'Clinic information and patient entry points.', `/c/${slug}`],
        ['Patient check-in form', 'The patient’s standard check-in form.', `/c/${slug}/checkin`],
        [
          'Scan, pay & join the queue',
          'QR arrival form and online payment option when enabled.',
          `/c/${slug}/arrival`,
        ],
        [
          'Reception QR poster',
          'Printable poster for patients arriving at the clinic.',
          `/c/${slug}/poster`,
        ],
        [
          'Waiting-room TV',
          'Public token display and estimated waiting information.',
          `/c/${slug}/tv`,
        ],
        [
          'WhatsApp practice conversation',
          'Test the supported conversation flow. Practice records are saved in the clinic.',
          `/c/${slug}/sim`,
        ],
        [
          'Browser voice conversation',
          'Test voice in the browser; this does not dial a phone number.',
          `/c/${slug}/call`,
        ],
      ]
    : [];
  return (
    <div className="wrap feature-directory">
      <p className="eyebrow">{x('ADMIN · COMPLETE PRODUCT VIEW')}</p>
      <h1>{x('All features')}</h1>
      <p>
        {x('Everything currently built in Sahayak, grouped by where it is used. Setup and connection details are shown by default.')}
      </p>
      <p className="muted">
        {x('Care screens open in Admin review mode with your clinic’s recorded data. Clinical changes and signatures require the responsible staff login. An available screen does not mean its external service is connected; check the status inside.')}
      </p>
      <nav className="row feature-directory-links" aria-label={x('Feature groups')}>
        {groups.map((g) => (
          <a key={g.id} href={'#' + g.id}>
            {x(g.title.split(' — ')[0])}
          </a>
        ))}
        <a href="#patient-pages">{x('Public patient pages')}</a>
      </nav>
      {[...groups, { id: 'patient-pages', title: 'Public patient pages', items: patientPages }].map(
        (g) => (
          <section key={g.id} id={g.id} className="feature-directory-section">
            <h2>{x(g.title)}</h2>
            <div className="admin-cards">
              {g.items.map(([title, description, href]) => (
                <a key={href} className="card admin-card" href={href}>
                  <h3>{x(title)}</h3>
                  <p>{x(description)}</p>
                  <span>{x('Open →')}</span>
                </a>
              ))}
            </div>
            {g.id === 'patient-pages' && (
              <>
                <p>
                  {x('Patient feedback forms and signed-document verification use an individual invitation or document link. Open the relevant feedback case or issued document to review those flows.')}
                </p>
                {!slug && (
                  <p role={error ? 'alert' : 'status'}>
                    {error || x('Loading your clinic’s public links…')}
                  </p>
                )}
              </>
            )}
          </section>
        ),
      )}
    </div>
  );
}
