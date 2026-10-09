'use client';
import { useSession } from '../../../lib/api';
import { FeedbackWorkspace } from '../../components/FeedbackWorkspace';
import { useStaffLang } from '../../../lib/staffText';
export default function Checkins() {
  const { x } = useStaffLang();
  const s = useSession('receptionist');
  if (!s) return null;
  return (
    <div className="wrap">
      <h1>{x('Patient check-ins')}</h1>
      <p>{x('Arrange callbacks and record patient contact. Clinical concerns need a doctor’s review.')}</p>
      <FeedbackWorkspace />
    </div>
  );
}
