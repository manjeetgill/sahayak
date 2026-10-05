'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { displayLabel } from '../../../lib/labels';
export default function Practice() {
  const s = useSession('doctor');
  const [days, setDays] = useState('30'),
    [data, setData] = useState<any>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (s) {
      setData(null);
      staff(`/staff/practice?days=${days}`)
        .then(setData)
        .catch((e) => setError(e.message));
    }
  }, [s, days]);
  if (!s) return null;
  return (
    <main className="wrap" style={{ maxWidth: 900 }}>
      <a href="/doctor">← Today’s clinic</a>
      <h1>Clinic overview</h1>
      <p>
        Measured activity from this clinic. Counts describe recorded work, not clinical outcomes.
      </p>
      <label>
        Period
        <select
          value={days}
          onChange={(e) => {
            setError('');
            setDays(e.target.value);
          }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="card">
            <h2>Work needing attention now</h2>
            <p>
              {data.urgent} open urgent alerts · {data.reportsWaiting} reports/photos awaiting
              review
            </p>
            <a href="/doctor/inbox">Open outstanding work</a>
          </div>
          <h2>Recorded payments</h2>
          <p>
            Collected in this period: ₹{(Number(data.finances.collected) / 100).toFixed(2)} ·
            Outstanding across all open charges: ₹
            {(Number(data.finances.outstanding) / 100).toFixed(2)}
          </p>
          <h2>Follow-through measures</h2>
          {[
            ['Recorded no-show rate', 'no_shows', 'attendance_known'],
            ['Referral completion', 'referrals_complete', 'referrals_total'],
            ['Due follow-up completion', 'followups_complete', 'followups_total'],
          ].map(([label, n, d]) => (
            <p key={n}>
              {label}:{' '}
              {data.measures[d]
                ? `${((100 * data.measures[n]) / data.measures[d]).toFixed(1)}% (${data.measures[n]} of ${data.measures[d]})`
                : 'Not enough recorded data'}
            </p>
          ))}
          <p>
            No-show rate excludes cancelled and unresolved bookings. Referral completion means the
            patient was informed; follow-up completion means a doctor closed a due step. These are
            workflow measures, not clinical outcomes.
          </p>
          <p>
            Average recorded consultation:{' '}
            {data.measures.consultation_minutes === null
              ? 'Not available'
              : `${data.measures.consultation_minutes} minutes`}{' '}
            · {data.measures.timed_visits} visits with an explicit consultation start and finish.
            Older call times are not substituted.
          </p>
          <p>
            Recorded collections per paying patient:{' '}
            {data.measures.collected_per_paying_patient === null
              ? 'Not available'
              : `₹${data.measures.collected_per_paying_patient}`}{' '}
            (only identifiable patients with a non-corrected payment in this period).
          </p>
          <h2>Patients seen</h2>
          <p>
            {data.patientActivity.total} distinct patients with a completed visit ·{' '}
            {data.patientActivity.returning} had a completed visit before this period ·{' '}
            {data.patientActivity.total - data.patientActivity.returning} had no earlier completed
            visit recorded.
          </p>
          <details>
            <summary>Completed visits by day</summary>
            {data.dailyVisits.map((d: any) => (
              <p key={d.day}>
                {d.day}: {d.count}
              </p>
            ))}
            {!data.dailyVisits.length && <p>No completed visits recorded.</p>}
          </details>
          <h2>During this period</h2>
          <p>{data.notes} signed visit notes</p>
          {[
            ['Visits', 'visits'],
            ['Appointments whose time has passed', 'appointments'],
            ['Report and referral tasks created', 'tasks'],
            ['Follow-up steps due', 'steps'],
          ].map(([title, key]) => (
            <section className="card" key={key}>
              <h3>{title}</h3>
              {data[key].length ? (
                data[key].map((r: any, n: number) => (
                  <p key={n}>
                    {r.kind ? `${displayLabel(r.kind)} · ` : ''}
                    {displayLabel(r.status)}: <b>{r.count}</b>
                  </p>
                ))
              ) : (
                <p>No recorded activity for this period.</p>
              )}
            </section>
          ))}
          <p>
            Payment totals include only amounts recorded in Sahayak; they are not a bank
            reconciliation. Time saved is not estimated without a measured baseline. A signed note
            is not counted as an automatically completed consultation.
          </p>
        </>
      )}
    </main>
  );
}
