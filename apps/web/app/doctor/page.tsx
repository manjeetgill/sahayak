'use client';
import { useSection } from '../components/useSection';
import { AttentionSummary } from '../components/AttentionSummary';
import { VisitChecklist } from '../components/VisitChecklist';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@sahayak/shared';
import { AskClinic } from '../components/AskClinic';
import { PatientSearch } from '../components/PatientSearch';
import { beep, staff, useLive, useSession } from '../../lib/api';

const utilitySection = (hash: string) => hash;
export default function Doctor() {
  const s = useSession('doctor');
  const utility = useSection(utilitySection, '');
  const [queue, setQueue] = useState<any[]>([]),
    [today, setToday] = useState<any[]>([]),
    [flags, setFlags] = useState<any[]>([]);
  const [llmDown, setLlmDown] = useState(false);
  const [setupDone, setSetupDone] = useState(true);
  const [late, setLate] = useState(''),
    [proposal, setProposal] = useState<any>(null),
    [summary, setSummary] = useState<any>(null),
    [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [q, a, f] = await Promise.all([
      staff('/staff/queue'),
      staff('/staff/today'),
      staff('/staff/flags'),
    ]);
    staff('/staff/setup')
      .then((x) => setSetupDone(x.completed))
      .catch(() => {});
    setQueue(q);
    setToday(a);
    setFlags(f);
    const sm = await staff('/staff/schedule/summary');
    setSummary(sm.proposal?.status === 'confirmed' ? sm : null);
  }, []);
  useEffect(() => {
    if (s) load().catch(() => {});
  }, [s, load]);
  useLive(s ? `/ws?token=${s.token}` : null, (e) => {
    if (e.type === 'flag_raised' && e.severity === 'urgent') beep();
    if (e.type === 'llm_status') setLlmDown(!e.ok);
    if (['queue_changed', 'flag_raised', 'flag_resolved', 'schedule_proposal'].includes(e.type))
      load().catch(() => {});
  });
  if (!s) return null;
  const current = queue.find((q) => q.status === 'called' || q.status === 'in_consultation');
  const waiting = queue.filter((q) => q.status === 'waiting');
  const held = queue.filter((q) => q.status === 'on_hold');
  const act = (path: string, body?: unknown) => staff(path, body ?? {}).then(load);
  const proposeLate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      setProposal(await staff('/staff/schedule/propose', { text: late }));
    } catch (x: any) {
      setErr(x.message);
    }
  };
  const confirmLate = async () => {
    try {
      await staff(`/staff/schedule/${proposal.proposalId}/confirm`, {});
      setProposal(null);
      setLate('');
      await load();
    } catch (x: any) {
      setErr(x.message);
    }
  };
  const urgent = flags.filter((f) => f.severity === 'urgent');
  const done = queue.filter((q) => q.status === 'done').length;

  return (
    <div className="doctor-today">
      <header className="doctor-page-heading">
        <div>
          <span className="page-eyebrow">Today&apos;s clinic</span>
          <h1>Good afternoon, Dr. {s.user.name.replace(/^Dr\.\s*/i, '').split(' ')[0]}</h1>
          <p className="muted">Your next patient and outstanding work are together here.</p>
        </div>
        <button
          onClick={() => act('/staff/queue/call-next', {})}
          disabled={!waiting.length && !current}
        >
          {t('en', 'doctor.next')} →
        </button>
      </header>
      {!setupDone && (
        <div className="banner warn" role="status">
          Your clinic setup is not finished. Ask your clinic admin to complete it.
        </div>
      )}
      {llmDown && <div className="banner warn">{t('en', 'console.llm_down')}</div>}
      {urgent.map((f) => (
        <div key={f.id} className="banner urgent" role="alert">
          {t('en', 'console.red_flag_alert')} — {f.summary}
          <button
            className="small ghost"
            style={{ marginLeft: 12, background: '#fff' }}
            onClick={() => act(`/staff/flags/${f.id}/resolve`)}
          >
            Seen
          </button>
        </div>
      ))}
      <div className="grid3" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div>
          <AttentionSummary />
          <div className="card current-consultation" hidden={!current} data-testid="patient-card">
            {current ? (
              <>
                <div className="row between">
                  <h2>{current.patient_name}</h2>
                  <span className="tag called">Token {current.token_number}</span>
                </div>
                <p className="muted">{current.age ? `Age ${current.age}` : ''}</p>
                <p>
                  <a href={`/doctor/patients/${current.patient_id}`}>
                    Open record and write note →
                  </a>
                </p>
                <p>
                  <b>Intake:</b>{' '}
                  {current.intake_summary ?? <span className="muted">No intake answers yet</span>}
                </p>
                <div className="row">
                  {current.status === 'called' && (
                    <button onClick={() => act(`/staff/queue/${current.id}/start`)}>
                      Patient is here
                    </button>
                  )}
                  <button className="ghost" onClick={() => act(`/staff/queue/${current.id}/hold`)}>
                    {t('en', 'doctor.hold')}
                  </button>
                  <button className="ghost" onClick={() => act(`/staff/queue/${current.id}/skip`)}>
                    {t('en', 'doctor.skip')}
                  </button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <VisitChecklist key={current.id} id={current.id} onFinished={() => void load()} />
                </div>
              </>
            ) : (
              <p className="muted">No patient in the room. Press Next patient.</p>
            )}
          </div>
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3>
              {t('en', 'doctor.waiting')} ({waiting.length})
            </h3>
            <div className="list">
              {waiting.map((q) => (
                <div key={q.id} className="row between">
                  <span>
                    <b>{q.token_number}</b> · {q.patient_name}{' '}
                    <span className="muted">~{q.wait_minutes} min</span>
                  </span>
                  <span className="row">
                    <button
                      className="small ghost"
                      onClick={() => act(`/staff/queue/${q.id}/hold`)}
                    >
                      {t('en', 'doctor.hold')}
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => act(`/staff/queue/${q.id}/skip`)}
                    >
                      {t('en', 'doctor.skip')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {held.length > 0 && (
              <>
                <h3 style={{ marginTop: '1rem' }}>On hold</h3>
                <div className="list">
                  {held.map((q) => (
                    <div key={q.id} className="row between">
                      <span>
                        <b>{q.token_number}</b> · {q.patient_name}
                      </span>
                      <button className="small" onClick={() => act(`/staff/queue/${q.id}/resume`)}>
                        Resume
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <aside className="workspace-stack">
          <section className="card today-metrics">
            <div className="panel-heading">
              <h2>Today</h2>
              <span className="tag">Live</span>
            </div>
            <div className="metric-grid">
              <div className="metric-tile">
                <strong>{today.length}</strong>
                <span>Booked</span>
              </div>
              <div className="metric-tile">
                <strong>{done}</strong>
                <span>Seen</span>
              </div>
              <div className="metric-tile">
                <strong>{waiting.length}</strong>
                <span>Waiting</span>
              </div>
            </div>
            <details>
              <summary>Appointments today</summary>
              <p className="muted">
                {today.length} appointments · {queue.length} checked in · {done} seen ·{' '}
                {waiting.length} waiting
              </p>
              <div className="list">
                {today.map((a) => (
                  <div key={a.id} className="row between">
                    <span>
                      {new Date(a.starts_at).toLocaleTimeString('en-IN', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      · {a.patient ?? '—'} <span className="muted">{a.reason ?? ''}</span>
                    </span>
                    <span className={`tag ${a.status}`}>{a.status}</span>
                  </div>
                ))}
              </div>
            </details>
          </section>
          <section hidden={utility !== 'ask-clinic'}>
            <AskClinic />
          </section>
          <section hidden={utility !== 'patient-search'}>
            <PatientSearch />
          </section>
          <div className="card" style={{ marginBottom: '1rem' }} data-testid="late-box">
            <h3>Running late?</h3>
            <p className="muted">Preview affected patients before sending.</p>
            <form className="row" onSubmit={proposeLate}>
              <input
                aria-label="Running late"
                placeholder='Running late? e.g. "running 30 min late"'
                value={late}
                onChange={(e) => setLate(e.target.value)}
              />
              <button type="submit" className="ghost">
                Check impact
              </button>
            </form>
            {err && (
              <div className="error" role="alert">
                {err}
              </div>
            )}
            {proposal && (
              <div data-testid="late-proposal" style={{ marginTop: '.6rem' }}>
                <p>
                  <b>{proposal.affected}</b> patient(s) affected by a {proposal.minutes}-minute
                  delay
                  {proposal.needsRebooking
                    ? ` (${proposal.needsRebooking} will need a new day/time)`
                    : ''}
                  .
                </p>
                <p className="muted">Nothing is sent until you confirm.</p>
                <div className="row">
                  <button onClick={confirmLate}>Confirm and notify patients</button>
                  <button
                    className="ghost"
                    onClick={() =>
                      staff(`/staff/schedule/${proposal.proposalId}/cancel`, {}).then(() =>
                        setProposal(null),
                      )
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {summary && (
              <div data-testid="late-summary" style={{ marginTop: '.6rem' }}>
                <b>Running-late update ({summary.proposal.minutes} min)</b>
                <div className="muted">
                  {summary.counts.notified}/{summary.counts.affected} notified ·{' '}
                  {summary.counts.keptNewTime} kept new time · {summary.counts.rebooked} rebooked ·{' '}
                  {summary.counts.waitingForReply} waiting for reply
                  {summary.counts.needsCall ? ` · ${summary.counts.needsCall} need a call` : ''}
                </div>
              </div>
            )}
          </div>
          <section className="card">
            <h2>Quick actions</h2>
            <nav className="action-links">
              <a href="#patient-search">Find patient</a>
              <a href="/doctor/care">Create care task</a>
              <a href="/doctor/practice">Clinic overview</a>
            </nav>
            <details className="more-clinic-tools">
              <summary>More clinic tools</summary>
              <nav className="action-links">
                <a href="#ask-clinic">Ask your clinic</a>
                <a href="/doctor/inbox">Needs my attention</a>
                <a href="/doctor/waitlist">Waiting list</a>
                <a href="/doctor/templates">Reusable care plans</a>
                <a href="/doctor/references">Medical reference</a>
                <a href="/doctor/settings">My professional details</a>

                <a href="/safety">Safety report</a>
              </nav>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
