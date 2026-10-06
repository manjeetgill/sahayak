'use client';

import { useSection } from './useSection';
import { usePathname } from 'next/navigation';
import { session, useSession } from '../../lib/api';

const doctorNav = [
  { label: 'Today', href: '/doctor', group: 'today' },
  { label: 'Patients', href: '/doctor#patient-search', group: 'patients' },
  { label: 'Care', href: '/doctor/care', group: 'care' },
  { label: 'Assistants', href: '/doctor/agents', group: 'assistants' },
  { label: 'Clinic', href: '/doctor/practice', group: 'clinic' },
];

const receptionNav = [
  { label: 'Today', href: '/console', group: 'today' },
  { label: 'Conversations', href: '/console#conversations', group: 'conversations' },
  { label: 'Waiting list', href: '/doctor/waitlist', group: 'waitlist' },
  { label: 'Privacy requests', href: '/console/privacy', group: 'privacy' },
];

const currentHash = (hash: string) => hash;

function activeGroup(pathname: string, role: string, hash: string) {
  if (role === 'receptionist') {
    if (pathname === '/console' && hash === 'conversations') return 'conversations';
    if (pathname.includes('/privacy')) return 'privacy';
    if (pathname.includes('/waitlist')) return 'waitlist';
    return 'today';
  }
  if (pathname === '/doctor' && hash === 'patient-search') return 'patients';
  if (pathname.includes('/patients/')) return 'patients';
  if (['/inbox', '/care', '/waitlist', '/templates'].some((part) => pathname.includes(part)))
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
  if (!current) return <>{children}</>;
  const role = current.user.role;
  const nav = role === 'receptionist' ? receptionNav : doctorNav;
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
        <a className="clinic-brand" href={role === 'receptionist' ? '/console' : '/doctor'}>
          <span className="clinic-brand-mark" aria-hidden="true">
            ✚
          </span>
          <span>Sahayak</span>
        </a>
        <div className="clinic-identity">
          <b>Clinic workspace</b>
          <span>
            {current.user.name} · {role === 'receptionist' ? 'Reception' : 'Doctor'}
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
              {item.label}
            </a>
          ))}
        </nav>
        <nav className="clinic-secondary-nav" aria-label="Clinic administration">
          {role !== 'receptionist' && <a href="/doctor/settings">Settings</a>}
          <a href="/safety">Safety &amp; privacy</a>
          <button
            type="button"
            onClick={() => {
              session.clear();
              location.href = '/login';
            }}
          >
            Sign out
          </button>
        </nav>
      </aside>
      <section className="clinic-workspace">
        <header className="clinic-global-bar">
          <a
            className="clinic-global-search"
            href={role === 'receptionist' ? '/console' : '/doctor#patient-search'}
          >
            <span aria-hidden="true">⌕</span>
            {role === 'receptionist'
              ? 'Open reception workspace'
              : 'Find a patient by name or phone'}
          </a>
          <a className="clinic-help" href="/safety">
            Help
          </a>
          <span className="clinic-avatar" aria-label={current.user.name}>
            {initials}
          </span>
        </header>
        <div className="app-shell-content">{children}</div>
        <nav className="clinic-mobile-nav" aria-label="Mobile navigation">
          {nav.map((item) => (
            <a
              key={item.group}
              href={item.href}
              className={active === item.group ? 'active' : ''}
              aria-current={active === item.group ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}
