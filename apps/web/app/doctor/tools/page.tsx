'use client';
import { useStaffLang } from '../../../lib/staffText';
const tools = [
  ['My assistants', 'Choose help with patient messages, phone calls and reminders.', '/doctor/agents'],
  ['Patient feedback', 'See how patients felt after their visit and follow up on concerns.', '/doctor/checkins'],
  ['Follow-up work', 'Track reports, referrals and care tasks.', '/doctor/care'],
  ['Waiting list', 'Offer cancelled slots to patients who opted in.', '/doctor/waitlist'],
  ['Clinic activity', 'Review visits, collections and overdue work.', '/doctor/practice'],
  ['Care plans', 'Use saved plans and instructions.', '/doctor/templates'],
  ['Medical references', 'Open the clinic’s saved source library.', '/doctor/references'],
  ['My details', 'Update professional details and visit shortcuts.', '/doctor/settings'],
  ['Safety & privacy', 'Review safety alerts and privacy requests.', '/safety'],
];

export default function DoctorTools() {
  const { x } = useStaffLang();
  return (
    <main className="wrap">
      <p className="eyebrow">{x('DOCTOR')}</p>
      <h1>{x('More clinic tools')}</h1>
      <p>{x('Everything else you can use when needed. Your daily queue stays on Today.')}</p>
      <div className="admin-cards">
        {tools.map(([title, description, href]) => (
          <a className="card admin-card" href={href} key={href}>
            <h2>{x(title)}</h2>
            <p>{x(description)}</p>
            <span>{x('Open →')}</span>
          </a>
        ))}
      </div>
    </main>
  );
}
