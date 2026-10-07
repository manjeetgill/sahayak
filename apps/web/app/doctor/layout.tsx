import { WorkspaceBoundary } from '../components/WorkspaceBoundary';
import { ClinicShell } from '../components/ClinicShell';

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceBoundary kind="doctor"><ClinicShell>{children}</ClinicShell></WorkspaceBoundary>;
}
