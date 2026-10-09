'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { AwayManager } from '../../components/AwayManager';
import { useStaffLang } from '../../../lib/staffText';

export default function ReceptionAway() {
  const { x } = useStaffLang();
  const s = useSession('receptionist');
  const [doctors, setDoctors] = useState<{ id: string; name: string }[]>([]);
  const [doctorId, setDoctorId] = useState('');
  useEffect(() => {
    if (s)
      staff('/staff/doctors')
        .then((d) => {
          setDoctors(d);
          setDoctorId(d[0]?.id ?? '');
        })
        .catch(() => {});
  }, [s]);
  if (!s) return null;
  return (
    <div>
      <label htmlFor="away-doc">{x('Doctor')}</label>
      <select id="away-doc" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <AwayManager key={doctorId} doctorId={doctorId} />
    </div>
  );
}
