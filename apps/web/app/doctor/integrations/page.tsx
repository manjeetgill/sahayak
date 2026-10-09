'use client';
import { useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';
export default function Moved() {
  const { x } = useStaffLang();
  const s = useSession();
  if (!s) return null;
  return (
    <div className="wrap">
      <h1>{x('Managed by your clinic admin')}</h1>
      <p>{x('Your admin sets up the clinic’s assistants and connections.')}</p>
      <a
        href={
          s.user.role === 'admin'
            ? '/admin/integrations'
            : s.user.role === 'doctor'
              ? '/doctor'
              : '/console'
        }
      >
        {x('Return to your workspace')}
      </a>
    </div>
  );
}
