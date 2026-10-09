'use client';
import { useSession } from '../../../lib/api';
import { CareTasks } from '../../components/CareTasks';
import { CareNav } from '../../components/CareNav';
import { useStaffLang } from '../../../lib/staffText';
export default function Care() {
  const s = useSession('doctor');
  const { x } = useStaffLang();
  if (!s) return null;
  return (
    <div className="wrap">
      <a href="/doctor">← {x('Doctor dashboard')}</a>
      <h1>{x('Pending care tasks')}</h1>
      <CareNav />
      <CareTasks />
    </div>
  );
}
