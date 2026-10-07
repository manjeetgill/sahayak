'use client';
import { useSession } from '../../../lib/api';
import { FeedbackWorkspace } from '../../components/FeedbackWorkspace';
export default function Checkins() {
  const s = useSession('receptionist');
  if (!s) return null;
  return (
    <div className="wrap">
      <h1>Patient check-ins</h1>
      <p>Arrange callbacks and record patient contact. Clinical concerns need a doctor’s review.</p>
      <FeedbackWorkspace />
    </div>
  );
}
