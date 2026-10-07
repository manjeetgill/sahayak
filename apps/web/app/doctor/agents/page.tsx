'use client';
import { useSession } from '../../../lib/api';
export default function Moved() {
  const s = useSession();
  if (!s) return null;
  return (
    <div className="wrap">
      <h1>Managed by your clinic admin</h1>
      <p>Your admin sets up the clinic’s assistants and connections.</p>
      <a
        href={
          s.user.role === 'admin'
            ? '/admin/agents'
            : s.user.role === 'doctor'
              ? '/doctor'
              : '/console'
        }
      >
        Return to your workspace
      </a>
    </div>
  );
}
