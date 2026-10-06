import { ClinicShell } from '../components/ClinicShell';

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return <ClinicShell>{children}</ClinicShell>;
}
