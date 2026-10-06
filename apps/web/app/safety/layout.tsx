import { ClinicShell } from '../components/ClinicShell';

export default function SafetyLayout({ children }: { children: React.ReactNode }) {
  return <ClinicShell>{children}</ClinicShell>;
}
