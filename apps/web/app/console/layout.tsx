import { WorkspaceBoundary } from '../components/WorkspaceBoundary';
import { ClinicShell } from '../components/ClinicShell';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceBoundary kind="receptionist"><ClinicShell>{children}</ClinicShell></WorkspaceBoundary>;
}
