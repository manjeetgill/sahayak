import { ClinicShell } from '../components/ClinicShell';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ClinicShell>{children}</ClinicShell>;
}
