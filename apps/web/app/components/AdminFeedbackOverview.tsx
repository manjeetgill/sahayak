'use client';
import { useEffect, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
export function AdminFeedbackOverview() {
  const { x } = useStaffLang();
  const [doctors, setDoctors] = useState<any[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    staff('/staff/patient-checkins/preferences/all')
      .then((d) => setDoctors(d.doctors))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section id="settings" className="card" style={{ scrollMarginTop: 90 }}>
      <h2>{x('Automatic feedback · every doctor')}</h2>
      <p>
        {x('These are each doctor’s saved choices for scheduling feedback after a finished visit. The doctor can change their own preferences. Admin manages delivery and the approved invitation.')}
      </p>
      <a href="/admin/messages">{x('Open feedback delivery setup')}</a>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {doctors
        ? doctors.map((d) => (
            <article className="card" key={d.id}>
              <h3>{d.name}</h3>
              <p>
                <b>{x(d.enabled ? 'Scheduling on' : 'Scheduling off')}</b> ·{' '}
                {d.delay_days === 0 ? x('Same day') : `${d.delay_days} ${x('day(s) after the visit')}`} {x('at time')}{' '}
                {d.send_time.slice(0, 5)}
              </p>
              <p>
                {x('Follow-up owner:')} {d.assigned_name || x('Patient’s doctor')} · {x('Reminder:')}{' '}
                {x(d.reminder_enabled ? 'On' : 'Off')}
              </p>
            </article>
          ))
        : !error && <p>{x('Loading doctor preferences…')}</p>}
    </section>
  );
}
