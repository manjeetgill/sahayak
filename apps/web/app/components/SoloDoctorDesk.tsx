'use client';

import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
import DoctorAssistantAccess from './DoctorAssistantAccess';

export function SoloDoctorDesk({ doctorId, onCheckin }: { doctorId: string; onCheckin: () => void }) {
  const { x } = useStaffLang();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<'available' | 'seeing_patients' | 'closed'>('seeing_patients');
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  useEffect(() => {
    void staff<{ availability: typeof availability }>('/staff/solo/availability')
      .then((result) => setAvailability(result.availability))
      .catch((e) => setError(e.message));
  }, []);

  async function changeAvailability(next: typeof availability) {
    setAvailabilityBusy(true);
    setError('');
    try {
      await staff('/staff/solo/availability', { availability: next }, 'PUT');
      setAvailability(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAvailabilityBusy(false);
    }
  }

  async function checkIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await staff<{ token: number }>('/staff/checkin', {
        name: name.trim() || undefined,
        phone: phone.trim(),
        doctorId,
        consent: { visit_data: consent, whatsapp_messaging: false, reminders_followups: false },
      });
      setMessage(`${x('Patient added to your queue')} · ${x('Token')} ${result.token}.`);
      setName('');
      setPhone('');
      setConsent(false);
      onCheckin();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="solo-doctor-desk" aria-label={x('Run your clinic')}>
      <div className="solo-desk-heading">
        <div>
          <span className="page-eyebrow">{x('YOUR DAILY WORKSPACE')}</span>
          <h2>{x('Run today from one place')}</h2>
          <p className="muted">{x('Check patients in, see who is waiting, and let your assistants handle routine contact.')}</p>
        </div>
        <nav className="solo-desk-links" aria-label={x('Daily actions')}>
          <a className="button-link primary" href="/console/arrivals">{x('Review QR arrivals & payments')}</a>
          <a className="button-link" href="/doctor/inbox">{x('Patient messages')}</a>
          <a className="button-link" href="/doctor/care">{x('Follow-up work')}</a>
          <a className="button-link" href="/doctor/closeout">{x('Close out the day')}</a>
        </nav>
      </div>
      <section className="card" aria-label={x('Patient contact coverage')}>
        <h3>{x('When can patients reach you?')}</h3>
        <p className="muted">{x('The assistant can answer routine clinic questions and take requests. Messages that need a person come to your work list. Urgent alerts stay visible in every mode.')}</p>
        <div className="row" role="group" aria-label={x('My availability')}>
          {([
            ['available', 'Available'],
            ['seeing_patients', 'Seeing patients'],
            ['closed', 'Closed for now'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={availability === value ? 'primary' : 'ghost'}
              aria-pressed={availability === value} disabled={availabilityBusy}
              onClick={() => void changeAvailability(value)}>{x(label)}</button>
          ))}
        </div>
        <p className="muted">{availability === 'available'
          ? x('You can review new requests as they arrive.')
          : availability === 'seeing_patients'
            ? x('Focus on consultations. Review routine requests between patients.')
            : x('The clinic is closed for now. New requests remain in your work list.')}</p>
      </section>
      <div className="solo-desk-grid">
        <section className="card">
          <h3>{x('Add a walk-in')}</h3>
          <p className="muted">{x('Use this when the patient arrives without a QR check-in. Record any fee separately.')}</p>
          {error && <p className="error" role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <form onSubmit={(event) => void checkIn(event)}>
            <label htmlFor="solo-patient-name">{x('Patient name')}</label>
            <input id="solo-patient-name" value={name} onChange={(e) => setName(e.target.value)} required />
            <label htmlFor="solo-patient-phone">{x('Phone number with country code')}</label>
            <input id="solo-patient-phone" type="tel" placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
              {x('The patient agreed to the clinic recording their visit details.')}
            </label>
            <button type="submit" disabled={busy || !consent}>{x('Add to my queue')}</button>
          </form>
        </section>
        <section className="card">
          <div className="row between">
            <h3>{x('My assistants')}</h3>
            <a href="/doctor/agents">{x('Open all assistants →')}</a>
          </div>
          <p className="muted">{x('Choose help with WhatsApp, calls, and reminders. A live connection is needed before patients can receive messages or calls.')}</p>
          <DoctorAssistantAccess personal />
        </section>
      </div>
    </section>
  );
}
