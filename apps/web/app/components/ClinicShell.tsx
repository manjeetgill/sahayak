'use client';

import { useEffect, useRef } from 'react';
import { useSection } from './useSection';
import { SoloNavigation } from './SoloNavigation';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { session, useSession, roleHome } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
import { useWorkspaceMode } from '../../lib/workspaceMode';

const doctorNav = [
  { label: 'My assistants', href: '/doctor/agents', group: 'assistants' },
  { label: 'Today', href: '/doctor', group: 'today' },
  { label: 'Patients', href: '/doctor#patient-search', group: 'patients' },
  { label: 'Care', href: '/doctor/care', group: 'care' },
  { label: 'Clinic', href: '/doctor/practice', group: 'clinic' },
];

const adminNav = [
  { label: 'Overview', href: '/admin', group: 'overview' },
  { label: 'All features', href: '/admin/features', group: 'features' },
  { label: 'Clinic details', href: '/admin/settings', group: 'settings' },
  { label: 'Doctors & team', href: '/admin/team', group: 'team' },
  { label: 'Payments & QR', href: '/admin/qr-checkin', group: 'qr-checkin' },
  { label: 'Assistants', href: '/admin/agents', group: 'agents' },
  { label: 'Patient check-in messages', href: '/admin/messages', group: 'messages' },
  { label: 'Public pages', href: '/admin/features#patient-pages', group: 'public-pages' },
  { label: 'Connections', href: '/admin/integrations', group: 'integrations' },
  { label: 'Doctor workspace', href: '/doctor', group: 'doctor-view' },
  { label: 'Reception workspace', href: '/console', group: 'reception-view' },
  { label: 'Safety & audit', href: '/safety', group: 'safety' },
];
const fullOwnerNav = [
  ...doctorNav,
  { label: 'Clinic setup', href: '/admin', group: 'setup' },
  { label: 'All features', href: '/admin/features', group: 'features' },
];
const receptionNav = [
  { label: 'Today', href: '/console', group: 'today' },
  { label: 'Arrivals & payments', href: '/console/arrivals', group: 'arrivals' },
  { label: 'Conversations', href: '/console#conversations', group: 'conversations' },
  { label: 'Waiting list', href: '/doctor/waitlist', group: 'waitlist' },
  { label: 'Patient check-ins', href: '/console/checkins', group: 'checkins' },
  { label: 'Privacy requests', href: '/console/privacy', group: 'privacy' },
];

const currentHash = (hash: string) => hash;

