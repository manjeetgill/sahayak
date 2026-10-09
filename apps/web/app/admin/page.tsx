'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../lib/api';
import { useWorkspaceMode, workspaceModeChanged, type WorkspaceMode } from '../../lib/workspaceMode';
import { useStaffLang } from '../../lib/staffText';
const areas = [
  [
    'All features',
    'Open every built feature, review doctor and reception screens, and see all setup options.',
    '/admin/features',
  ],
  [
    'Payments & patient check-in',
    'Set consultation fees, enable online payments, review payment activity, and print the reception QR.',
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
  const current = useSession('admin');
  const { x } = useStaffLang();
  const mode = useWorkspaceMode(current?.user.clinicId);
  const [setup, setSetup] = useState<any>(null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [people, setPeople] = useState<any[]>([]);
  useEffect(() => {
    staff('/staff/setup')
      .then(setSetup)
      .catch((e) => setError(e.message));
    staff('/staff/team')
      .then((r) => setPeople(r.staff))
      .catch((e) => setError(e.message));
  }, []);
  const chooseMode = async (next: WorkspaceMode) => {
    setSaving(true);
    setError('');
    try {
      await staff('/staff/settings', { workspaceMode: next }, 'PUT');
      if (next === 'solo' && !people.some((p) => p.solo_owner)) {
        const doctors = people.filter((p) => p.role === 'doctor');
        if (doctors.length === 1) {
          await staff('/staff/team/solo-owner', { userId: doctors[0].id }, 'PUT');
          setPeople((current) => current.map((p) => ({ ...p, solo_owner: p.id === doctors[0].id })));
        }
      }
      workspaceModeChanged(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="wrap">
      <p className="eyebrow">{x('ADMIN')}</p>
      <h1>{x(mode === 'solo' ? 'Run your clinic' : 'Set up your clinic')}</h1>
      <p>
        {mode === 'solo'
          ? x('One doctor can work from Today, with assistants helping with messages and follow-ups.')
          : x('Keep the clinic ready so doctors and receptionists can focus on patients.')}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="card clinic-mode-choice" aria-label={x('Clinic view')}>
        <div>
          <h2>{x('Choose the clinic view')}</h2>
          <p className="muted">{x('You can change this whenever your clinic grows.')}</p>
        </div>
        <div className="clinic-mode-options">
          <button
            type="button"
            className={mode === 'solo' ? '' : 'ghost'}
            disabled={saving}
            aria-pressed={mode === 'solo'}
            onClick={() => void chooseMode('solo')}
          >
            {x('Single doctor')}
            <small>{x('One daily workspace; receptionist optional')}</small>
          </button>
          <button
            type="button"
            className={mode === 'full' ? '' : 'ghost'}
            disabled={saving}
            aria-pressed={mode === 'full'}
            onClick={() => void chooseMode('full')}
          >
            {x('Clinic or small hospital')}
            <small>{x('Separate doctor, reception and Admin areas')}</small>
          </button>
        </div>
      </section>
      {mode === 'solo' && (
        <section className="card">
          <h2>{x('Doctor who runs the clinic')}</h2>
          <p>
            {x('This doctor uses one login for patient care, clinic setup, assistants, payments and connections. Choose the account that belongs to the clinic owner.')}
          </p>
          <label htmlFor="solo-clinic-owner">{x('Doctor account')}</label>
          <select
            id="solo-clinic-owner"
            value={people.find((p) => p.solo_owner)?.id ?? ''}
            disabled={saving || !people.some((p) => p.role === 'doctor')}
            onChange={async (e) => {
              const userId = e.target.value;
              if (!userId) return;
              setSaving(true);
              setError('');
              try {
                await staff('/staff/team/solo-owner', { userId }, 'PUT');
                setPeople((current) => current.map((p) => ({ ...p, solo_owner: p.id === userId })));
              } catch (error: any) {
                setError(error.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <option value="">{x('Choose doctor')}</option>
            {people.filter((p) => p.role === 'doctor').map((p) => (
              <option value={p.id} key={p.id}>{p.name} · {p.email}</option>
            ))}
          </select>
          {!people.some((p) => p.role === 'doctor') && <a href="/admin/team">{x('Create a doctor login →')}</a>}
        </section>
      )}
      <section className="card">
        <h2>{setup?.clinicName || x('Clinic setup')}</h2>
        <p>
          {setup
            ? setup.completed
              ? x('Setup is complete. You can update your clinic whenever needed.')
              : `${setup.items.filter((i: any) => i.ok).length} ${x('of')} ${setup.items.length} ${x('setup checks complete.')}`
            : x('Loading setup…')}
        </p>
        <a href="/admin/setup">{x('Open setup checklist →')}</a>
      </section>
      <div className="admin-cards">
        {(mode === 'solo'
          ? [
              ['Doctor’s day', 'Queue, patient record, messages, follow-up work and assistants.', '/doctor'],
              ['Payments & patient check-in', 'Consultation fee, online payment, QR and payment activity.', '/admin/qr-checkin'],
              ['My assistants', 'Choose routine tasks and review WhatsApp or phone readiness.', '/admin/agents'],
              ['Clinic details', 'Hours, contact details, patient questions and privacy settings.', '/admin/settings'],
              ['All features', 'See every screen and setup option in Sahayak.', '/admin/features'],
            ]
          : areas).map(([title, description, href]) => (
          <a key={href} className="card admin-card" href={href}>
            <h2>{x(title)}</h2>
            <p>{x(description)}</p>
            <span>{x('Open →')}</span>
          </a>
        ))}
      </div>
      <p className="muted">
        {mode === 'solo'
          ? x('The doctor can check in walk-ins and verify QR payments. Clinical notes and signatures use the doctor’s login. Add a receptionist account only if you need one.')
          : x('Each person signs in with their own account. Doctors see patient care; receptionists see the front desk.')}
      </p>
    </div>
  );
}
