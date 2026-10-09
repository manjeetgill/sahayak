'use client';
import AssistantsWorkspace from '../../components/AssistantsWorkspace';
import { useSession } from '../../../lib/api';
export default function Page() {
  const s = useSession();
  return s ? <AssistantsWorkspace personal={s.user.role === 'doctor'} /> : null;
}
