'use client';
import { FeedbackMessaging } from '../../components/FeedbackMessaging';
import { EveningMessaging } from '../../components/EveningMessaging';
import { useStaffLang } from '../../../lib/staffText';
export default function Messages() {
  const { x } = useStaffLang();
  return (
    <div className="wrap">
      <h1>{x('Patient check-in messages')}</h1>
      <p>
        {x(
          'Set up delivery. Doctors and receptionists handle patient responses in their own workspaces.',
        )}
      </p>
      <FeedbackMessaging />
      <EveningMessaging />
    </div>
  );
}
