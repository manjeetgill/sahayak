'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { staff, useLive } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
import { displayLabel } from '../../lib/labels';

type Booking = {
  id: string;
  starts_at: string;
  status: string;
  source: string;
  patient_id: string | null;
  doctor: string;
  patient: string | null;
};
export function AppointmentList({ token }: { token: string }) {
  const { lang, x } = useStaffLang();
  const [date, setDate] = useState('');
  const [data, setData] = useState<{
    appointments: Booking[];
    hasMore: boolean;
    timezone: string;
    clinic: string;
  } | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await staff(`/staff/appointments${date ? `?date=${date}` : ''}`);
      if (request !== generation.current) return;
      setData(next);
      setError('');
    } catch (e: any) {
      if (request === generation.current) setError(e.message);
    }
  }, [date]);
  useEffect(() => {
    setData(null);
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => {
      generation.current++;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [load]);
  useLive(`/ws?token=${token}`, (e) => {
    if (e.type === 'queue_changed' || e.type === 'schedule_proposal') void load();
  });
  return (
    <section className="card" id="appointments" aria-label={x('Upcoming appointments')}>
      <div className="row between">
        <h2>{x('Upcoming appointments')}</h2>
        <button className="ghost small" onClick={() => void load()}>
          {x('Refresh')}
        </button>
      </div>
      <p className="muted">{data?.clinic}</p>
      <p className="muted">
        {x(
          'Bookings appear here as soon as they are confirmed. Patients join the queue after arrival and check-in.',
        )}
      </p>
      <div className="row">
        <label>
          {x('Appointment date')}{' '}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="ghost" onClick={() => setDate('')}>
          {x('All upcoming')}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p>{x('Loading…')}</p>}
      {data && (
        <div className="list">
          {data.appointments.map((a) => (
            <div key={a.id} className="row between" data-testid="appointment-row">
              <div>
                <strong>{a.patient ?? '—'}</strong>
                <p>
                  {new Date(a.starts_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
                    timeZone: data.timezone,
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}{' '}
                  · {a.doctor}
                </p>
                <span className="muted">
                  {x('Booking source')}:{' '}
                  {a.source === 'whatsapp' ? 'WhatsApp' : x(displayLabel(a.source))}
                </span>
              </div>
              <span className={`tag ${a.status}`}>{x(displayLabel(a.status))}</span>
            </div>
          ))}
          {!data.appointments.length && (
            <p>{x(date ? 'No appointments for this date.' : 'No upcoming appointments.')}</p>
          )}
          {data.hasMore && (
            <p>{x('Showing the first 100 appointments. Choose a date to narrow the list.')}</p>
          )}
        </div>
      )}
    </section>
  );
}
