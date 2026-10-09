'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import type { User } from '../../lib/api';

type NavLink = { label: string; href: string };
type NavSection = { label: string; links: NavLink[]; direct?: boolean };
const link = (label: string, href: string): NavLink => ({ label, href });

export function soloSections(user: User): NavSection[] {
  if (user.role === 'receptionist') return [
    { label: 'Today', links: [link('Patient queue', '/console'), link('Arrivals & payments', '/console/arrivals')] },
    { label: 'Messages', direct: true, links: [link('Messages', '/console#conversations')] },
    { label: 'Patients & care', links: [link('Patient check-ins', '/console/checkins'), link('Waiting list', '/doctor/waitlist'), link('Import patients', '/console/import')] },
    { label: 'Clinic', links: [link('Share your clinic', '/console/share'), link('Doctor away', '/console/away'), link('Privacy requests', '/console/privacy'), link('Safety & privacy', '/safety'), link('More tools', '/console/tools')] },
  ];
  if (user.role === 'admin') return [
    { label: 'Overview', links: [link('Clinic overview', '/admin'), link('Doctor workspace', '/doctor'), link('Reception workspace', '/console')] },
    { label: 'Patients & care', links: [link('Arrivals & payments', '/console/arrivals'), link('Patient messages', '/doctor/inbox'), link('Follow-up work', '/doctor/care'), link('Patient feedback', '/doctor/checkins'), link('Waiting list', '/doctor/waitlist')] },
    { label: 'Assistants', direct: true, links: [link('Assistants', '/admin/agents')] },
    { label: 'Clinic setup', links: [link('Clinic details', '/admin/settings'), link('Doctors & team', '/admin/team'), link('Payments & QR', '/admin/qr-checkin'), link('Patient check-in messages', '/admin/messages'), link('Connections', '/admin/integrations'), link('Public pages', '/admin/features#patient-pages'), link('Setup checklist', '/admin/setup'), link('All features', '/admin/features'), link('Safety & privacy', '/safety')] },
  ];
  return [
    { label: 'Today', links: [link('Today’s patients', '/doctor'), ...(user.clinicAdmin ? [link('Arrivals & payments', '/console/arrivals'), link('Close day', '/doctor/closeout')] : [])] },
    { label: 'Patients & care', links: [link('Find a patient', '/doctor#patient-search'), link('Follow-up work', '/doctor/care'), link('Patient feedback', '/doctor/checkins'), link('Waiting list', '/doctor/waitlist'), link('Care plans', '/doctor/templates')] },
    { label: 'Needs me', direct: true, links: [link('Needs me', '/doctor/inbox')] },
    { label: 'My assistants', direct: true, links: [link('My assistants', '/doctor/agents')] },
    { label: 'Clinic', links: [link('Clinic activity', '/doctor/practice'), link('My profile', '/doctor/settings'), ...(user.clinicAdmin ? [link('Clinic setup', '/admin'), link('Clinic details', '/admin/settings'), link('Payments & QR', '/admin/qr-checkin'), link('Assistant setup', '/admin/agents'), link('Connections', '/admin/integrations'), link('All features', '/admin/features')] : []), link('More tools', '/doctor/tools'), link('Safety & privacy', '/safety')] },
  ];
}

function activeHref(sections: NavSection[], pathname: string, hash: string) {
  const links = sections.flatMap((section) => section.links);
  const fullPath = pathname + (hash ? `#${hash}` : '');
  const exact = links.find((item) => item.href === fullPath);
  if (exact) return exact.href;
  if (pathname.startsWith('/doctor/patients/')) return '/doctor#patient-search';
  const page = links.find((item) => item.href === pathname);
  if (page) return page.href;
  return links.filter((item) => !item.href.includes('#') && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function SoloNavigation({ user, pathname, hash, x, onNavigate }: {
  user: User; pathname: string; hash: string; x: (label: string) => string; onNavigate?: () => void;
}) {
  const sections = soloSections(user);
  const selected = activeHref(sections, pathname, hash);
  const activeSection = sections.find((section) => section.links.some((item) => item.href === selected))?.label;
  const [expanded, setExpanded] = useState(activeSection);
  const id = useId();
  useEffect(() => setExpanded(activeSection), [activeSection]);
  return <nav className="clinic-nav solo-nav" aria-label={x('Clinic menu')}>
    {sections.map((section, index) => section.direct ? <Link key={section.label}
      href={section.links[0].href} onClick={onNavigate}
      className={selected === section.links[0].href ? 'active' : ''}
      aria-current={selected === section.links[0].href ? 'page' : undefined}>{x(section.label)}</Link> :
      <div className="solo-nav-section" key={section.label}>
        <button type="button" className={`solo-nav-toggle${activeSection === section.label ? ' active' : ''}`}
          aria-expanded={expanded === section.label} aria-controls={`${id}-${index}`}
          onClick={() => setExpanded(expanded === section.label ? undefined : section.label)}>
          <span>{x(section.label)}</span><span className="solo-nav-chevron" aria-hidden="true">›</span>
        </button>
        <div id={`${id}-${index}`} className="solo-nav-children" hidden={expanded !== section.label}>
          {section.links.map((item) => <Link key={item.href} href={item.href} onClick={onNavigate}
            className={selected === item.href ? 'active' : ''}
            aria-current={selected === item.href ? 'page' : undefined}>{x(item.label)}</Link>)}
        </div>
      </div>)}
  </nav>;
}
