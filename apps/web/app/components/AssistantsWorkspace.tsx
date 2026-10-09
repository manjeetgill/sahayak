'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';
import { Connections } from '../doctor/agents/components/connections';

import DoctorAssistantAccess from './DoctorAssistantAccess';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EVENTS: [string, string][] = [
  ['visit.finished', 'a visit finishes'],
  ['appointment.booked', 'an appointment is booked'],
  ['appointment.cancelled', 'an appointment is cancelled'],
  ['patient.checked_in', 'a patient checks in'],
];
const METRICS: [string, string][] = [
  ['seen', 'patients seen'],
  ['no_shows', 'no-shows'],
  ['cancellations', 'cancellations'],
  ['appointments', 'appointments'],
  ['new_patients', 'new patients'],
  ['wait', 'waiting time'],
  ['ratings', 'ratings'],
];
const EXAMPLES = [
  'remind my diabetic patients every month',
  'message patients who have not visited in 90 days',
  'send me the number of no-shows every evening at 7pm',
  'tell the receptionist when someone cancels',
  'after every visit send a thank-you message',
];

type Spec = { trigger: any; audience: any; action: any };

/** Custom agents: describe an automation in plain words, check what it will do, then approve it. Safety rules are fixed. */
export default function AssistantsWorkspace({ personal = false }: { personal?: boolean }) {
  const s = useSession();
  const { x } = useStaffLang();
  const [permitted, setPermitted] = useState(false);
  const [tab, setTab] = useState<'all' | 'overview' | 'whatsapp' | 'phone' | 'automations'>(
    personal ? 'overview' : 'all',
  );
  const [busy, setBusy] = useState(false);
  const canManage = !!s?.user.clinicAdmin || (personal && permitted);
  const [agents, setAgents] = useState<any[]>([]);
  const [words, setWords] = useState('');
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    description: string;
    spec: Spec;
    notes: string[];
    platformDraftId?: string;
    platformVersion?: number;
  } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const load = useCallback(async () => setAgents((await staff('/staff/agents')).agents), []);
  useEffect(() => {
    if (s && (!personal || permitted)) load().catch((e) => setErr(e.message));
    else setAgents([]);
  }, [s, load, personal, permitted]);
  if (!s) return null;

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    if (busy) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const build = (request = words) =>
    run(async () => {
      const r = await staff('/staff/agents/interpret', { text: request });
      if (!r.understood) {
        setErr(r.help ?? 'I could not prepare that request. Try one of the examples.');
        return;
      }
      setDraft({
        name: r.name,
        description: request,
        spec: r.spec,
        notes: r.notes ?? [],
        platformDraftId: r.platformDraftId,
        platformVersion: r.platformVersion,
      });
      setPreview(
        r.problems?.length
          ? { valid: false, problems: r.problems }
          : await staff('/staff/agents/preview', { spec: r.spec }),
      );
    });
  const doPreview = () =>
    run(async () => {
      if (!draft) return;
      setPreview(null);
      setPreview(await staff('/staff/agents/preview', { spec: draft.spec }));
    });
  const set = (patch: Partial<Spec>) => {
    if (draft) {
      setDraft({
        ...draft,
        spec: { ...draft.spec, ...patch },
        platformDraftId: undefined,
        platformVersion: undefined,
      });
      setPreview(null);
    }
  };
  const save = (activate: boolean) =>
    run(
      async () => {
        if (!draft) return;
        const id = draft.id
          ? (await staff(
              `/staff/agents/${draft.id}`,
              { name: draft.name, spec: draft.spec },
              'PATCH',
            ),
            draft.id)
          : (
              await staff('/staff/agents', {
                name: draft.name,
                description: draft.description,
                spec: draft.spec,
                platformDraftId: draft.platformDraftId,
                platformVersion: draft.platformVersion,
              })
            ).agentId;
        setDraft({ ...draft, id });
        if (activate) await staff(`/staff/agents/${id}/activate`, {});
        setDraft(null);
        setPreview(null);
        setWords('');
      },
      activate ? x('Assistant is on.') : x('Saved as a draft. Nothing runs until you turn it on.'),
    );

  const t = draft?.spec.trigger,
    au = draft?.spec.audience ?? {},
    ac = draft?.spec.action;
  const scheduleKind = t?.type === 'event' ? 'event' : t?.every;
  const setTrigger = (kind: string) =>
    set({
      trigger:
        kind === 'event'
          ? { type: 'event', event: 'visit.finished', delayHours: 0 }
          : kind === 'day'
            ? { type: 'schedule', every: 'day', at: '10:00' }
            : kind === 'week'
              ? { type: 'schedule', every: 'week', weekday: 1, at: '10:00' }
              : { type: 'schedule', every: 'month', dayOfMonth: 1, at: '10:00' },
    });

  return (
    <div>
      <div className="topbar">
        <b>{x(personal ? 'Help for your day' : 'Clinic assistants')}</b>
        <a href={personal ? '/doctor' : '/admin'}>← {x('Back')}</a>
      </div>
      <div className="wrap assistants-page" style={{ maxWidth: 1120 }}>
        <span className="eyebrow">{x(personal ? 'YOUR CLINIC HELPERS' : 'Clinic assistants')}</span>
        <h1>
          {x(
            {
              all: 'All clinic assistants',
              overview: personal ? 'A little help with your busy day' : 'Everyday help',
              whatsapp: 'WhatsApp',
              phone: 'Phone calls',
              automations: 'Reminders and updates',
            }[tab]
          )}
        </h1>
        <p>
          {personal
            ? x('Let your assistants handle routine questions and reminders. Choose the help you want below.')
            : x('Choose what your clinic needs help with. You stay in control of patient messages and reminders.')}
        </p>
        <nav
          aria-label={x('Clinic assistant sections')}
          className="assistant-tabs"
          style={{ flexWrap: 'wrap', marginBottom: 16 }}
        >
          {(personal
            ? permitted
              ? (['overview', 'automations'] as const)
              : (['overview'] as const)
            : (['all', 'overview', 'whatsapp', 'phone', 'automations'] as const)
          ).map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              className={tab === value ? '' : 'ghost'}
              onClick={() => setTab(value)}
            >
              {x(
                {
                  all: 'Show everything',
                  overview: personal ? 'My assistants' : 'Everyday help',
                  whatsapp: 'WhatsApp',
                  phone: 'Phone calls',
                  automations: 'Reminders & updates',
                }[value]
              )}
            </button>
          ))}
        </nav>
        {(tab === 'all' || tab === 'overview' || personal) && (
          <div hidden={personal && tab !== 'overview'}>
            <DoctorAssistantAccess
              personal={personal}
              onAccess={personal ? setPermitted : undefined}
              onReminders={() => setTab('automations')}
            />
          </div>
        )}
        {!personal &&
          tab !== 'automations' &&
          (tab === 'all' ? (
            <>
              <div id="everyday-help">
                <Connections canManage={canManage} view="overview" />
              </div>
              <div id="whatsapp">
                <Connections canManage={canManage} view="whatsapp" />
              </div>
              <div id="phone">
                <Connections canManage={canManage} view="phone" />
              </div>
            </>
          ) : (
            <Connections key={tab} canManage={canManage} view={tab} />
          ))}
        <div
          className="reminders-workspace"
          id="automations"
          hidden={(tab !== 'all' && tab !== 'automations') || (personal && !permitted)}
        >
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {busy && <p role="status">{x('Checking your reminder or update… Please wait.')}</p>}
            <h2 style={{ marginTop: 24 }}>
              {x(personal ? 'My reminders & updates' : 'Reminders & updates')}
            </h2>
            {personal && (
              <p>
                {x('Choose a starting point, review the message, then approve it. To start a reminder, turn on “Stay in touch” under My assistants. Summaries go only to you.')}
              </p>
            )}
            {err && (
              <div className="error" role="alert">
                {err}
              </div>
            )}
            {msg && (
              <div role="status" style={{ color: 'var(--ok)', fontWeight: 700 }}>
                {msg}
              </div>
            )}
            <p className="muted">
              {x('Choose an example or describe what you need. First prepare a draft, then review who it reaches, when it happens, and the message. Nothing starts until you approve. Patient safeguards always apply: patients are messaged only if they agreed, never at night, never more than one custom message a week, with no links and no medical advice, and STOP always works.')}
            </p>

            {canManage && !draft && (
              <div className="card" data-testid="agent-builder">
                <h3>
                  {x(personal ? 'What would you like help with?' : 'Set up a reminder or update')}
                </h3>
                {personal && (
                  <>
                    <p>
                      {x('Choose an example. You can change the message and timing before approving it.')}
                    </p>
                    <div className="assistant-template-grid">
                      {[
                        {
                          title: 'Thank patients after a visit',
                          detail: 'A friendly message after their consultation.',
                          request: 'after every visit send a thank-you message',
                        },
                        {
                          title: 'Invite patients to return',
                          detail: 'A gentle reminder for patients not seen in 90 days.',
                          request: 'message patients who have not visited in 90 days',
                        },
                        {
                          title: 'Send me a daily summary',
                          detail: 'See your patient count and missed appointments.',
                          request:
                            'send me a summary of patients seen and no-shows every evening at 7pm',
                        },
                      ].map((example) => (
                        <button
                          type="button"
                          className="assistant-template"
                          key={example.title}
                          disabled={busy}
                          onClick={() => {
                            setWords(example.request);
                            build(example.request);
                          }}
                        >
                          <b>{x(example.title)}</b>
                          <span>{x(example.detail)}</span>
                          <span className="assistant-template-action">{x('Prepare for review →')}</span>
                        </button>
                      ))}
                    </div>
                    <label htmlFor="assistant-request">{x('Or describe what you need')}</label>
                  </>
                )}
                <textarea
                  id="assistant-request"
                  aria-label={x('What would you like help with?')}
                  rows={3}
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder={x(EXAMPLES[0])}
                />
                <p className="row" style={{ flexWrap: 'wrap' }}>
                  <button disabled={busy || words.trim().length < 5} onClick={() => build()}>
                    {x('Prepare a draft')}
                  </button>
                  {!personal && (
                    <span className="muted">
                      {x('Examples:')}{' '}
                      {EXAMPLES.filter((example) => !personal || !example.includes('receptionist')).map((example) => (
                        <a
                          key={example}
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setWords(example);
                          }}
                          style={{ marginRight: 10 }}
                        >
                          {x(example)}
                        </a>
                      ))}
                    </span>
                  )}
                </p>
              </div>
            )}

            {draft && (
              <div className="card" data-testid="agent-draft">
                <h2>{x(draft.id ? 'Edit reminder or update' : 'Review before turning on')}</h2>
                {draft.notes.map((n, i) => (
                  <div key={i} className="banner warn" style={{ margin: '4px 0' }} role="status">
                    {n}
                  </div>
                ))}
                <label htmlFor="an">{x('Name')}</label>
                <input
                  id="an"
                  value={draft.name}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      name: e.target.value,
                      platformDraftId: undefined,
                      platformVersion: undefined,
                    });
                    setPreview(null);
                  }}
                />
                <label htmlFor="when">{x('When')}</label>
                <div className="row">
                  <select
                    id="when"
                    aria-label={x('When')}
                    value={scheduleKind}
                    onChange={(e) => setTrigger(e.target.value)}
                    style={{ width: 'auto' }}
                  >
                    <option value="day">{x('Every day')}</option>
                    <option value="week">{x('Every week')}</option>
                    <option value="month">{x('Every month')}</option>
                    <option value="event">{x('When something happens')}</option>
                  </select>
                  {t?.every === 'week' && (
                    <select
                      aria-label={x('Weekday')}
                      value={t.weekday}
                      onChange={(e) => set({ trigger: { ...t, weekday: Number(e.target.value) } })}
                      style={{ width: 'auto' }}
                    >
                      {WEEKDAYS.map((d, i) => (
                        <option key={d} value={i}>
                          {x(d)}
                        </option>
                      ))}
                    </select>
                  )}
                  {t?.every === 'month' && (
                    <>
                      <span>{x('on day')}</span>
                      <input
                        aria-label={x('Day of month')}
                        type="number"
                        min={1}
                        max={28}
                        value={t.dayOfMonth}
                        onChange={(e) =>
                          set({ trigger: { ...t, dayOfMonth: Number(e.target.value) } })
                        }
                        style={{ width: 70 }}
                      />
                    </>
                  )}
                  {t?.type === 'schedule' && (
                    <>
                      <span>{x('at')}</span>
                      <input
                        aria-label={x('Time')}
                        type="time"
                        value={t.at}
                        onChange={(e) => set({ trigger: { ...t, at: e.target.value } })}
                        style={{ width: 120 }}
                      />
                    </>
                  )}
                  {t?.type === 'event' && (
                    <>
                      <select
                        aria-label={x('Event')}
                        value={t.event}
                        onChange={(e) => set({ trigger: { ...t, event: e.target.value } })}
                        style={{ width: 'auto' }}
                      >
                        {EVENTS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {x(l.replaceAll('custom-agent message', 'scheduled message'))}
                          </option>
                        ))}
                      </select>
                      <span>{x('wait')}</span>
                      <input
                        aria-label={x('Delay hours')}
                        type="number"
                        min={0}
                        max={168}
                        value={t.delayHours ?? 0}
                        onChange={(e) =>
                          set({ trigger: { ...t, delayHours: Number(e.target.value) } })
                        }
                        style={{ width: 70 }}
                      />
                      <span>{x('hours')}</span>
                    </>
                  )}
                </div>
                {ac?.type === 'message_patients' && (
                  <>
                    <label>{x('Who gets it')}</label>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      <input
                        aria-label={x('Patient labels')}
                        placeholder={x('labels, e.g. diabetes, bp')}
                        value={(au.tags ?? []).join(', ')}
                        onChange={(e) =>
                          set({
                            audience: {
                              ...au,
                              tags: e.target.value
                                .split(',')
                                .map((x) => x.trim().toLowerCase())
                                .filter(Boolean),
                            },
                          })
                        }
                        style={{ flex: 1 }}
                      />
                      <span>{x('not visited for')}</span>
                      <input
                        aria-label={x('Days since last visit')}
                        type="number"
                        min={7}
                        placeholder={x('days')}
                        value={au.lastVisitOlderThanDays ?? ''}
                        onChange={(e) =>
                          set({
                            audience: {
                              ...au,
                              lastVisitOlderThanDays: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
                          })
                        }
                        style={{ width: 90 }}
                      />
                    </div>
                    <p className="muted" style={{ fontSize: '.8rem' }}>
                      {x('Only patients who agreed to messages and reminders are ever included. Add labels to patients on their record.')}
                    </p>
                  </>
                )}
                <label>{x('What it does')}</label>
                <select
                  aria-label={x('Action')}
                  value={ac?.type}
                  onChange={(e) =>
                    set({
                      action:
                        e.target.value === 'message_patients'
                          ? {
                              type: 'message_patients',
                              text: { en: 'Hello {name}, a reminder from {clinic}.' },
                            }
                          : e.target.value === 'notify_staff'
                            ? {
                                type: 'notify_staff',
                                to: personal ? 'doctor' : 'receptionist',
                                text: { en: '{name} needs attention.' },
                              }
                            : { type: 'summary', metrics: ['seen', 'no_shows'] },
                    })
                  }
                  style={{ width: 'auto' }}
                >
                  <option value="message_patients">{x('Send patients a WhatsApp message')}</option>
                  <option value="notify_staff">
                    {x(personal ? 'Notify me on WhatsApp' : 'Tell the doctor or receptionist')}
                  </option>
                  <option value="summary">{x('Send me a summary of numbers')}</option>
                </select>
                {(ac?.type === 'message_patients' || ac?.type === 'notify_staff') && (
                  <>
                    {ac.type === 'notify_staff' && (
                      <select
                        aria-label={x('Tell')}
                        value={ac.to}
                        onChange={(e) => set({ action: { ...ac, to: e.target.value } })}
                        style={{ width: 'auto', marginTop: 6 }}
                      >
                        {!personal && <option value="receptionist">{x('the receptionist')}</option>}
                        <option value="doctor">{x(personal ? 'me' : 'the doctor')}</option>
                        {!personal && <option value="both">{x('both')}</option>}
                      </select>
                    )}
                    <label htmlFor="txt">
                      {x('Message (English). Use')} {'{name}'} {x('and')} {'{clinic}'}
                    </label>
                    <textarea
                      id="txt"
                      rows={2}
                      value={ac.text.en}
                      onChange={(e) =>
                        set({ action: { ...ac, text: { ...ac.text, en: e.target.value } } })
                      }
                    />
                    <label htmlFor="txthi">
                      {x('Message (हिन्दी, optional: Hindi-speaking patients get English if empty)')}
                    </label>
                    <textarea
                      id="txthi"
                      rows={2}
                      value={ac.text.hi ?? ''}
                      onChange={(e) =>
                        set({
                          action: { ...ac, text: { ...ac.text, hi: e.target.value || undefined } },
                        })
                      }
                    />
                  </>
                )}
                {ac?.type === 'summary' && (
                  <div style={{ marginTop: 6 }}>
                    {METRICS.filter(([m]) => !personal || m !== 'new_patients').map(([k, l]) => (
                      <label
                        key={k}
                        className="check"
                        style={{ display: 'inline-flex', marginRight: 14 }}
                      >
                        <input
                          type="checkbox"
                          checked={ac.metrics.includes(k)}
                          onChange={(e) =>
                            set({
                              action: {
                                ...ac,
                                metrics: e.target.checked
                                  ? [...ac.metrics, k]
                                  : ac.metrics.filter((m: string) => m !== k),
                              },
                            })
                          }
                        />
                        {x(l.replaceAll('custom-agent message', 'scheduled message'))}
                      </label>
                    ))}
                  </div>
                )}

                <p>
                  <button className="ghost" onClick={doPreview}>
                    {x('Check what it will do')}
                  </button>
                </p>
                {preview &&
                  (preview.valid ? (
                    <div
                      className="card"
                      style={{ background: '#f0fdf4' }}
                      data-testid="agent-preview"
                    >
                      <h3>{x('Before you approve')}</h3>
                      <p>{x('This preview sends nothing. Counts can change before this runs.')}</p>
                      {preview.nextRun && (
                        <p>
                          <b>{x('Next scheduled time:')}</b>{' '}
                          {new Date(preview.nextRun).toLocaleString('en-IN')}
                        </p>
                      )}
                      {preview.audience?.cappedAt && (
                        <p>{x('At most')} {preview.audience.cappedAt} {x('patients per run.')}</p>
                      )}
                      <p>
                        <b>{x('When:')}</b>{' '}
                        {t?.type === 'event'
                          ? `After ${EVENTS.find(([key]) => key === t.event)?.[1] ?? 'a clinic event'}, wait ${t.delayHours ?? 0} hour(s)`
                          : `Every ${t?.every} at ${t?.at} (clinic time)`}
                      </p>
                      <p>
                        <b>{x('Who:')}</b>{' '}
                        {ac?.type === 'message_patients'
                          ? `${preview.audience?.count ?? 0} eligible patients currently`
                          : ac?.type === 'notify_staff'
                            ? ac.to
                            : x('Clinic staff summary')}
                      </p>
                      <b>{x('What it does:')}</b>
                      {preview.explain.map((l: string, i: number) => (
                        <div key={i}>
                          {x(l.replaceAll('custom-agent message', 'scheduled message'))}
                        </div>
                      ))}
                      {preview.audience && (
                        <p style={{ marginTop: 8 }}>
                          <b>{x('Right now it would reach')} {preview.audience.count} {x('patient(s)')}</b>
                          {preview.audience.sample.length
                            ? ` (for example ${preview.audience.sample.join(', ')})`
                            : ''}
                          .
                        </p>
                      )}
                      {preview.example && (
                        <pre
                          style={{
                            whiteSpace: 'pre-wrap',
                            background: '#fff',
                            padding: 8,
                            borderRadius: 8,
                          }}
                        >
                          {preview.example}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="error" role="alert" data-testid="agent-problems">
                      {preview.problems.map((p: any, i: number) => (
                        <div key={i}>{p.message}</div>
                      ))}
                    </div>
                  ))}
                <p className="row">
                  <button disabled={!preview?.valid} onClick={() => save(true)}>
                    {x('Approve and turn on')}
                  </button>
                  <button className="ghost" onClick={() => save(false)} disabled={!preview?.valid}>
                    {x('Save as draft')}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => {
                      setDraft(null);
                      setPreview(null);
                    }}
                  >
                    {x('Cancel')}
                  </button>
                </p>
              </div>
            )}

            <h2 style={{ marginTop: '1.2rem' }}>{x('Your reminders and updates')}</h2>
            {!agents.length && (
              <p className="muted">
                {x('No reminders or updates set up yet. Choose an example above to get started.')}
              </p>
            )}
            <div className="list" data-testid="agent-list">
              {agents.map((a) => (
                <div key={a.id} className="card" style={{ margin: '8px 0' }}>
                  <div className="row between">
                    <b>{a.name}</b>
                    {!personal && (
                      <span className="muted"> · {a.doctorName ?? x('Whole clinic')}</span>
                    )}
                    <span
                      className={`tag ${a.status === 'active' ? 'called' : a.status === 'paused' ? 'on_hold' : ''}`}
                    >
                      {x(a.status === 'active' ? 'On' : a.status === 'paused' ? 'Paused' : 'Draft')}
                    </span>
                  </div>
                  <details open={!personal}>
                    <summary>{x('Setup details')}</summary>
                    {a.platform_draft_id
                      ? `AI-Agent-Platform · version ${a.platform_version}`
                      : x('Prepared in Sahayak')}
                  </details>
                  {a.explain.map((l: string, i: number) => (
                    <div key={i} className="muted" style={{ fontSize: '.9rem' }}>
                      {l.replaceAll('custom-agent message', 'scheduled message')}
                    </div>
                  ))}
                  <div className="muted" style={{ fontSize: '.8rem', marginTop: 4 }}>
                    {a.next_run_at
                      ? `Next scheduled time: ${new Date(a.next_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · `
                      : ''}
                    {a.run_count} {x("time(s) processed")}
                    {a.runs[0]
                      ? ` · last: ${a.runs[0].status}${a.runs[0].result?.sent !== undefined ? `, ${a.runs[0].result.sent} sent` : ''}`
                      : ''}
                  </div>
                  <p className="row">
                    {a.status === 'active' && (
                      <button
                        className="small ghost"
                        onClick={() =>
                          run(() => staff(`/staff/agents/${a.id}/pause`, {}), 'Paused')
                        }
                      >
                        {x('Pause')}
                      </button>
                    )}
                    {canManage && a.status === 'paused' && (
                      <button
                        className="small"
                        onClick={() =>
                          run(() => staff(`/staff/agents/${a.id}/resume`, {}), 'Resumed')
                        }
                      >
                        {x('Resume')}
                      </button>
                    )}
                    {canManage && a.status === 'draft' && (
                      <button
                        className="small"
                        onClick={() => {
                          setDraft({
                            id: a.id,
                            name: a.name,
                            description: a.description,
                            spec: JSON.parse(JSON.stringify(a.spec)),
                            notes: ['Review this draft before turning it on.'],
                          });
                          setPreview(null);
                          window.scrollTo(0, 0);
                        }}
                      >
                        {x('Review and turn on')}
                      </button>
                    )}
                    {canManage && (
                      <button
                        className="small ghost"
                        onClick={() => {
                          setDraft({
                            id: a.id,
                            name: a.name,
                            description: a.description,
                            spec: JSON.parse(JSON.stringify(a.spec)),
                            notes: [
                              'Editing pauses this reminder or update until you approve it again.',
                            ],
                          });
                          setPreview(null);
                          window.scrollTo(0, 0);
                        }}
                      >
                        {x('Edit')}
                      </button>
                    )}
                    {canManage && (
                      <button
                        className="small danger"
                        onClick={() =>
                          confirm(`${x('Delete')} "${a.name}"?`) &&
                          run(() => staff(`/staff/agents/${a.id}`, undefined, 'DELETE'))
                        }
                      >
                        {x('Delete')}
                      </button>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="banner warn">
          {x(personal
            ? 'Before using live messages or calls, check connections in Clinic setup. Preparing or approving a reminder does not connect delivery.'
            : 'Before using live messages or calls, check their connection status in the tabs below. Preparing or approving a reminder does not connect delivery.')}
        </p>
      </div>
    </div>
  );
}
