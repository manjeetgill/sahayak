'use client';
import { useStaffLang } from '../../../lib/staffText';
const tools = [
  ['Arrivals & payments', 'Check QR arrivals and confirm payments you have verified.', '/console/arrivals'],
  ['Patient messages', 'Reply to conversations that need a person.', '/console#conversations'],
  ['Patient check-ins', 'Review responses and assigned follow-up work.', '/console/checkins'],
  ['Waiting list', 'Help fill a cancelled appointment.', '/doctor/waitlist'],
  ['Privacy requests', 'Help patients with their privacy requests.', '/console/privacy'],
  ['Import patients', 'Bring consented patient details into the clinic.', '/console/import'],
  ['Share your clinic', 'Open the public clinic page and sharing tools.', '/console/share'],
  ['Doctor away', 'Record a doctor’s absence and review affected appointments.', '/console/away'],
];

export default function ReceptionTools() {
  const { x } = useStaffLang();
  return (
    <main className="wrap">
      <p className="eyebrow">{x('RECEPTION')}</p>
      <h1>{x('More front desk tools')}</h1>
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
