'use client';
import { displayLabel } from '../../../lib/labels';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { CareNav } from '../../components/CareNav';
export default function Waitlist() {
  const s = useSession();
  const [adding, setAdding] = useState(false);
  const [data, setData] = useState<any>(null),
    [doctors, setDoctors] = useState<any[]>([]),
    [patients, setPatients] = useState<any[]>([]);
  const [q, setQ] = useState(''),
    [patientId, setPatient] = useState(''),
    [doctorId, setDoctor] = useState(''),
    [fromDate, setFrom] = useState(''),
    [toDate, setTo] = useState(''),
    [optedIn, setOpted] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => setData(await staff('/staff/waitlist'));
  useEffect(() => {
    if (s) {
      load().catch((e) => setError(e.message));
      staff('/staff/doctors')
        .then(setDoctors)
        .catch((e) => setError(e.message));
    }
  }, [s]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!s) return null;
  return (
    <div className="wrap" style={{ maxWidth: 850 }}>
      <a href={s.user.role === 'doctor' ? '/doctor' : '/console'}>← Dashboard</a>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Care</span>
          <h1>Cancellation waiting list</h1>
        </div>
        <button onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close form' : 'Add patient'}
        </button>
      </div>
      <p>
        Offers go to opted-in patients in signup order who have messaging and reminder consent. An
        offer reserves the slot for 15 minutes. Patients accept by replying with the offer code.
        Offers are sent between 08:00 and 21:00 clinic time.
      </p>
      {s.user.role === 'doctor' && <CareNav />}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className={`workspace-split waitlist-workspace ${adding ? 'adding' : ''}`}>
        <fieldset disabled={busy} hidden={!adding}>
          <legend>Add patient</legend>
          <label>
            Find patient
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" />
          </label>
          <button
            disabled={q.trim().length < 2}
            onClick={() =>
              run(async () =>
                setPatients(await staff(`/staff/patients/search?q=${encodeURIComponent(q)}`)),
              )
            }
          >
            Search
          </button>
          <label>
            Patient
            <select
              aria-label="Patient"
              value={patientId}
              onChange={(e) => setPatient(e.target.value)}
            >
              <option value="">Choose patient</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.phone}
                </option>
              ))}
            </select>
          </label>
          <label>
            Doctor
            <select
              aria-label="Doctor"
              value={doctorId}
              onChange={(e) => setDoctor(e.target.value)}
            >
              <option value="">Choose doctor</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From date
            <input type="date" value={fromDate} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Through date
            <input type="date" value={toDate} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={optedIn} onChange={(e) => setOpted(e.target.checked)} />
            The patient explicitly agreed to receive cancellation-slot offers.
          </label>
          <button
            disabled={!patientId || !doctorId || !fromDate || !toDate || !optedIn}
            onClick={() =>
              run(async () => {
                await staff('/staff/waitlist', {
                  patientId,
                  doctorId,
                  fromDate,
                  toDate,
                  optedIn: true,
                });
                setOpted(false);
                setMessage('Added to waiting list.');
              })
            }
          >
            Add to waiting list
          </button>
        </fieldset>
        <section className="card waiting-patients">
          <button className="ghost" disabled={busy} onClick={() => run(load)}>
            Refresh
          </button>
          <h2>Waiting patients</h2>
          {data?.waiting.length === 0 && <p>No waiting patients.</p>}
          {data?.waiting.map((w: any) => (
            <p key={w.id}>
              {w.patient_name} · {w.doctor} · {String(w.from_date).slice(0, 10)} –{' '}
              {String(w.to_date).slice(0, 10)}{' '}
              <button
                disabled={busy}
                className="small ghost"
                onClick={() => run(() => staff(`/staff/waitlist/${w.id}`, undefined, 'DELETE'))}
              >
                Withdraw
              </button>
            </p>
          ))}
        </section>
      </div>
      <div className="workspace-split" style={{ marginTop: '1rem' }}>
        <section className="card">
          <h2>Cancelled slots</h2>
          <p>
            Cancellations attempt the first offer automatically. If an offer expires, use Offer next
            to approach the next eligible patient. No appointment is created until acceptance.
          </p>
          {data?.cancellations.map((a: any) => (
            <p key={a.id}>
              {a.doctor} · {new Date(a.starts_at).toLocaleString()}{' '}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await staff('/staff/waitlist/offer', { appointmentId: a.id });
                    setMessage(
                      r.offered
                        ? 'Offer prepared. Check message activity to see whether it was sent.'
                        : 'No offer prepared. The time may be reserved, messaging may be closed for the day, or no waiting patient meets the requirements.',
                    );
                  })
                }
              >
                Offer next
              </button>
            </p>
          ))}
        </section>
        <section className="card">
          <h2>Recent offers</h2>
          {data?.offers.length === 0 && <p className="muted">No offers yet.</p>}
          {data?.offers.map((o: any) => (
            <p key={o.id}>
              {o.patient_name} · {new Date(o.starts_at).toLocaleString()} · {displayLabel(o.status)}{' '}
              · expires {new Date(o.expires_at).toLocaleString()} · code {o.code}
            </p>
          ))}
        </section>
      </div>
    </div>
  );
}
