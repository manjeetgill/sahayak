'use client';
import { useSession } from '../../../lib/api';
import { CareTasks } from '../../components/CareTasks';
import { CareNav } from '../../components/CareNav';
export default function Care() {
  const s = useSession('doctor');
  if (!s) return null;
  return (
    <div className="wrap">
      <a href="/doctor">← Doctor dashboard</a>
      <h1>Pending care tasks</h1>
      <CareNav />
      <CareTasks />
    </div>
  );
}
