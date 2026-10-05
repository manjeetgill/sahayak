'use client';
import { useSession } from '../../../lib/api';
import { CareTasks } from '../../components/CareTasks';
export default function Care() {
  const s = useSession('doctor');
  if (!s) return null;
  return (
    <div className="wrap">
      <a href="/doctor">← Doctor dashboard</a>
      <h1>Pending care tasks</h1>
      <CareTasks />
    </div>
  );
}
