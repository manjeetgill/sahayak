'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
const areas = [
  [
    'Patient check-in QR',
    'Set the consultation fee and print the QR for reception.',
    '/admin/qr-checkin',
  ],
  [
    'Clinic details',
    'Opening hours, contact details, patient questions, and privacy settings.',
    '/admin/settings',
  ],
  [
    'Doctors & team',
    'Add doctors and create a separate login for each team member.',
    '/admin/team',
  ],
  ['Assistants', 'Set up WhatsApp, phone, and routine clinic tasks.', '/admin/agents'],
  ['Connections', 'Connect other software used by your clinic.', '/admin/integrations'],
  [
    'Patient check-in messages',
    'Choose an approved message and connect delivery.',
    '/admin/messages',
  ],
];
export default function AdminHome() {
  const [setup, setSetup] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    staff('/staff/setup')
      .then(setSetup)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="wrap">
      <p className="eyebrow">ADMIN</p>
      <h1>Set up your clinic</h1>
      <p>Keep the clinic ready so doctors and receptionists can focus on patients.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="card">
        <h2>{setup?.clinicName || 'Clinic setup'}</h2>
        <p>
          {setup
            ? setup.completed
              ? 'Setup is complete. You can update your clinic whenever needed.'
              : `${setup.items.filter((i: any) => i.ok).length} of ${setup.items.length} setup checks complete.`
            : 'Loading setup…'}
        </p>
        <a href="/admin/setup">Open setup checklist →</a>
      </section>
      <div className="admin-cards">
        {areas.map(([title, description, href]) => (
          <a key={href} className="card admin-card" href={href}>
            <h2>{title}</h2>
            <p>{description}</p>
            <span>Open →</span>
          </a>
        ))}
      </div>
      <p className="muted">
        Each person signs in with their own account. Doctors see patient care; receptionists see the
        front desk.
      </p>
    </div>
  );
}
