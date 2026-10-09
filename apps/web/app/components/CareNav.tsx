'use client';

import { usePathname } from 'next/navigation';
import { useStaffLang } from '../../lib/staffText';

const links = [
  ['/doctor/care', 'Open work'],
  ['/doctor/checkins', 'Patient check-ins'],
  ['/doctor/waitlist', 'Waiting list'],
  ['/doctor/templates', 'Reusable plans'],
] as const;

export function CareNav() {
  const pathname = usePathname();
  const { x } = useStaffLang();
  return (
    <nav className="section-tabs" aria-label={x('Follow-through care sections')}>
      {links.map(([href, label]) => (
        <a key={href} href={href} className={pathname === href ? 'active' : ''}>
          {x(label)}
        </a>
      ))}
    </nav>
  );
}
