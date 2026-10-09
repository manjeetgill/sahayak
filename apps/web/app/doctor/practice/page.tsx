'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { displayLabel } from '../../../lib/labels';
import { useStaffLang } from '../../../lib/staffText';
export default function Practice() {
  const { x } = useStaffLang();
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
    <main className="wrap practice-page" style={{ maxWidth: 1120 }}>
      <a href="/doctor">← {x('Today’s clinic')}</a>
      <h1>{x('Clinic overview')}</h1>
      <p>
        {x('Measured activity from this clinic. Counts describe recorded work, not clinical outcomes.')}
      </p>
      <label>
        {x('Period')}
        <select
          value={days}
          onChange={(e) => {
            setError('');
            setDays(e.target.value);
          }}
        >
          <option value="7">{x('Last 7 days')}</option>
          <option value="30">{x('Last 30 days')}</option>
          <option value="90">{x('Last 90 days')}</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="metric-grid">
            <div className="metric-tile">
              <strong>{data.patientActivity.total}</strong>
              <span>{x('Patients seen')}</span>
            </div>
            <div className="metric-tile">
              <strong>{data.reportsWaiting}</strong>
              <span>{x('Reports awaiting review')}</span>
            </div>
            <div className="metric-tile">
              <strong>₹{(Number(data.finances.collected) / 100).toFixed(2)}</strong>
              <span>{x('Recorded collections')}</span>
            </div>
          </div>
          <div className="workspace-split">
            <div className="card">
              <div className="card">
                <h2>{x('Work needing attention now')}</h2>
                <p>
                  {data.urgent} {x('open urgent alerts')} · {data.reportsWaiting} {x('reports/photos awaiting review')}
                </p>
                <a href="/doctor/inbox">{x('Open outstanding work')}</a>
              </div>
              <h2>{x('Recorded payments')}</h2>
              <p>
                {x('Collected in this period:')} ₹{(Number(data.finances.collected) / 100).toFixed(2)} ·
                {x('Outstanding across all open charges:')} ₹
                {(Number(data.finances.outstanding) / 100).toFixed(2)}
              </p>
              <h2>{x('Follow-through measures')}</h2>
              {[
                ['Recorded no-show rate', 'no_shows', 'attendance_known'],
                ['Referral completion', 'referrals_complete', 'referrals_total'],
                ['Due follow-up completion', 'followups_complete', 'followups_total'],
              ].map(([label, n, d]) => (
                <p key={n}>
                  {x(label)}:{' '}
                  {data.measures[d]
                    ? `${((100 * data.measures[n]) / data.measures[d]).toFixed(1)}% (${data.measures[n]} ${x('of')} ${data.measures[d]})`
                    : x('Not enough recorded data')}
                </p>
              ))}
              <p>
                {x('No-show rate excludes cancelled and unresolved bookings. Referral completion means the patient was informed; follow-up completion means a doctor closed a due step. These are workflow measures, not clinical outcomes.')}
              </p>
              <p>
                {x('Average recorded consultation:')}{' '}
                {data.measures.consultation_minutes === null
                  ? x('Not available')
                  : `${data.measures.consultation_minutes} ${x('minutes')}`}{' '}
                · {data.measures.timed_visits} {x('visits with an explicit consultation start and finish. Older call times are not substituted.')}
              </p>
              <p>
                {x('Recorded collections per paying patient:')}{' '}
                {data.measures.collected_per_paying_patient === null
                  ? x('Not available')
                  : `₹${data.measures.collected_per_paying_patient}`}{' '}
                {x('(only identifiable patients with a non-corrected payment in this period).')}
              </p>
              <h2>{x('Patients seen')}</h2>
              <p>
                {data.patientActivity.total} {x('distinct patients with a completed visit')} ·{' '}
                {data.patientActivity.returning} {x('had a completed visit before this period')} ·{' '}
                {data.patientActivity.total - data.patientActivity.returning} {x('had no earlier completed visit recorded.')}
              </p>
              <details open={s.user.role === 'admin'}>
                <summary>{x('Completed visits by day')}</summary>
                {data.dailyVisits.map((d: any) => (
                  <p key={d.day}>
                    {d.day}: {d.count}
                  </p>
                ))}
                {!data.dailyVisits.length && <p>{x('No completed visits recorded.')}</p>}
              </details>
            </div>
            <aside className="workspace-stack">
              <section className="card">
                <h2>{x('Clinic administration')}</h2>
                <nav className="action-links">
                  <a href="/doctor/settings">{x('My professional details')}</a>
                  <a href="/doctor/references">{x('Medical reference')}</a>
                  <a href="/safety">{x('Safety report')}</a>
                  <span className="muted">{x('Connections are managed by your clinic admin.')}</span>
                </nav>
              </section>
              <section className="card">
                <h2>{x('During this period')}</h2>
                <p>{data.notes} {x('signed visit notes')}</p>
                {[
                  ['Visits', 'visits'],
                  ['Appointments whose time has passed', 'appointments'],
                  ['Report and referral tasks created', 'tasks'],
                  ['Follow-up steps due', 'steps'],
                ].map(([title, key]) => (
                  <section className="card" key={key}>
                    <h3>{x(title)}</h3>
                    {data[key].length ? (
                      data[key].map((r: any, n: number) => (
                        <p key={n}>
                          {r.kind ? `${x(displayLabel(r.kind))} · ` : ''}
                          {x(displayLabel(r.status))}: <b>{r.count}</b>
                        </p>
                      ))
                    ) : (
                      <p>{x('No recorded activity for this period.')}</p>
                    )}
                  </section>
                ))}
                <p>
                  {x('Payment totals include only amounts recorded in Sahayak; they are not a bank reconciliation. Time saved is not estimated without a measured baseline. A signed note is not counted as an automatically completed consultation.')}
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
