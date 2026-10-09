'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { API, api, session } from '../../../lib/api';
import { beats, phases, noteText, waitingAnswer, suggestion } from './story';
import css from './presentation.module.css';

type Bubble = { who: string; text: string; kind: 'patient' | 'assistant' | 'update' | 'preview' };
type Saved = {
  auth: any;
  data: any;
  cursor: number;
  chat: Bubble[];
  events: { title: string; who: string }[];
  arrivalToken: string;
  feedbackPath: string;
};
const KEY = 'sahayak.demo.presentation.v1';
const date = (value: string) =>
  new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
export default function Presentation() {
  const [saved, setSaved] = useState<Saved | null>(null),
    [kind, setKind] = useState('solo'),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [running, setRunning] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [speed, setSpeed] = useState('2000'),
    [formOpen, setFormOpen] = useState(false);
  const state = useRef<Saved | null>(null),
    active = useRef(false),
    playing = useRef(false),
    mounted = useRef(true),
    chatBox = useRef<HTMLDivElement>(null),
    clinicBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    try {
      const prior = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
      if (prior?.auth?.token && prior?.data?.patient && Number.isInteger(prior.cursor)) {
        state.current = prior;
        setSaved(prior);
        setKind(prior.data.slug === 'showcase-solo' ? 'solo' : 'hospital');
        setConsent(true);
      }
    } catch {
      /* No saved rehearsal. */
    }
    return () => {
      mounted.current = false;
      playing.current = false;
    };
  }, []);
  useEffect(() => {
    const el = chatBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [saved?.chat.length]);
  useEffect(() => {
    const el = clinicBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [saved?.cursor]);
  function save(next: Saved) {
    state.current = next;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Presentation still works without storage. */
    }
    if (mounted.current) setSaved(next);
  }
  function patch(part: Partial<Saved>) {
    if (state.current) save({ ...state.current, ...part });
  }
  function bubble(who: string, text: string, kind: Bubble['kind']) {
    if (state.current) patch({ chat: [...state.current.chat, { who, text, kind }] });
  }
  async function request(path: string, body?: unknown) {
    const auth = state.current?.auth;
    const r = await fetch(`${API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.message ?? 'The step could not be completed.');
    return result;
  }
  async function step(name: string, body: Record<string, unknown> = {}) {
    const result = await request(`/staff/demo/journey/${state.current!.data.patient.id}/${name}`, {
      confirmed: true,
      ...body,
    });
    patch({ data: result });
    return result;
  }
  async function start() {
    if (active.current || !consent) return;
    active.current = true;
    setWorking(true);
    setError('');
    setReviewed(false);
    setFormOpen(false);
    try {
      const auth = await api('/auth/login', {
        body: {
          email: kind === 'solo' ? 'doctor@solo.demo.test' : 'kavita@hospital.demo.test',
          password: 'demo1234',
        },
      });
      const response = await fetch(`${API}/staff/demo/journey`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Demo setup failed.');
      save({ auth, data, cursor: 0, chat: [], events: [], arrivalToken: '', feedbackPath: '' });
    } catch (e: any) {
      setError(e.message);
    } finally {
      active.current = false;
      setWorking(false);
    }
  }
  async function perform() {
    const s = state.current!;
    const beat = beats[s.cursor];
    if (beat.action === 'chat') {
      const result = await step('chat', { text: beat.text });
      bubble('Patient', beat.text!, 'patient');
      bubble('Booking assistant', result.transcript[0].reply, 'assistant');
      if (result.needsStaff)
        throw new Error('The conversation needs staff review. Automatic playback has stopped.');
    } else if (beat.action === 'arrive') {
      const token =
        s.arrivalToken ||
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
      patch({ arrivalToken: token });
      await step('arrive', { accessToken: token });
      bubble(
        'Patient QR page',
        'Check-in saved. Please confirm your consultation payment with the clinic.',
        'update',
      );
    } else if (beat.action === 'payment') {
      const result = await step('payment');
      bubble(
        'Patient queue page',
        `Payment recorded for this practice visit. Your token is ${result.queue.token_number}. You are waiting to see the doctor.`,
        'update',
      );
    } else if (beat.action === 'waiting') {
      await request(`/public/${s.data.slug}/arrival/waiting-answer`, {
        accessToken: s.arrivalToken,
        answer: waitingAnswer,
      });
      patch({ data: await request(`/staff/demo/journey/${s.data.patient.id}`) });
      bubble(
        'Patient queue page',
        'What is one thing you would like to discuss with the doctor?',
        'update',
      );
      bubble('Patient', waitingAnswer, 'patient');
    } else if (beat.action === 'call') {
      const result = await step('call');
      bubble(
        'Clinic queue',
        `Token ${result.queue.token_number}: the doctor is ready to see you.`,
        'update',
      );
    } else if (beat.action === 'note') {
      await step('note', { note: noteText });
    } else if (beat.action === 'review') {
      if (!reviewed) throw new Error('Review the displayed note and instructions first.');
      if (state.current!.data.note.status !== 'signed') await step('sign');
      if (state.current!.data.instructions?.status !== 'approved') await step('instructions');
    } else if (beat.action === 'finish') {
      const result = await step('finish');
      bubble(
        'Clinic workflow',
        `Visit completed. Feedback scheduled for ${date(result.feedback.scheduled_at)}.`,
        'update',
      );
    } else if (beat.action === 'invite') {
      const result = await step('feedback-link');
      patch({ feedbackPath: result.path });
      bubble(
        'WhatsApp invitation · preview only',
        'How are you feeling after your visit? Tell us about your experience and what we could improve. Your private feedback form is ready.',
        'preview',
      );
    } else if (beat.action === 'response') {
      const token = s.feedbackPath.split('#')[1];
      if (!token) throw new Error('Prepare the private feedback form first.');
      await request(`/public/${s.data.slug}/feedback/response`, {
        token,
        recovery: 'callback',
        help: 'next_steps',
        theme: 'explanation',
        message: 'DEMO: I would like the clinic to contact me.',
        experience: 'poor',
        suggestion,
      });
      patch({ data: await request(`/staff/demo/journey/${s.data.patient.id}`) });
      bubble(
        'Patient feedback form',
        'Please contact me. My visit needs improvement. ' + suggestion,
        'patient',
      );
    } else if (beat.action === 'handoff') {
      await step('handoff');
      bubble(
        'Clinic work list',
        'The feedback has been assigned to the doctor for follow-up. It is awaiting a person’s response.',
        'update',
      );
    }
    patch({
      cursor: s.cursor + 1,
      events: [...state.current!.events, { title: beat.title, who: beat.who }],
    });
  }
  async function advance(auto: boolean, approve = false) {
    if (active.current || !state.current || state.current.cursor >= beats.length || error) return;
    if (beats[state.current.cursor].action === 'review' && (!approve || !reviewed)) return;
    active.current = true;
    playing.current = auto;
    setWorking(true);
    setRunning(auto);
    try {
      do {
        await perform();
        if (
          !playing.current ||
          !mounted.current ||
          state.current!.cursor >= beats.length ||
          beats[state.current!.cursor].action === 'review'
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, Number(speed)));
      } while (playing.current && mounted.current);
    } catch (e: any) {
      if (mounted.current) setError(e.message + ' No further steps were run.');
    } finally {
      active.current = false;
      playing.current = false;
      if (mounted.current) {
        setWorking(false);
        setRunning(false);
      }
    }
  }
  function pause() {
    playing.current = false;
    setRunning(false);
  }
  const data = saved?.data,
    cursor = saved?.cursor ?? 0,
    complete = cursor >= beats.length,
    beat = beats[Math.min(cursor, beats.length - 1)],
    review = !!saved && !complete && beat.action === 'review';
  const completedPhase = complete ? phases.length : beat.phase;
  return (
    <main className={`${css.page} ${saved ? css.active : ''}`}>
      <header className={css.header}>
        <Link href="/demo">
          ✚ Sahayak <span>Doctor demonstration</span>
        </Link>
        <div className={css.headerActions}>
          <span className={css.badge}>FICTIONAL PATIENT · PRACTICE ONLY</span>
          <button
            className="ghost"
            onClick={() => {
              if (!document.fullscreenElement)
                void document.documentElement.requestFullscreen?.().catch(() => {});
              else void document.exitFullscreen?.();
            }}
          >
            Full screen
          </button>
        </div>
      </header>
      <section className={css.intro}>
        <div>
          <p className={css.eyebrow}>ONE PATIENT. ONE CONNECTED CLINIC.</p>
          <h1>From “Hello” to a caring follow-up.</h1>
          <p>Watch the patient conversation and the clinic move forward together.</p>
        </div>
        <div className={css.setup}>
          <label>
            Clinic view
            <select
              value={kind}
              disabled={working || (!!saved && !complete)}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="solo">Single doctor</option>
              <option value="hospital">Clinic or small hospital</option>
            </select>
          </label>
          <button
            onClick={() => void start()}
            disabled={
              !consent || working || (!!data?.queue && data.queue.status === 'in_consultation')
            }
          >
            {saved ? 'Start a new patient' : 'Prepare the demo'}
          </button>
        </div>
      </section>
      {!saved && (
        <label className={css.consent}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Use fictional consent, a practice cash payment and a sample feedback response. No real
          message, call or payment will be made.
        </label>
      )}
      <details className={css.about}>
        <summary>What this demonstration does</summary>
        <p>
          It saves an actual booking, arrival, queue entry, note and feedback in a fictional clinic.
          Chat uses Sahayak’s booking rules. Messages shown here are practice messages; the feedback
          invitation is a preview. No medicine or diagnosis is generated. Your current clinic login
          stays unchanged.
        </p>
        <p>
          Starting enables next-day feedback and evening opening hours in this fictional clinic.
          Calling the demo patient puts other waiting practice patients on hold. An active
          consultation is never silently closed.
        </p>
      </details>
      <nav className={css.rail} aria-label="Visit progress">
        {phases.map((p, i) => (
          <div
            key={p}
            className={
              i < completedPhase ? css.finished : i === completedPhase ? css.current : css.pending
            }
            aria-current={i === completedPhase ? 'step' : undefined}
          >
            <span>{i < completedPhase ? '✓' : i + 1}</span>
            {p}
          </div>
        ))}
      </nav>
      {error && (
        <p role="alert" className={css.error}>
          {error} Your completed steps are saved.{' '}
          <Link href="/demo/journey">Open the detailed walkthrough</Link>.
        </p>
      )}
      <section className={css.storyHeading}>
        <div>
          <span className={css.actor}>{complete ? 'VISIT JOURNEY COMPLETE' : beat.who}</span>
          <h2>
            {complete
              ? 'The doctor can see what needs attention.'
              : saved
                ? beat.title
                : 'A patient needs an appointment.'}
          </h2>
          <p>
            {complete
              ? 'The same patient is linked from the first message to the follow-up task.'
              : beat.why}
          </p>
        </div>
        <span className={css.count}>
          {complete ? '17 / 17' : `${cursor} / ${beats.length}`} steps saved
        </span>
      </section>
      <div className={css.stage}>
        <section className={css.phone} aria-label="Patient view">
          <div className={css.phoneHead}>
            <div className={css.avatar}>P</div>
            <div>
              <strong>Patient’s view</strong>
              <small>Practice chat & patient pages</small>
            </div>
            <span className={css.dot} />
          </div>
          <div className={css.messages} ref={chatBox} aria-live="polite">
            {!saved?.chat.length ? (
              <div className={css.empty}>
                <span>“Hello”</span>
                <h3>It starts with one message.</h3>
                <p>Press Play to follow the patient through the clinic.</p>
              </div>
            ) : (
              saved.chat.map((b, i) => (
                <div key={i} className={`${css.bubble} ${css[b.kind]}`}>
                  <small>{b.who}</small>
                  <p>{b.text}</p>
                </div>
              ))
            )}
            {working && <span className={css.typing}>Updating the visit…</span>}
          </div>
          <div className={css.phoneFoot}>No message is being sent to a real phone.</div>
        </section>
        <section className={css.clinic} aria-label="Clinic view">
          <header className={css.clinicHead}>
            <div>
              <span className={css.eyebrow}>WHAT THE CLINIC SEES</span>
              <h2>{kind === 'solo' ? 'The doctor’s desk' : 'The clinic team’s desk'}</h2>
            </div>
            <span className={css.savedBadge}>
              {data ? 'Saved in practice clinic' : 'Ready to begin'}
            </span>
          </header>
          <div className={css.metrics}>
            <div>
              <span>Appointment</span>
              <strong>
                {data?.appointment
                  ? data.appointment.status === 'completed'
                    ? 'Completed'
                    : date(data.appointment.starts_at)
                  : 'Not booked yet'}
              </strong>
            </div>
            <div>
              <span>Queue</span>
              <strong>{data?.queue ? `Token ${data.queue.token_number}` : 'Not checked in'}</strong>
              <small>
                {data?.queue
                  ? ((
                      {
                        waiting: 'Waiting',
                        in_consultation: 'With the doctor',
                        done: 'Visit finished',
                      } as any
                    )[data.queue.status] ?? data.queue.status)
                  : 'Appears after arrival'}
              </small>
            </div>
            <div>
              <span>Feedback</span>
              <strong>
                {data?.feedback?.work_status === 'assigned'
                  ? 'Doctor follow-up'
                  : data?.response
                    ? 'Response received'
                    : data?.feedback
                      ? 'Scheduled'
                      : 'After the visit'}
              </strong>
            </div>
          </div>
          <div className={css.records} ref={clinicBox}>
            {data?.arrival && (
              <div className={css.record}>
                <span className={css.recordIcon}>✓</span>
                <div>
                  <strong>Arrival & payment</strong>
                  <p>
                    {data.arrival.status === 'queued'
                      ? `Practice cash recorded · ₹${data.arrival.amount_paise / 100} · token issued`
                      : 'QR check-in received · awaiting payment confirmation'}
                  </p>
                </div>
              </div>
            )}
            {data?.arrival?.waiting_answer && (
              <div className={css.record}>
                <span className={css.recordIcon}>≡</span>
                <div>
                  <strong>For the doctor, before the visit</strong>
                  <p>{data.arrival.waiting_answer}</p>
                  <small>Source: patient’s waiting-page answer</small>
                </div>
              </div>
            )}
            {data?.note && (
              <div className={`${css.note} ${review ? css.reviewNote : ''}`}>
                <div className={css.noteHeader}>
                  <h3>
                    {data.note.status === 'signed'
                      ? 'Signed consultation note'
                      : 'Doctor’s draft — review needed'}
                  </h3>
                  <span>{data.note.status === 'signed' ? '✓ Signed' : 'Draft'}</span>
                </div>
                <p>{data.note.note.history}</p>
                <p>
                  <strong>Instructions:</strong> {data.note.note.instructions}
                </p>
                <p>
                  <strong>Follow-up:</strong> {data.note.note.follow_up}
                </p>
                <small>Examination, diagnosis and medicines remain blank.</small>
                {review && (
                  <label className={css.reviewCheck}>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I have reviewed this fictional note and the displayed instructions.
                  </label>
                )}
              </div>
            )}
            {data?.feedback && (
              <div className={css.record}>
                <span className={css.recordIcon}>↗</span>
                <div>
                  <strong>
                    {data.response
                      ? 'Patient feedback is in the clinic'
                      : 'Feedback scheduled automatically'}
                  </strong>
                  <p>
                    {data.response ? data.response.suggestion : date(data.feedback.scheduled_at)}
                  </p>
                  <small>
                    {data.response
                      ? 'Patient requested contact · needs clarification'
                      : 'Triggered by Finish visit · doctor’s saved preference'}
                  </small>
                </div>
              </div>
            )}
            {complete && (
              <div className={css.result}>
                <strong>Assigned to the doctor — awaiting follow-up</strong>
                <p>
                  The clinic now has a chance to clarify the next steps and respond to the patient’s
                  experience.
                </p>
                <button
                  className="ghost"
                  onClick={() => {
                    session.set(saved!.auth);
                    location.href = '/doctor/checkins';
                  }}
                >
                  Open this practice clinic’s feedback
                </button>
              </div>
            )}
            {!data?.arrival && !data?.note && (
              <div className={css.clinicEmpty}>
                <h3>
                  {data?.appointment
                    ? 'The booking is now visible.'
                    : 'No one needs to enter the booking twice.'}
                </h3>
                <p>
                  {data?.appointment
                    ? 'This patient will join the queue when they arrive and check in.'
                    : 'The appointment card updates when the patient confirms a time in the conversation.'}
                </p>
                {data?.appointment && (
                  <span className={css.savedBadge}>Booking source: practice WhatsApp chat</span>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
      <footer className={css.controls}>
        <div>
          <strong>
            {review
              ? 'Your approval is needed'
              : complete
                ? 'Ready to show the saved records'
                : working
                  ? 'Playing the clinic story…'
                  : 'You control the pace'}
          </strong>
          <small>
            {review
              ? 'Nothing is signed until you approve.'
              : complete
                ? 'Replay with a new fictional patient whenever you need.'
                : 'Pause to explain a step, or move forward one step at a time.'}
          </small>
        </div>
        <div className={css.buttons}>
          <label>
            Speed
            <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
              <option value="2000">Presentation</option>
              <option value="4000">Slow</option>
              <option value="250">Quick rehearsal</option>
            </select>
          </label>
          {review ? (
            <button
              disabled={!reviewed || working || !!error}
              onClick={() => void advance(true, true)}
            >
              Approve practice note & continue
            </button>
          ) : (
            <>
              <button
                disabled={!saved || complete || !!error || (working && !running)}
                onClick={() => (running ? pause() : void advance(true))}
              >
                {running ? 'Pause' : 'Play demo'}
              </button>
              <button
                className="ghost"
                disabled={!saved || working || complete || !!error}
                onClick={() => void advance(false)}
              >
                Next step →
              </button>
            </>
          )}
          {saved?.feedbackPath && (
            <button className="ghost" onClick={() => setFormOpen(!formOpen)}>
              Patient feedback form
            </button>
          )}
        </div>
      </footer>
      {formOpen && saved?.feedbackPath && (
        <section className={css.form}>
          <h2>The actual patient feedback form</h2>
          <p>
            The playback uses a labelled sample response. This private form shows what the patient
            can open.
          </p>
          <iframe title="Patient feedback form" src={saved.feedbackPath} />
        </section>
      )}
      <details className={css.log}>
        <summary>Show the saved activity ({saved?.events.length ?? 0} steps)</summary>
        <ol>
          {saved?.events.map((event, i) => (
            <li key={i}>
              <span>✓</span>
              <div>
                <strong>{event.title}</strong>
                <small>{event.who}</small>
              </div>
            </li>
          ))}
        </ol>
      </details>
      <div className={css.next}>
        <div>
          <h3>Show the connected story in about 3 minutes.</h3>
          <p>
            Message → booking → QR arrival → payment & queue → doctor review → feedback → human
            follow-up.
          </p>
        </div>
        <Link href="/demo/journey">Open the detailed, manual walkthrough →</Link>
      </div>
    </main>
  );
}
