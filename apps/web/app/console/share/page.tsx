'use client';
import { useSession } from '../../../lib/api';
import { ShareKit } from '../../components/ShareKit';

export default function Share() {
  const s = useSession('receptionist');
  return s ? <ShareKit /> : null;
}
