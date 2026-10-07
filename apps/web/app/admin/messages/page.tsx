'use client';
import { FeedbackMessaging } from '../../components/FeedbackMessaging';
export default function Messages() {
  return (
    <div className="wrap">
      <h1>Patient check-in messages</h1>
      <p>
        Set up delivery. Doctors and receptionists handle patient responses in their own workspaces.
      </p>
      <FeedbackMessaging />
    </div>
  );
}
