'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../lib/api';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const PRESET = {
  mon: '09:00-13:00, 17:00-20:00',
  tue: '09:00-13:00, 17:00-20:00',
  wed: '09:00-13:00, 17:00-20:00',
  thu: '09:00-13:00, 17:00-20:00',
  fri: '09:00-13:00, 17:00-20:00',
  sat: '09:00-13:00',
  sun: '',
};
const INTAKE = [
  {
    id: 'reason',
    en: 'What is the main reason for your visit today?',
    hi: 'आज आपकी विज़िट का मुख्य कारण क्या है?',
  },
  { id: 'duration', en: 'How long have you had this problem?', hi: 'यह समस्या कब से है?' },
  {
    id: 'medicines',
    en: 'Are you taking any medicines right now?',
    hi: 'क्या आप अभी कोई दवा ले रहे हैं?',
  },
  { id: 'allergies', en: 'Do you have any known allergies?', hi: 'क्या आपको कोई एलर्जी है?' },
  {
    id: 'conditions',
    en: 'Do you have any long-term conditions, such as diabetes or blood pressure?',
    hi: 'क्या आपको कोई लंबे समय की बीमारी है, जैसे शुगर या ब्लड प्रेशर?',
  },
];
const FAQS = [
  {
    id: 'parking',
    keywords: ['parking', 'park', 'पार्किंग'],
    en: 'Parking is available near the clinic entrance.',
    hi: 'क्लिनिक के प्रवेश के पास पार्किंग उपलब्ध है।',
  },
  {
    id: 'languages',
    keywords: ['language', 'languages', 'भाषा'],
    en: 'The doctor speaks Hindi, English and Punjabi.',
    hi: 'डॉक्टर हिन्दी, अंग्रेज़ी और पंजाबी बोलते हैं।',
  },
  {
    id: 'homevisit',
    keywords: ['home visit', 'ghar', 'घर'],
    en: 'Home visits are not available. Please visit the clinic.',
    hi: 'घर पर विज़िट उपलब्ध नहीं है। कृपया क्लिनिक आएँ।',
  },
  {
    id: 'insurance',
    keywords: ['insurance', 'cashless', 'बीमा'],
    en: 'Please ask the receptionist about insurance.',
    hi: 'बीमा के बारे में कृपया रिसेप्शनिस्ट से पूछें।',
  },
];
const STEPS = ['Clinic', 'Hours', 'Doctors', 'Team', 'Questions', 'Try it', 'Go live'];
const genPassword = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31],
  ).join('');

