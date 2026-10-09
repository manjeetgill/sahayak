'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
const words: Record<string, string> = {
  planned: 'Waiting for a response',
  patient_response: 'Patient replied',
  automatically_scheduled: 'Scheduled automatically when the visit finished',
  patient_resolution: 'Patient confirmed the outcome',
  analysis_prepared: 'Reading assistance prepared',
  link_prepared: 'Private form link prepared',
  opt_out: 'Patient stopped future messages',
  assign: 'Responsibility assigned',
  note: 'Staff note',
  reopen: 'Concern reopened',
  close: 'Closed after staff review',
  new: 'New concern',
  assigned: 'Assigned',
  contacted: 'Patient contacted',
  action_taken: 'Clinic action recorded',
  closed: 'Closed',
  better: 'Feeling better',
  same: 'About the same',
  worse: 'Feeling worse',
  callback: 'Callback requested',
  clinical: 'Clinical review',
  service: 'Clinic experience',
  instructions: 'Instructions need clarification',
  review: 'Review response',
  none: 'None selected',
  medicine: 'Medicine question',
  next_steps: 'Next steps',
  visit: 'Visit experience',
  other: 'Other',
  waiting: 'Waiting time',
  explanation: 'Clearer explanations',
  fees: 'Fees',
  booking: 'Booking',
  staff: 'Staff behaviour',
  yes: 'Concern addressed',
  partly: 'Partly addressed',
  help: 'Still needs help',
};
export const feedbackLabel = (s: string) => words[s] ?? s.replaceAll('_', ' ');
export function FeedbackWorkspace({ patientId }: { patientId?: string }) {
  const { x, lang } = useStaffLang();
  const session = useSession();
  const doctor = session?.user.role === 'doctor';
  const canManage = !!session && session.user.role !== 'admin';
  const canViewRecord = doctor || session?.user.role === 'admin';
  const [data, setData] = useState<any>(null),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [links, setLinks] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(''),
    [note, setNote] = useState(''),
    [action, setAction] = useState('contacted'),
    [owner, setOwner] = useState(''),
    [due, setDue] = useState('');
  const load = useCallback(async () => {
    try {
      setData(
        await staff(
          `/staff/feedback?filter=${filter}${patientId ? `&patientId=${patientId}` : ''}`,
        ),
      );
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, [filter, patientId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const open = () => {
      if (location.hash.startsWith('#case-')) setSelected(location.hash.slice(6));
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const makeLink = async (c: any, purpose: string) =>
    run(async () => {
      const result = await staff(`/staff/feedback/${c.id}/link`, { purpose });
      setLinks((l) => ({ ...l, [c.id]: location.origin + result.path }));
    });
  return (
    <section aria-label={x('Patient feedback work')}>
      <div className="feedback-heading">
        <div>
          <h2>{x(patientId ? 'Check-in responses' : 'Patients who need a reply')}</h2>
          <p className="muted">{x('Read what the patient said, make contact, and record what helped.')}</p>
        </div>
        <button className="ghost" onClick={() => void load()}>
          {x('Refresh')}
        </button>
      </div>
      <label>
        {x('Show')}
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {[
            ['all', 'All check-ins'],
            ['clinical', 'Clinical review'],
            ['callback', 'Callbacks'],
            ['instructions', 'Unclear instructions'],
            ['service', 'Clinic experience'],
            ['waiting', 'Waiting for a response'],
            ['overdue', 'Overdue'],
            ['closed', 'Closed'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {x(l)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error && <p>{x('Loading patient check-ins…')}</p>}
      {data?.cases.length === 0 && (
        <div className="card">
          <h3>{x('No check-ins in this view')}</h3>
          <p>
            {x('Schedule a check-in from the visit completion checklist. Patient replies will appear here.')}
          </p>
          <div className="feedback-actions">
            {session?.user.role === 'admin' ? (
              <a href="/admin/messages">{x('Open feedback delivery setup')}</a>
            ) : (
              <>
                <a href="/doctor/checkins#settings">{x('Change my automatic feedback settings')}</a>
                <a href="/doctor#patient-search">{x('Find a patient')}</a>
              </>
            )}
          </div>
        </div>
      )}
      <div className="workspace-stack">
        {data?.cases.map((c: any) => (
          <article className="card" id={`case-${c.id}`} key={c.id}>
            <div className="feedback-heading">
              <div>
                <h3>{patientId ? x('Patient check-in') : c.patient_name}</h3>
                <p className="muted">
                  {c.assignee} · {new Date(c.scheduled_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
                </p>
              </div>
              <strong className={c.urgent ? 'error' : ''}>
                {c.status === 'cancelled'
                  ? x('Cancelled')
                  : c.urgent
                    ? x('Urgent review')
                    : x(feedbackLabel(c.work_status))}
              </strong>
            </div>
            {c.recovery && (
              <p>
                <b>{x(feedbackLabel(c.recovery))}</b> · {x(feedbackLabel(c.category))}
                {c.work_status !== 'closed' &&
                new Date(c.response_due_at ?? c.scheduled_at) < new Date()
                  ? ` · ${x('Needs attention')}`
                  : ''}
              </p>
            )}
            <button
              className="ghost"
              aria-expanded={selected === c.id}
              onClick={() => {
                setSelected(selected === c.id ? '' : c.id);
                setNote('');
                setOwner(c.assigned_to);
                setDue('');
                setAction('contacted');
              }}
            >
              {x(selected === c.id ? 'Hide details' : 'Review check-in')}
            </button>
            {selected === c.id && (
              <div className="workspace-stack feedback-detail">
                <div className="feedback-actions">
                  {canViewRecord && (
                    <a href={`/doctor/patients/${c.patient_id}`}>{x('Open patient and visit')}</a>
                  )}
                  {canManage && <a href={`tel:${c.phone}`}>{x('Call patient')}</a>}
                  {canViewRecord && (
                    <a href={`/doctor/patients/${c.patient_id}#care-workspace`}>
                      {x('Arrange follow-up')}
                    </a>
                  )}
                </div>
                {c.urgent && (
                  <p className="banner urgent">
                    {x('Potential urgent symptoms were reported. Review the original response promptly. The patient form advises immediate emergency help.')}
                  </p>
                )}
                {c.message !== null && c.message !== undefined ? (
                  <section aria-label={x('Original patient response')}>
                    <h4>{x('Original patient response')}</h4>
                    <p>
                      {x('Help requested:')} {x(feedbackLabel(c.help))} · {x('Clinic feedback:')}{' '}
                      {x(feedbackLabel(c.theme))}
                    </p>
                    <blockquote style={{ whiteSpace: 'pre-wrap' }}>
                      {c.message || x('No written comment added.')}
                    </blockquote>
                    <small>{new Date(c.responded_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}</small>
                  </section>
                ) : (
                  <p>
                    {x('No response yet. Silence does not mean the patient is satisfied or has left the clinic.')}
                  </p>
                )}
                {!!c.resolutions?.length && (
                  <p>
                    {x('Latest patient confirmation:')}{' '}
                    <b>{x(feedbackLabel(c.resolutions[c.resolutions.length - 1].answer))}</b>
                  </p>
                )}
                {canManage && c.status === 'scheduled' &&
                  (c.work_status === 'planned' || c.work_status === 'action_taken') && (
                    <div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void makeLink(
                            c,
                            c.work_status === 'action_taken' ? 'resolution' : 'response',
                          )
                        }
                      >
                        {c.work_status === 'action_taken'
                          ? x('Prepare resolution link')
                          : x('Prepare patient form link')}
                      </button>
                      <p className="muted">
                        {x('Private link, valid for seven days. Only share with this patient. Preparing a link does not send a message.')}
                      </p>
                    </div>
                  )}
                {links[c.id] && (
                  <p>
                    <a href={links[c.id]} target="_blank" rel="noreferrer">
                      {x('Open private patient form')}
                    </a>
                    <input aria-label={x('Private patient form link')} readOnly value={links[c.id]} />
                  </p>
                )}
                {doctor && c.responded_at && (
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await staff(`/staff/feedback/${c.id}/analyse`, {});
                      })
                    }
                  >
                    {x('Prepare reading assistance')}
                  </button>
                )}
                {c.analysis && (
                  <section className="banner">
                    <h4>
                      {c.analysis.usedAi
                        ? x('AI-assisted reading — verify against the original')
                        : x('Reading assistance — staff review needed')}
                    </h4>
                    <p>
                      {x('Suggested category:')} {x(feedbackLabel(c.analysis.category))} ·{' '}
                      {x(c.analysis.uncertain ? 'Needs human interpretation' : 'Verify before acting')}
                    </p>
                    {c.analysis.quotes.map((q: string, n: number) => (
                      <blockquote key={n}>{q}</blockquote>
                    ))}
                    <p>
                      <b>{x('Acknowledgement draft — not sent')}</b>
                    </p>
                    <p>{c.analysis.draft}</p>
                    <p className="muted">
                      {x('No treatment advice is generated. Record your own reviewed action below.')}
                    </p>
                  </section>
                )}
                {canManage && c.responded_at && c.status === 'scheduled' && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await staff(
                          `/staff/feedback/${c.id}`,
                          {
                            action,
                            note,
                            ...(action === 'assign' ? { assignedTo: owner } : {}),
                            ...(due ? { dueAt: new Date(due).toISOString() } : {}),
                          },
                          'PATCH',
                        );
                        setNote('');
                      });
                    }}
                  >
                    <h4>{x('Record the next action')}</h4>
                    <label>
                      {x('Action')}
                      <select value={action} onChange={(e) => setAction(e.target.value)}>
                        {[
                          ['assign', 'Assign responsibility'],
                          ['contacted', 'Record patient contact'],
                          ['action_taken', 'Record clinic action'],
                          ['close', 'Close after review'],
                          ['reopen', 'Reopen concern'],
                          ['note', 'Add staff note'],
                        ].map(([v, l]) => (
                          <option key={v} value={v}>
                            {x(l)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {action === 'assign' && (
                      <label>
                        {x('Responsible person')}
                        <select required value={owner} onChange={(e) => setOwner(e.target.value)}>
                          <option value="">{x('Choose staff')}</option>
                          {data.staff.map((u: any) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {x('Next review due (optional, your local time)')}
                      <input
                        type="datetime-local"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                      />
                    </label>
                    <label>
                      {x('What did the clinic do?')}
                      <textarea
                        required
                        minLength={3}
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={x('Record the contact, explanation or agreed next step. Do not imply contact happened unless it did.')}
                      />
                    </label>
                    <button disabled={busy}>{x('Save action')}</button>
                    <p className="muted">
                      {x('Clinical concerns need a doctor’s review before action or closure. Saving a note does not send it to the patient.')}
                    </p>
                  </form>
                )}
                <section>
                  <h4>{x('Contact and delivery history')}</h4>
                  {!c.delivery?.length && <p>{x('No WhatsApp delivery recorded.')}</p>}
                  {c.delivery?.map((d: any) => (
                    <p key={d.id}>
                      {x(d.kind === 'initial' ? 'Initial check-in' : 'One reminder')}:{' '}
                      <b>{x(feedbackLabel(d.state))}</b>
                      {d.delivered_at
                        ? ` · ${x('Delivered')} ${new Date(d.delivered_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}`
                        : ''}
                      {d.detail ? ` · ${d.detail}` : ''}
                    </p>
                  ))}
                  <ul>
                    {c.history?.map((h: any) => (
                      <li key={h.id}>
                        <b>{x(feedbackLabel(h.kind))}</b> · {new Date(h.created_at).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
                        {h.note && <p style={{ whiteSpace: 'pre-wrap' }}>{h.note}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
