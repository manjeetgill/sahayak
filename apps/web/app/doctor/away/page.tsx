'use client';
import { useSession } from '../../../lib/api';
import { AwayManager } from '../../components/AwayManager';

export default function DoctorAway() {
  const s = useSession('doctor');
  if (!s) return null;
  return <AwayManager />;
}
