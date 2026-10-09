'use client';
import { useSection } from '../components/useSection';
import { AttentionSummary } from '../components/AttentionSummary';
import { VisitChecklist } from '../components/VisitChecklist';
import { useCallback, useEffect, useState } from 'react';
import { t } from '@sahayak/shared';
import { AskClinic } from '../components/AskClinic';
import { PatientSearch } from '../components/PatientSearch';
import { beep, staff, useLive, useSession } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
import { useWorkspaceMode } from '../../lib/workspaceMode';
import { SoloDoctorDesk } from '../components/SoloDoctorDesk';

const utilitySection = (hash: string) => hash;
const greeting = (d = new Date()) =>
  d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening';
export default function Doctor() {
  const s = useSession('doctor');
  const mode = useWorkspaceMode(s?.user.clinicId);
  const { lang, x } = useStaffLang();
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
          <span className="page-eyebrow">{x("Today's clinic")}</span>
          <h1>
            {x(greeting())}, {lang === 'hi' ? 'डॉ.' : 'Dr.'} {s.user.name.replace(/^Dr\.\s*/i, '').split(' ')[0]}
          </h1>
          <p className="muted">{x('Your next patient and outstanding work are together here.')}</p>
        </div>
        <button
          onClick={() => act('/staff/queue/call-next', {})}
          disabled={!waiting.length && !current}
        >
          {t(lang, 'doctor.next')} →
        </button>
      </header>
      {!setupDone && (
        <div className="banner warn" role="status">
          {x('Your clinic setup is not finished. Ask your clinic admin to complete it.')}
        </div>
      )}
      {llmDown && <div className="banner warn">{t(lang, 'console.llm_down')}</div>}
      {urgent.map((f) => (
        <div key={f.id} className="banner urgent" role="alert">
          {t(lang, 'console.red_flag_alert')} — {f.summary}
          <button
            className="small ghost"
            style={{ marginLeft: 12, background: '#fff' }}
            onClick={() => act(`/staff/flags/${f.id}/resolve`)}
          >
            {x('Seen')}
          </button>
        </div>
      ))}
      {mode === 'solo' && <AttentionSummary solo />}
      {mode === 'solo' && s.user.role === 'doctor' && s.user.doctorId && (
        <SoloDoctorDesk doctorId={s.user.doctorId} onCheckin={() => void load()} />
      )}
      <div className="grid3" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div>
          <div className="card current-consultation" hidden={!current} data-testid="patient-card">
            {current ? (
              <>
                <div className="row between">
                  <div>
                    <span className="page-eyebrow">{x('Now seeing')}</span>
                    <h2>{current.patient_name}</h2>
                  </div>
                  <span className="tag called">{x('Token')} {current.token_number}</span>
                </div>
                <p className="muted">{current.age ? `${x('Age')} ${current.age}` : ''}</p>
                <p>
                  <b>{x('Intake:')}</b>{' '}
                  {current.intake_summary ?? <span className="muted">{x('No intake answers yet')}</span>}
                </p>
                <div className="row">
                  {current.status === 'called' ? (
                    <button onClick={() => act(`/staff/queue/${current.id}/start`)}>
                      {x('Patient is here')}
                    </button>
                  ) : (
                    <a
                      className="button-link primary"
                      href={`/doctor/patients/${current.patient_id}#note-composer`}
                    >
                      {x('Open record and write note →')}
                    </a>
                  )}
                  {current.status === 'called' && (
                    <a className="button-link" href={`/doctor/patients/${current.patient_id}`}>
                      {x('Open record')}
                    </a>
                  )}
                  <details className="more-actions">
                    <summary>{x('More')}</summary>
                    <button
                      className="ghost small"
                      onClick={() => act(`/staff/queue/${current.id}/hold`)}
                    >
                      {t(lang, 'doctor.hold')}
                    </button>
                    <button
                      className="ghost small"
                      onClick={() => act(`/staff/queue/${current.id}/skip`)}
                    >
                      {t(lang, 'doctor.skip')}
                    </button>
                  </details>
                </div>
                <div style={{ marginTop: 12 }}>
                  <VisitChecklist key={current.id} id={current.id} onFinished={() => void load()} />
                </div>
              </>
            ) : (
              <p className="muted">{x('No patient in the room. Press Next patient.')}</p>
            )}
          </div>
          {mode !== 'solo' && <AttentionSummary />}
          <div className="card" style={{ marginTop: '1rem' }}>
            <h3>
              {t(lang, 'doctor.waiting')} ({waiting.length})
            </h3>
            <div className="list">
              {waiting.map((q) => (
                <div key={q.id} className="row between">
                  <span>
                    <b>{q.token_number}</b> · {q.patient_name}{' '}
                    <span className="muted">~{q.wait_minutes} {x('min')}</span>
                  </span>
                  <span className="row">
                    <button
                      className="small ghost"
                      onClick={() => act(`/staff/queue/${q.id}/hold`)}
                    >
                      {t(lang, 'doctor.hold')}
                    </button>
                    <button
                      className="small ghost"
                      onClick={() => act(`/staff/queue/${q.id}/skip`)}
                    >
                      {t(lang, 'doctor.skip')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {held.length > 0 && (
              <>
                <h3 style={{ marginTop: '1rem' }}>{x('On hold')}</h3>
                <div className="list">
                  {held.map((q) => (
                    <div key={q.id} className="row between">
                      <span>
                        <b>{q.token_number}</b> · {q.patient_name}
                      </span>
                      <button className="small" onClick={() => act(`/staff/queue/${q.id}/resume`)}>
                        {x('Resume')}
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
              <h2>{x('Today')}</h2>
              <span className="tag">{x('Live')}</span>
            </div>
            <div className="metric-grid">
              <div className="metric-tile">
                <strong>{today.length}</strong>
                <span>{x('Booked')}</span>
              </div>
              <div className="metric-tile">
                <strong>{done}</strong>
                <span>{x('Seen')}</span>
              </div>
              <div className="metric-tile">
                <strong>{waiting.length}</strong>
                <span>{x('Waiting')}</span>
              </div>
            </div>
            <details>
              <summary>{x('Appointments today')}</summary>
              <p className="muted">
                {today.length} {x('appointments')} · {queue.length} {x('checked in')} · {done} {x('seen')} ·{' '}
                {waiting.length} {x('waiting')}
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
            <h3>{x('Running late?')}</h3>
            <p className="muted">{x('Preview affected patients before sending.')}</p>
            <form className="row" onSubmit={proposeLate}>
              <input
                aria-label={x('Running late')}
                placeholder={x('Running late? e.g. "running 30 min late"')}
                value={late}
                onChange={(e) => setLate(e.target.value)}
              />
              <button type="submit" className="ghost">
                {x('Check impact')}
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
                  <b>{proposal.affected}</b> {x('patient(s) affected by a')} {proposal.minutes}-{x('minute delay')}
                  {proposal.needsRebooking
                    ? ` (${proposal.needsRebooking} ${x('will need a new day/time')})`
                    : ''}
                  .
                </p>
                <p className="muted">{x('Nothing is sent until you confirm.')}</p>
                <div className="row">
                  <button onClick={confirmLate}>{x('Confirm and notify patients')}</button>
                  <button
                    className="ghost"
                    onClick={() =>
                      staff(`/staff/schedule/${proposal.proposalId}/cancel`, {}).then(() =>
                        setProposal(null),
                      )
                    }
                  >
                    {x('Cancel')}
                  </button>
                </div>
              </div>
            )}
            {summary && (
              <div data-testid="late-summary" style={{ marginTop: '.6rem' }}>
                <b>{x('Running-late update')} ({summary.proposal.minutes} {x('min')})</b>
                <div className="muted">
                  {summary.counts.notified}/{summary.counts.affected} {x('notified')} ·{' '}
                  {summary.counts.keptNewTime} {x('kept new time')} · {summary.counts.rebooked} {x('rebooked')} ·{' '}
                  {summary.counts.waitingForReply} {x('waiting for reply')}
                  {summary.counts.needsCall ? ` · ${summary.counts.needsCall} ${x('need a call')}` : ''}
                </div>
              </div>
            )}
          </div>
          <section className="card">
            <h2>{x('Quick actions')}</h2>
            <nav className="action-links">
              <a href="#patient-search">{x('Find patient')}</a>
              <a href="/doctor/care">{x('Create care task')}</a>
              <a href="/doctor/practice">{x('Clinic overview')}</a>
            </nav>
            <details className="more-clinic-tools">
              <summary>{x('More clinic tools')}</summary>
              <nav className="action-links">
                <a href="#ask-clinic">{x('Ask your clinic')}</a>
                <a href="/doctor/inbox">{x('Needs my attention')}</a>
                <a href="/doctor/waitlist">{x('Waiting list')}</a>
                <a href="/doctor/templates">{x('Reusable care plans')}</a>
                <a href="/doctor/references">{x('Medical reference')}</a>
                <a href="/doctor/share">{x("Share your clinic")}</a>
                <a href="/doctor/away">{x("I'm away")}</a>
                <a href="/doctor/shortcuts">{x('My visit shortcuts')}</a>
                <a href="/doctor/settings">{x('My professional details')}</a>

                <a href="/safety">{x('Safety report')}</a>
              </nav>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
