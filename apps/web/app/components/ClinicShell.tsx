'use client';

import { useSection } from './useSection';
import { usePathname } from 'next/navigation';
import { session, useSession, roleHome } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

const doctorNav = [
  { label: 'My assistants', href: '/doctor/agents', group: 'assistants' },
  { label: 'Today', href: '/doctor', group: 'today' },
  { label: 'Patients', href: '/doctor#patient-search', group: 'patients' },
  { label: 'Care', href: '/doctor/care', group: 'care' },
  { label: 'Clinic', href: '/doctor/practice', group: 'clinic' },
];

const adminNav = [
  { label: 'Overview', href: '/admin', group: 'overview' },
  { label: 'Clinic details', href: '/admin/settings', group: 'settings' },
  { label: 'Doctors & team', href: '/admin/team', group: 'team' },
  { label: 'Assistants', href: '/admin/agents', group: 'agents' },
  { label: 'Connections', href: '/admin/integrations', group: 'integrations' },
];
const receptionNav = [
  { label: 'Today', href: '/console', group: 'today' },
  { label: 'QR arrivals', href: '/console/arrivals', group: 'arrivals' },
  { label: 'Conversations', href: '/console#conversations', group: 'conversations' },
  { label: 'Waiting list', href: '/doctor/waitlist', group: 'waitlist' },
  { label: 'Patient check-ins', href: '/console/checkins', group: 'checkins' },
  { label: 'Privacy requests', href: '/console/privacy', group: 'privacy' },
];

const currentHash = (hash: string) => hash;

function activeGroup(pathname: string, role: string, hash: string) {
  if (role === 'admin') return pathname.split('/')[2] || 'overview';
  if (role === 'receptionist') {
    if (pathname === '/console' && hash === 'conversations') return 'conversations';
    if (pathname.includes('/arrivals')) return 'arrivals';
    if (pathname.includes('/checkins')) return 'checkins';
    if (pathname.includes('/privacy')) return 'privacy';
    if (pathname.includes('/waitlist')) return 'waitlist';
    return 'today';
  }
  if (pathname === '/doctor' && hash === 'patient-search') return 'patients';
  if (pathname.includes('/patients/')) return 'patients';
  if (
    ['/inbox', '/care', '/waitlist', '/templates', '/checkins', '/feedback'].some((part) =>
      pathname.includes(part),
    )
  )
    return 'care';
  if (pathname.includes('/agents')) return 'assistants';
  if (
    ['/practice', '/references', '/settings', '/integrations'].some((part) =>
      pathname.includes(part),
    ) ||
    pathname === '/safety'
  )
    return 'clinic';
  return 'today';
}

export function ClinicShell({ children }: { children: React.ReactNode }) {
  const current = useSession();
  const pathname = usePathname();
  const hash = useSection(currentHash, '');
  const { lang, setLang, x } = useStaffLang();
  if (!current) return <>{children}</>;
  const role = current.user.role;
  const nav = role === 'admin' ? adminNav : role === 'receptionist' ? receptionNav : doctorNav;
  const active = activeGroup(pathname, role, hash);
  const initials = current.user.name
    .split(/\s+/)
    .map((part: string) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="clinic-shell">
      <aside className="clinic-sidebar" aria-label="Main navigation">
        <a className="clinic-brand" href={roleHome(role)}>
          <span className="clinic-brand-mark" aria-hidden="true">
            ✚
          </span>
          <span>Sahayak</span>
        </a>
        <div className="clinic-identity">
          <b>{x('Clinic workspace')}</b>
          <span>
            {current.user.name} ·{' '}
            {x(role === 'admin' ? 'Admin' : role === 'receptionist' ? 'Receptionist' : 'Doctor')}
          </span>
        </div>
        <nav className="clinic-nav">
          {nav.map((item) => (
            <a
              key={item.group}
              href={item.href}
              className={active === item.group ? 'active' : ''}
              aria-current={active === item.group ? 'page' : undefined}
            >
              {x(item.label)}
            </a>
          ))}
        </nav>
        <nav className="clinic-secondary-nav" aria-label="Clinic administration">
          {role === 'doctor' && <a href="/doctor/settings">{x('My profile')}</a>}
          {role === 'admin' && <a href="/admin/setup">Setup checklist</a>}
          {role === 'receptionist' && <a href="/console/import">{x('Import patients')}</a>}
          {role === 'receptionist' && <a href="/console/share">{x('Share your clinic')}</a>}
          {role === 'receptionist' && <a href="/console/away">{x("Doctor away")}</a>}
          {role !== 'admin' && <a href="/safety">{x('Safety & privacy')}</a>}
          <button
            type="button"
            onClick={() => {
              session.clear();
              location.href = '/login';
            }}
          >
            {x('Sign out')}
          </button>
        </nav>
      </aside>
      <section className="clinic-workspace">
        <header className="clinic-global-bar">
          <a
            className="clinic-global-search"
            href={
              role === 'admin'
                ? '/admin/setup'
                : role === 'receptionist'
                  ? '/console'
                  : '/doctor#patient-search'
            }
          >
            <span aria-hidden="true">⌕</span>
            {role === 'admin'
              ? 'Open clinic setup checklist'
              : x(
                  role === 'receptionist'
                    ? 'Open reception workspace'
                    : 'Find a patient by name or phone',
                )}
          </a>
          <button
            type="button"
            className="clinic-lang ghost small"
            onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
            aria-label={lang === 'hi' ? 'Switch to English' : 'हिन्दी में बदलें'}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </button>
          <a className="clinic-help" href={role === 'admin' ? '/admin/setup' : '/help'}>
            {x('Help')}
          </a>
          <span className="clinic-avatar" aria-label={current.user.name}>
            {initials}
          </span>
        </header>
        <div className="app-shell-content">{children}</div>
        <nav
          className="clinic-mobile-nav"
          aria-label="Mobile navigation"
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map((item) => (
            <a
              key={item.group}
              href={item.href}
              className={active === item.group ? 'active' : ''}
              aria-current={active === item.group ? 'page' : undefined}
            >
              {x(item.label)}
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}
