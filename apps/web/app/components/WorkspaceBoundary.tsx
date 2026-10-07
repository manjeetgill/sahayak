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
    (s.user.role === kind ||
      (kind === 'doctor' && s.user.role === 'receptionist' && path === '/doctor/waitlist') ||
      (kind === 'receptionist' && s.user.role === 'doctor' && path === '/console/privacy'));
  useEffect(() => {
    if (s && !allowed) location.replace(roleHome(s.user.role));
  }, [s, allowed]);
  return allowed ? <>{children}</> : null;
}
