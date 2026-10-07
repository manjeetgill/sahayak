'use client';
import { ClinicShell } from '../components/ClinicShell';
import { useSession } from '../../lib/api';
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = useSession('admin');
  return s ? <ClinicShell>{children}</ClinicShell> : null;
}
