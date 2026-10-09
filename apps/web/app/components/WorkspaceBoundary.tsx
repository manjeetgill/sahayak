'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { roleHome, useSession } from '../../lib/api';
export function WorkspaceBoundary({
  kind,
  children,
}: {
  kind: 'doctor' | 'receptionist';
  children: React.ReactNode;
}) {
  const s = useSession();
  const path = usePathname();
  const allowed =
    !!s &&
    (s.user.role === 'admin' ||
      (s.user.role === 'doctor' && s.user.clinicAdmin) ||
      s.user.role === kind ||
      (kind === 'doctor' && s.user.role === 'receptionist' && path === '/doctor/waitlist') ||
      (kind === 'receptionist' &&
        s.user.role === 'doctor' &&
        ['/console/privacy', '/console/arrivals'].includes(path)));
  useEffect(() => {
    if (s && !allowed) location.replace(roleHome(s.user.role));
  }, [s, allowed]);
  return allowed ? <>{children}</> : null;
}