function activeGroup(pathname: string, role: string, hash: string, mode: string) {
  if (role === 'admin' && pathname.startsWith('/doctor')) return 'doctor-view';
  if (role === 'admin' && pathname.startsWith('/console')) return 'reception-view';
  if (role === 'admin' && pathname === '/safety') return 'safety';
  if (role === 'admin')
    return pathname === '/admin/features' && hash === 'patient-pages'
      ? 'public-pages'
      : pathname.split('/')[2] || 'overview';
  if (role === 'receptionist') {
    if (pathname === '/console/tools') return 'tools';
    if (pathname === '/console' && hash === 'conversations') return 'conversations';
    if (pathname.includes('/arrivals')) return 'arrivals';
    if (pathname.includes('/checkins')) return 'checkins';
    if (pathname.includes('/privacy')) return 'privacy';
    if (pathname.includes('/waitlist')) return 'waitlist';
    return 'today';
  }
  if (role === 'doctor' && pathname === '/admin/features') return 'features';
  if (role === 'doctor' && pathname.startsWith('/admin')) return 'setup';
  if (role === 'doctor' && pathname === '/console/arrivals') return 'arrivals';
  if (role === 'doctor' && pathname === '/doctor/closeout') return 'closeout';
  if (pathname === '/doctor' && hash === 'patient-search') return 'patients';
  if (mode === 'solo' && pathname === '/doctor/inbox') return 'messages';
  if (mode === 'solo' && pathname === '/doctor/care') return 'followups';
  if (pathname === '/doctor/tools') return 'tools';
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
  const mode = useWorkspaceMode(current?.user.clinicId);
  const menuRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { menuRef.current?.close(); }, [pathname, hash, mode]);
  if (!current) return <>{children}</>;
  const role = current.user.role;
  const soloOwner = role === 'doctor' && mode === 'solo' && current.user.clinicAdmin;
  const nav = role === 'admin' ? adminNav : role === 'receptionist' ? receptionNav
    : current.user.clinicAdmin ? fullOwnerNav : doctorNav;
  const active = activeGroup(pathname, role, hash, mode);
  const mobileNav = mode === 'solo'
    ? role === 'doctor'
      ? [
          { label: 'Today', href: '/doctor', group: 'today' },
          { label: 'Patients', href: '/doctor#patient-search', group: 'patients' },
          { label: 'Needs me', href: '/doctor/inbox', group: 'messages' },
          { label: 'My assistants', href: '/doctor/agents', group: 'assistants' },
        ]
      : role === 'admin'
        ? adminNav.filter((item) => ['overview', 'qr-checkin', 'agents'].includes(item.group))
        : receptionNav.filter((item) => ['today', 'arrivals', 'conversations'].includes(item.group))
    : role === 'admin'
      ? nav.filter((item) => ['overview', 'features', 'qr-checkin', 'agents', 'integrations'].includes(item.group))
      : current.user.clinicAdmin && role === 'doctor'
        ? nav.filter((item) => ['today', 'patients', 'assistants', 'setup'].includes(item.group))
        : nav;
  const signOut = () => { session.clear(); location.href = '/login'; };
  const initials = current.user.name
    .split(/\s+/)
    .map((part: string) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="clinic-shell" lang={lang === 'hi' ? 'hi' : 'en'}>
      <aside className="clinic-sidebar" aria-label={x("Main navigation")}>
        <Link className="clinic-brand" href={roleHome(role)}>
          <span className="clinic-brand-mark" aria-hidden="true">
            ✚
          </span>
          <span>{x("Sahayak")}</span>
        </Link>
        <div className="clinic-identity">
          <b>{x('Clinic workspace')}</b>
          <span>
            {current.user.name} ·{' '}
            {x(role === 'admin' ? 'Admin' : role === 'receptionist' ? 'Receptionist' : soloOwner ? 'Doctor & Admin' : 'Doctor')}
          </span>
          <span>{x(mode === 'solo' ? 'Solo clinic view' : 'Full clinic view')}</span>
        </div>
        {mode === 'solo' ? <SoloNavigation user={current.user} pathname={pathname} hash={hash} x={x} /> : <nav className="clinic-nav">
          {nav.map((item) => (
            <Link
              key={item.group}
              href={item.href}
              className={active === item.group ? 'active' : ''}
              aria-current={active === item.group ? 'page' : undefined}
            >
              {x(item.label)}
            </Link>
          ))}
        </nav>}
        <nav className="clinic-secondary-nav" aria-label={x('Clinic administration')}>
          {mode !== 'solo' && <>
          {role === 'doctor' && <a href="/doctor/settings">{x('My profile')}</a>}
          {role === 'admin' && <a href="/admin/setup">{x('Setup checklist')}</a>}
          {role === 'receptionist' && <a href="/console/import">{x('Import patients')}</a>}
          {role === 'receptionist' && <a href="/console/share">{x('Share your clinic')}</a>}
          {role === 'receptionist' && <a href="/console/away">{x("Doctor away")}</a>}
          {role !== 'admin' && <a href="/safety">{x('Safety & privacy')}</a>}
          </>}
          <button
            type="button"
            onClick={signOut}
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
              ? x('Open clinic setup checklist')
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
            aria-label={lang === 'hi' ? x('Switch to English') : 'हिन्दी में बदलें'}
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
        <div className="app-shell-content">
          {role === 'admin' &&
            (pathname.startsWith('/doctor') || pathname.startsWith('/console')) && (
              <section className="card admin-review-notice" role="note">
                <b>{x("Admin view · your clinic")}</b>
                <p>
                  {x("Review the real screens and recorded clinic activity. Patient care changes, payment confirmation, and clinical signatures require the responsible staff member’s login.")}
                </p>
                <a href="/admin/features">{x("All features")}</a> · <a href="/admin">{x("Admin setup")}</a>
              </section>
            )}
          {children}
        </div>
        <nav
          className="clinic-mobile-nav"
          aria-label={x("Mobile navigation")}
          style={{ gridTemplateColumns: `repeat(${mobileNav.length + (mode === 'solo' ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {mobileNav.map((item) => (
            <Link
              key={item.group}
              href={item.href}
              className={active === item.group ? 'active' : ''}
              aria-current={active === item.group ? 'page' : undefined}
            >
              {x(item.label)}
            </Link>
          ))}
          {mode === 'solo' && <button type="button" aria-haspopup="dialog"
            aria-label={x('Open full clinic menu')}
            className={mobileNav.some((item) => item.group === active) ? '' : 'active'}
            onClick={() => menuRef.current?.showModal()}>{x('Menu')}</button>}
        </nav>
        {mode === 'solo' && <dialog ref={menuRef} className="solo-menu-dialog" aria-label={x('Clinic menu')}
          onClick={(event) => { if (event.target === event.currentTarget) menuRef.current?.close(); }}>
          <div className="solo-menu-heading"><h2>{x('Clinic menu')}</h2>
            <button type="button" className="ghost small" autoFocus onClick={() => menuRef.current?.close()}>{x('Close')}</button>
          </div>
          <SoloNavigation user={current.user} pathname={pathname} hash={hash} x={x}
            onNavigate={() => menuRef.current?.close()} />
          <button type="button" className="ghost solo-menu-signout" onClick={signOut}>{x('Sign out')}</button>
        </dialog>}
      </section>
    </div>
  );
}
