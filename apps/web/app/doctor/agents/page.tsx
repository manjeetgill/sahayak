'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';

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
export default function Agents() {
  const s = useSession();
  const isDoctor = s?.user.role === 'doctor';
  const [agents, setAgents] = useState<any[]>([]);
  const [words, setWords] = useState('');
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    description: string;
    spec: Spec;
    notes: string[];
  } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const load = useCallback(async () => setAgents((await staff('/staff/agents')).agents), []);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s, load]);
  if (!s) return null;

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setErr('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const build = () =>
    run(async () => {
      const r = await staff('/staff/agents/interpret', { text: words });
      if (!r.understood) {
        setErr(r.help ?? 'I could not turn that into an agent.');
        return;
      }
      setDraft({ name: r.name, description: words, spec: r.spec, notes: r.notes ?? [] });
      setPreview(
        r.problems?.length
          ? { valid: false, problems: r.problems }
          : await staff('/staff/agents/preview', { spec: r.spec }),
      );
    });
  const doPreview = async () => {
    if (draft)
      setPreview(
        await staff('/staff/agents/preview', { spec: draft.spec }).catch((e) => ({
          valid: false,
          problems: [{ message: e.message }],
        })),
      );
  };
  const set = (patch: Partial<Spec>) =>
    draft && setDraft({ ...draft, spec: { ...draft.spec, ...patch } });
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
              })
            ).agentId;
        if (activate) await staff(`/staff/agents/${id}/activate`, {});
        setDraft(null);
        setPreview(null);
        setWords('');
      },
      activate ? 'Agent is on.' : 'Saved as a draft. Nothing runs until you turn it on.',
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
        <b>Custom agents</b>
        <a href={isDoctor ? '/doctor' : '/console'}>← Back</a>
      </div>
      <div className="wrap" style={{ maxWidth: 820 }}>
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
          Describe what you want in your own words. You will see exactly what the agent will do
          before anything runs. Fixed safety rules apply to every agent and cannot be changed:
          patients are messaged only if they agreed, never at night, never more than one custom
          message a week, with no links and no medical advice, and STOP always works.
        </p>

        {isDoctor && !draft && (
          <div className="card" data-testid="agent-builder">
            <h2>Create an agent</h2>
            <textarea
              aria-label="Describe your agent"
              rows={3}
              value={words}
              onChange={(e) => setWords(e.target.value)}
              placeholder={EXAMPLES[0]}
            />
            <p className="row" style={{ flexWrap: 'wrap' }}>
              <button disabled={words.trim().length < 5} onClick={build}>
                Build it
              </button>
              <span className="muted">
                Examples:{' '}
                {EXAMPLES.map((x) => (
                  <a
                    key={x}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setWords(x);
                    }}
                    style={{ marginRight: 10 }}
                  >
                    {x}
                  </a>
                ))}
              </span>
            </p>
          </div>
        )}

        {draft && (
          <div className="card" data-testid="agent-draft">
            <h2>{draft.id ? 'Edit agent' : 'Review your agent'}</h2>
            {draft.notes.map((n, i) => (
              <div key={i} className="banner warn" style={{ margin: '4px 0' }} role="status">
                {n}
              </div>
            ))}
            <label htmlFor="an">Name</label>
            <input
              id="an"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <label htmlFor="when">When</label>
            <div className="row">
              <select
                id="when"
                aria-label="When"
                value={scheduleKind}
                onChange={(e) => setTrigger(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="day">Every day</option>
                <option value="week">Every week</option>
                <option value="month">Every month</option>
                <option value="event">When something happens</option>
              </select>
              {t?.every === 'week' && (
                <select
                  aria-label="Weekday"
                  value={t.weekday}
                  onChange={(e) => set({ trigger: { ...t, weekday: Number(e.target.value) } })}
                  style={{ width: 'auto' }}
                >
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {t?.every === 'month' && (
                <>
                  <span>on day</span>
                  <input
                    aria-label="Day of month"
                    type="number"
                    min={1}
                    max={28}
                    value={t.dayOfMonth}
                    onChange={(e) => set({ trigger: { ...t, dayOfMonth: Number(e.target.value) } })}
                    style={{ width: 70 }}
                  />
                </>
              )}
              {t?.type === 'schedule' && (
                <>
                  <span>at</span>
                  <input
                    aria-label="Time"
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
                    aria-label="Event"
                    value={t.event}
                    onChange={(e) => set({ trigger: { ...t, event: e.target.value } })}
                    style={{ width: 'auto' }}
                  >
                    {EVENTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span>wait</span>
                  <input
                    aria-label="Delay hours"
                    type="number"
                    min={0}
                    max={168}
                    value={t.delayHours ?? 0}
                    onChange={(e) => set({ trigger: { ...t, delayHours: Number(e.target.value) } })}
                    style={{ width: 70 }}
                  />
                  <span>hours</span>
                </>
              )}
            </div>
            {ac?.type === 'message_patients' && (
              <>
                <label>Who gets it</label>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <input
                    aria-label="Patient labels"
                    placeholder="labels, e.g. diabetes, bp"
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
                  <span>not visited for</span>
                  <input
                    aria-label="Days since last visit"
                    type="number"
                    min={7}
                    placeholder="days"
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
                  Only patients who agreed to messages and reminders are ever included. Add labels
                  to patients on their record.
                </p>
              </>
            )}
            <label>What it does</label>
            <select
              aria-label="Action"
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
                            to: 'receptionist',
                            text: { en: '{name} needs attention.' },
                          }
                        : { type: 'summary', metrics: ['seen', 'no_shows'] },
                })
              }
              style={{ width: 'auto' }}
            >
              <option value="message_patients">Send patients a WhatsApp message</option>
              <option value="notify_staff">Tell the doctor or receptionist</option>
              <option value="summary">Send me a summary of numbers</option>
            </select>
            {(ac?.type === 'message_patients' || ac?.type === 'notify_staff') && (
              <>
                {ac.type === 'notify_staff' && (
                  <select
                    aria-label="Tell"
                    value={ac.to}
                    onChange={(e) => set({ action: { ...ac, to: e.target.value } })}
                    style={{ width: 'auto', marginTop: 6 }}
                  >
                    <option value="receptionist">the receptionist</option>
                    <option value="doctor">the doctor</option>
                    <option value="both">both</option>
                  </select>
                )}
                <label htmlFor="txt">
                  Message (English). Use {'{name}'} and {'{clinic}'}
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
                  Message (हिन्दी, optional: Hindi-speaking patients get English if empty)
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
                {METRICS.map(([k, l]) => (
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
                    {l}
                  </label>
                ))}
              </div>
            )}

            <p>
              <button className="ghost" onClick={doPreview}>
                Check what it will do
              </button>
            </p>
            {preview &&
              (preview.valid ? (
                <div className="card" style={{ background: '#f0fdf4' }} data-testid="agent-preview">
                  <b>This agent will:</b>
                  {preview.explain.map((l: string, i: number) => (
                    <div key={i}>{l}</div>
                  ))}
                  {preview.audience && (
                    <p style={{ marginTop: 8 }}>
                      <b>Right now it would reach {preview.audience.count} patient(s)</b>
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
                Approve and turn on
              </button>
              <button className="ghost" onClick={() => save(false)} disabled={!preview?.valid}>
                Save as draft
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setDraft(null);
                  setPreview(null);
                }}
              >
                Cancel
              </button>
            </p>
          </div>
        )}

        <h2 style={{ marginTop: '1.2rem' }}>Your agents</h2>
        {!agents.length && <p className="muted">No agents yet.</p>}
        <div className="list" data-testid="agent-list">
          {agents.map((a) => (
            <div key={a.id} className="card" style={{ margin: '8px 0' }}>
              <div className="row between">
                <b>{a.name}</b>
                <span
                  className={`tag ${a.status === 'active' ? 'called' : a.status === 'paused' ? 'on_hold' : ''}`}
                >
                  {a.status}
                </span>
              </div>
              {a.explain.map((l: string, i: number) => (
                <div key={i} className="muted" style={{ fontSize: '.9rem' }}>
                  {l}
                </div>
              ))}
              <div className="muted" style={{ fontSize: '.8rem', marginTop: 4 }}>
                {a.next_run_at
                  ? `Next run: ${new Date(a.next_run_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · `
                  : ''}
                {a.run_count} run(s)
                {a.runs[0]
                  ? ` · last: ${a.runs[0].status}${a.runs[0].result?.sent !== undefined ? `, ${a.runs[0].result.sent} sent` : ''}`
                  : ''}
              </div>
              <p className="row">
                {a.status === 'active' && (
                  <button
                    className="small ghost"
                    onClick={() => run(() => staff(`/staff/agents/${a.id}/pause`, {}), 'Paused')}
                  >
                    Pause
                  </button>
                )}
                {isDoctor && a.status === 'paused' && (
                  <button
                    className="small"
                    onClick={() => run(() => staff(`/staff/agents/${a.id}/resume`, {}), 'Resumed')}
                  >
                    Resume
                  </button>
                )}
                {isDoctor && a.status === 'draft' && (
                  <button
                    className="small"
                    onClick={() =>
                      run(() => staff(`/staff/agents/${a.id}/activate`, {}), 'Agent is on.')
                    }
                  >
                    Turn on
                  </button>
                )}
                {isDoctor && (
                  <button
                    className="small ghost"
                    onClick={() => {
                      setDraft({
                        id: a.id,
                        name: a.name,
                        description: a.description,
                        spec: JSON.parse(JSON.stringify(a.spec)),
                        notes: ['Editing turns the agent off until you approve it again.'],
                      });
                      setPreview(null);
                      window.scrollTo(0, 0);
                    }}
                  >
                    Edit
                  </button>
                )}
                {isDoctor && (
                  <button
                    className="small danger"
                    onClick={() =>
                      confirm(`Delete "${a.name}"?`) &&
                      run(() => staff(`/staff/agents/${a.id}`, undefined, 'DELETE'))
                    }
                  >
                    Delete
                  </button>
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