/** Guided setup: seven short steps from a new account to a clinic that is ready for patients. */
export default function Setup() {
  const s = useSession('doctor');
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState<any>(null),
    [status, setStatus] = useState<any>(null),
    [docs, setDocs] = useState<any[]>([]),
    [team, setTeam] = useState<any[]>([]);
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const [nd, setNd] = useState({ name: '', speciality: '', slotMinutes: 15, whatsappNumber: '' });
  const [nr, setNr] = useState({ name: '', email: '', password: '' });
  const [intake, setIntake] = useState<Record<string, boolean>>({});
  const [faq, setFaq] = useState<Record<string, { on: boolean; en: string; hi: string }>>({});
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const [c, st, d, t] = await Promise.all([
      staff('/staff/settings'),
      staff('/staff/setup'),
      staff('/staff/doctors/all'),
      staff('/staff/team'),
    ]);
    setCfg(c);
    setStatus(st);
    setDocs(d);
    setTeam(t.staff);
    setIntake((cur) =>
      Object.keys(cur).length
        ? cur
        : Object.fromEntries(
            INTAKE.map((q) => [q.id, c.intakeQuestions.some((x: any) => x.id === q.id)]),
          ),
    );
    setFaq((cur) =>
      Object.keys(cur).length
        ? cur
        : Object.fromEntries(
            FAQS.map((f) => {
              const ex = c.faqs.find((x: any) => x.id === f.id);
              return [f.id, { on: !!ex, en: ex?.en ?? f.en, hi: ex?.hi ?? f.hi }];
            }),
          ),
    );
  }, []);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s, load]);
  if (!s || !cfg || !status) return null;

  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });
  const go = async (fn?: () => Promise<unknown>, next = step + 1) => {
    setErr('');
    setMsg('');
    try {
      if (fn) await fn();
      await load();
      setStep(next);
      window.scrollTo(0, 0);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const put = (body: object) => staff('/staff/settings', body, 'PUT');
  const item = (id: string) => status.items.find((i: any) => i.id === id);
  const origin = typeof location !== 'undefined' ? location.origin : '';

  return (
    <div>
      <div className="topbar">
        <b>Set up {cfg.clinicName}</b>
        <a href="/doctor">Skip for now</a>
      </div>
      <div className="wrap" style={{ maxWidth: 720 }}>
        <ol
          style={{ display: 'flex', gap: 6, padding: 0, listStyle: 'none', flexWrap: 'wrap' }}
          aria-label="Progress"
        >
          {STEPS.map((n, i) => (
            <li key={n}>
              <button
                className={i === step ? '' : 'ghost'}
                style={{ padding: '.3rem .7rem', fontSize: '.85rem' }}
                onClick={() => setStep(i)}
                aria-current={i === step ? 'step' : undefined}
              >
                {i + 1}. {n}
              </button>
            </li>
          ))}
        </ol>
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

        {step === 0 && (
          <div className="card">
            <h2>About your clinic</h2>
            <p className="muted">
              Patients ask for these most. The assistant answers only from what you enter here.
            </p>
            <label htmlFor="n">Clinic name</label>
            <input
              id="n"
              value={cfg.clinicName}
              onChange={(e) => set('clinicName', e.target.value)}
            />
            <label htmlFor="a">Address</label>
            <input
              id="a"
              value={cfg.address ?? ''}
              onChange={(e) => set('address', e.target.value)}
            />
            <label htmlFor="d">Directions (landmarks, parking)</label>
            <input
              id="d"
              value={cfg.directions ?? ''}
              onChange={(e) => set('directions', e.target.value)}
            />
            <label htmlFor="p">Clinic phone</label>
            <input
              id="p"
              value={cfg.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+911612345678"
            />
            <p>
              <button
                onClick={() =>
                  go(() =>
                    put({
                      clinicName: cfg.clinicName,
                      address: cfg.address ?? '',
                      directions: cfg.directions ?? '',
                      phone: cfg.phone ?? '',
                    }),
                  )
                }
              >
                Save and continue
              </button>
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="card">
            <h2>Opening hours</h2>
            <p className="muted">
              Used to offer appointment slots. Write times like 09:00-13:00, 17:00-20:00. Leave a
              day empty if closed.
            </p>
            <button className="ghost small" onClick={() => set('timings', PRESET)}>
              Use Mon-Sat 9-1 and 5-8
            </button>
            {DAYS.map((d) => (
              <div key={d} className="row" style={{ margin: '4px 0' }}>
                <span style={{ width: 40 }}>{d}</span>
                <input
                  aria-label={`Hours ${d}`}
                  value={cfg.timings?.[d] ?? ''}
                  onChange={(e) => set('timings', { ...cfg.timings, [d]: e.target.value })}
                  placeholder="Closed"
                />
              </div>
            ))}
            <label htmlFor="avg">Average time per patient (minutes)</label>
            <input
              id="avg"
              type="number"
              value={cfg.avgConsultMinutes}
              onChange={(e) => set('avgConsultMinutes', Number(e.target.value))}
            />
            <p className="muted">Used to estimate waiting time on the TV and in messages.</p>
            <p>
              <button
                onClick={() =>
                  go(() =>
                    put({
                      timings: Object.fromEntries(
                        DAYS.map((d) => [d, (cfg.timings?.[d] ?? '').trim() || 'Closed']),
                      ),
                      avgConsultMinutes: Number(cfg.avgConsultMinutes),
                    }),
                  )
                }
              >
                Save and continue
              </button>
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="card">
            <h2>Doctors</h2>
            <p className="muted">
              Each doctor can have their own WhatsApp number: patients who write to it book with
              that doctor automatically.
            </p>
            <div className="list">
              {docs.map((d) => (
                <div key={d.id} className="row between">
                  <span>
                    <b>{d.name}</b>{' '}
                    <span className="muted">
                      {d.speciality ?? ''} · {d.slot_minutes} min slots{' '}
                      {d.whatsapp_number ? `· ${d.whatsapp_number}` : ''}
                    </span>
                  </span>
                  {d.active && docs.filter((x) => x.active).length > 1 && (
                    <button
                      className="small ghost"
                      onClick={() =>
                        go(() => staff(`/staff/doctors/${d.id}`, { active: false }, 'PATCH'), 2)
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            <h3 style={{ marginTop: '1rem' }}>Add a doctor</h3>
            <input
              aria-label="Doctor name"
              placeholder="Dr. Name"
              value={nd.name}
              onChange={(e) => setNd({ ...nd, name: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <input
              aria-label="Speciality"
              placeholder="Speciality (optional)"
              value={nd.speciality}
              onChange={(e) => setNd({ ...nd, speciality: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <div className="row" style={{ marginBottom: 6 }}>
              <label htmlFor="sl" style={{ margin: 0 }}>
                Slot minutes
              </label>
              <input
                id="sl"
                type="number"
                value={nd.slotMinutes}
                onChange={(e) => setNd({ ...nd, slotMinutes: Number(e.target.value) })}
                style={{ width: 90 }}
              />
            </div>
            <input
              aria-label="Doctor WhatsApp number"
              placeholder="WhatsApp number, e.g. +919876543210 (optional)"
              value={nd.whatsappNumber}
              onChange={(e) => setNd({ ...nd, whatsappNumber: e.target.value })}
            />
            <p className="row">
              <button
                className="ghost"
                disabled={!nd.name.trim()}
                onClick={() =>
                  go(async () => {
                    await staff('/staff/doctors', {
                      name: nd.name,
                      speciality: nd.speciality || undefined,
                      slotMinutes: nd.slotMinutes,
                      whatsappNumber: nd.whatsappNumber || undefined,
                    });
                    setNd({ name: '', speciality: '', slotMinutes: 15, whatsappNumber: '' });
                  }, 2)
                }
              >
                Add doctor
              </button>
              <button onClick={() => setStep(3)}>Continue</button>
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="card">
            <h2>Your receptionist</h2>
            <p className="muted">
              Create a login for the person who supervises the assistant. Tell them the temporary
              password in person and ask them to keep it private.
            </p>
            <div className="list">
              {team.map((m) => (
                <div key={m.id} className="row between">
                  <span>
                    <b>{m.name}</b> <span className="tag">{m.role}</span>{' '}
                    <span className="muted">{m.email}</span>
                  </span>
                </div>
              ))}
            </div>
            {created && (
              <div
                className="card"
                style={{ background: '#fffbeb', margin: '8px 0' }}
                role="status"
                data-testid="created-login"
              >
                <b>Share these with {created.email} now. The password is not shown again.</b>
                <div style={{ fontFamily: 'monospace' }}>
                  {created.email} / {created.password}
                </div>
              </div>
            )}
            <h3 style={{ marginTop: '1rem' }}>Add a receptionist</h3>
            <input
              aria-label="Receptionist name"
              placeholder="Name"
              value={nr.name}
              onChange={(e) => setNr({ ...nr, name: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <input
              aria-label="Receptionist email"
              type="email"
              placeholder="Email"
              value={nr.email}
              onChange={(e) => setNr({ ...nr, email: e.target.value })}
              style={{ marginBottom: 6 }}
            />
            <div className="row">
              <input
                aria-label="Temporary password"
                placeholder="Temporary password (10+ characters)"
                value={nr.password}
                onChange={(e) => setNr({ ...nr, password: e.target.value })}
              />
              <button
                className="ghost"
                type="button"
                onClick={() => setNr({ ...nr, password: genPassword() })}
              >
                Generate
              </button>
            </div>
            <p className="row">
              <button
                className="ghost"
                disabled={!nr.name || !nr.email || nr.password.length < 10}
                onClick={() =>
                  go(async () => {
                    await staff('/staff/team', {
                      name: nr.name,
                      email: nr.email,
                      role: 'receptionist',
                      password: nr.password,
                    });
                    setCreated({ email: nr.email, password: nr.password });
                    setNr({ name: '', email: '', password: '' });
                  }, 3)
                }
              >
                Create login
              </button>
              <button onClick={() => setStep(4)}>Continue</button>
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="card">
            <h2>Questions and answers</h2>
            <h3>Intake questions</h3>
            <p className="muted">
              Asked on WhatsApp while the patient waits; the doctor sees a short summary. Questions
              only: the assistant never gives advice.
            </p>
            {INTAKE.map((q) => (
              <label key={q.id} className="check">
                <input
                  type="checkbox"
                  checked={!!intake[q.id]}
                  onChange={(e) => setIntake({ ...intake, [q.id]: e.target.checked })}
                />
                <span>
                  {q.en}
                  <br />
                  <span className="muted">{q.hi}</span>
                </span>
              </label>
            ))}
            <h3 style={{ marginTop: '1rem' }}>Common questions</h3>
            <p className="muted">
              When a patient's message contains the keyword, the assistant sends your answer. Edit
              the wording to match your clinic.
            </p>
            {FAQS.map((f) => (
              <div key={f.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={faq[f.id]?.on ?? false}
                    onChange={(e) =>
                      setFaq({ ...faq, [f.id]: { ...faq[f.id], on: e.target.checked } })
                    }
                  />
                  Answer questions about "{f.keywords[0]}"
                </label>
                {faq[f.id]?.on && (
                  <>
                    <input
                      aria-label={`${f.id} answer English`}
                      value={faq[f.id].en}
                      onChange={(e) =>
                        setFaq({ ...faq, [f.id]: { ...faq[f.id], en: e.target.value } })
                      }
                      style={{ marginBottom: 4 }}
                    />
                    <input
                      aria-label={`${f.id} answer Hindi`}
                      value={faq[f.id].hi}
                      onChange={(e) =>
                        setFaq({ ...faq, [f.id]: { ...faq[f.id], hi: e.target.value } })
                      }
                    />
                  </>
                )}
              </div>
            ))}
            <p>
              <button
                onClick={() =>
                  go(() =>
                    put({
                      intakeQuestions: INTAKE.filter((q) => intake[q.id]),
                      faqs: FAQS.filter((f) => faq[f.id]?.on).map((f) => ({
                        id: f.id,
                        keywords: f.keywords,
                        en: faq[f.id].en,
                        hi: faq[f.id].hi,
                      })),
                    }),
                  )
                }
              >
                Save and continue
              </button>
            </p>
          </div>
        )}

        {step === 5 && (
          <div className="card">
            <h2>Try it</h2>
            <p className="muted">
              Open the WhatsApp simulator and chat as a patient. Try "what are your timings", "I
              need an appointment tomorrow evening", and a Hindi message.
            </p>
            <p className="row">
              <a href={`${origin}/c/${status.slug}/sim`} target="_blank" rel="noreferrer">
                <button type="button">Open WhatsApp simulator</button>
              </a>
              <a href={`${origin}/c/${status.slug}/checkin`} target="_blank" rel="noreferrer">
                <button type="button" className="ghost">
                  Open patient check-in page
                </button>
              </a>
            </p>
            <p className="muted">
              The simulator stands in for WhatsApp until a real WhatsApp Business number is
              connected to your account by your Sahayak administrator.
            </p>
            <p>
              <button className="ghost" onClick={() => go(undefined, 5)}>
                I tried it: refresh checklist
              </button>{' '}
              <button onClick={() => setStep(6)}>Continue</button>
            </p>
            <p>{item('tested')?.ok ? '✓ A test chat was received' : 'No test chat yet'}</p>
          </div>
        )}

        {step === 6 && (
          <div className="card">
            <h2>Ready to go live</h2>
            <div className="list" data-testid="checklist">
              {status.items.map((i: any) => (
                <div key={i.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <span
                    aria-label={i.ok ? 'done' : 'not done'}
                    style={{
                      color: i.ok ? 'var(--ok)' : i.required ? 'var(--danger)' : 'var(--warn)',
                      fontWeight: 800,
                    }}
                  >
                    {i.ok ? '✓' : i.required ? '!' : '•'}
                  </span>
                  <span>
                    {i.label}
                    {!i.required && <span className="muted"> (optional)</span>}
                    {!i.ok && i.hint && <div className="muted">{i.hint}</div>}
                  </span>
                </div>
              ))}
            </div>
            {status.completed ? (
              <div role="status">
                <h3 style={{ color: 'var(--ok)' }}>Your clinic is live.</h3>
                <p className="row" style={{ flexWrap: 'wrap' }}>
                  <a href={`/c/${status.slug}/poster`} target="_blank" rel="noreferrer">
                    <button type="button">Print the check-in QR poster</button>
                  </a>
                  <a href={`/c/${status.slug}/tv`} target="_blank" rel="noreferrer">
                    <button type="button" className="ghost">
                      Open the waiting-room TV
                    </button>
                  </a>
                  <a href="/doctor">
                    <button type="button" className="ghost">
                      Go to the doctor screen
                    </button>
                  </a>
                </p>
              </div>
            ) : (
              <p>
                <button
                  disabled={!status.readyToFinish}
                  onClick={() =>
                    go(async () => {
                      await staff('/staff/setup/complete', {});
                      setMsg('Setup complete');
                    }, 6)
                  }
                >
                  Finish setup
                </button>
                {!status.readyToFinish && (
                  <span className="muted"> Finish the items marked ! first.</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
