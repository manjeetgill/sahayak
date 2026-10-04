'use client';
import { useEffect, useState } from 'react';
import { AGENT_NAMES } from '@sahayak/shared';
import { staff, useSession } from '../../../lib/api';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const AGENT_LABEL: Record<string, string> = {
  checkin: 'Check-in',
  queue: 'Queue',
  intake: 'Intake questions',
  front_desk: 'WhatsApp front desk',
  schedule: 'Running-late handling',
  followup: 'Follow-ups',
  leads: 'New enquiries',
  records: 'Records',
};

/** Agent builder: the doctor decides how the front-desk agents behave. Safety rules are not configurable here. */
export default function Settings() {
  const s = useSession('doctor');
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState(''),
    [err, setErr] = useState('');
  const [phrase, setPhrase] = useState('');
  const load = () => staff('/staff/settings').then(setCfg);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s]);
  if (!s || !cfg) return null;
  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });
  const save = async (keys: string[]) => {
    setErr('');
    setMsg('');
    const body: any = {};
    for (const k of keys) body[k] = k === 'avgConsultMinutes' ? Number(cfg[k]) : cfg[k];
    if (body.followupRules)
      body.followupRules = Object.fromEntries(
        Object.entries(body.followupRules).map(([a, b]) => [a, Number(b)]),
      );
    if (body.timings)
      body.timings = Object.fromEntries(DAYS.map((d) => [d, body.timings[d] || 'Closed']));
    try {
      await staff('/staff/settings', body, 'PUT');
      setMsg('Saved');
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const fr = cfg.followupRules;
  return (
    <div>
      <div className="topbar">
        <b>Agent builder</b>
        <a href="/doctor">← Back to doctor screen</a>
      </div>
      <div className="wrap" style={{ maxWidth: 760 }}>
        {msg && (
          <div role="status" style={{ color: 'var(--ok)', fontWeight: 700 }}>
            {msg}
          </div>
        )}
        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}

        <div className="card">
          <h2>Clinic information</h2>
          <p className="muted">Agents answer patients only from this information.</p>
          <label htmlFor="addr">Address</label>
          <input
            id="addr"
            value={cfg.address ?? ''}
            onChange={(e) => set('address', e.target.value)}
          />
          <label htmlFor="dir">Directions</label>
          <input
            id="dir"
            value={cfg.directions ?? ''}
            onChange={(e) => set('directions', e.target.value)}
          />
          <label htmlFor="ph">Clinic phone</label>
          <input id="ph" value={cfg.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <label htmlFor="avg">Average consultation (minutes)</label>
          <input
            id="avg"
            type="number"
            value={cfg.avgConsultMinutes}
            onChange={(e) => set('avgConsultMinutes', e.target.value)}
          />
          <h3 style={{ marginTop: '1rem' }}>Timings</h3>
          {DAYS.map((d) => (
            <div key={d} className="row" style={{ margin: '4px 0' }}>
              <span style={{ width: 40 }}>{d}</span>
              <input
                aria-label={`Timings ${d}`}
                placeholder="09:00-13:00, 17:00-20:00 or Closed"
                value={cfg.timings?.[d] ?? ''}
                onChange={(e) => set('timings', { ...cfg.timings, [d]: e.target.value })}
              />
            </div>
          ))}
          <p>
            <button
              onClick={() =>
                save(['address', 'directions', 'phone', 'avgConsultMinutes', 'timings'])
              }
            >
              Save clinic information
            </button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Intake questions</h2>
          <p className="muted">
            Asked on WhatsApp while the patient waits. Both languages required. Questions only:
            agents never give advice.
          </p>
          {cfg.intakeQuestions.map((q: any, i: number) => (
            <div key={i} className="row" style={{ margin: '4px 0' }}>
              <input
                aria-label={`Question ${i + 1} English`}
                value={q.en}
                onChange={(e) =>
                  set(
                    'intakeQuestions',
                    cfg.intakeQuestions.map((x: any, j: number) =>
                      j === i ? { ...x, en: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`Question ${i + 1} Hindi`}
                value={q.hi}
                onChange={(e) =>
                  set(
                    'intakeQuestions',
                    cfg.intakeQuestions.map((x: any, j: number) =>
                      j === i ? { ...x, hi: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                className="small ghost"
                onClick={() =>
                  set(
                    'intakeQuestions',
                    cfg.intakeQuestions.filter((_: any, j: number) => j !== i),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <p className="row">
            <button
              className="ghost"
              onClick={() =>
                set('intakeQuestions', [
                  ...cfg.intakeQuestions,
                  { id: `q${Date.now() % 100000}`, en: '', hi: '' },
                ])
              }
            >
              Add question
            </button>
            <button onClick={() => save(['intakeQuestions'])}>Save questions</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Answers to common questions (FAQ)</h2>
          <p className="muted">
            When a patient message contains one of the keywords, the agent sends your answer. Clinic
            information only, no medical advice.
          </p>
          {cfg.faqs.map((f: any, i: number) => (
            <div
              key={f.id}
              style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}
            >
              <input
                aria-label={`FAQ ${i + 1} keywords`}
                placeholder="keywords, comma separated"
                value={f.keywords.join(', ')}
                onChange={(e) =>
                  set(
                    'faqs',
                    cfg.faqs.map((x: any, j: number) =>
                      j === i
                        ? {
                            ...x,
                            keywords: e.target.value
                              .split(',')
                              .map((k) => k.trim())
                              .filter(Boolean),
                          }
                        : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`FAQ ${i + 1} answer English`}
                placeholder="Answer (English)"
                value={f.en}
                onChange={(e) =>
                  set(
                    'faqs',
                    cfg.faqs.map((x: any, j: number) =>
                      j === i ? { ...x, en: e.target.value } : x,
                    ),
                  )
                }
                style={{ marginTop: 4 }}
              />
              <input
                aria-label={`FAQ ${i + 1} answer Hindi`}
                placeholder="उत्तर (हिन्दी)"
                value={f.hi}
                onChange={(e) =>
                  set(
                    'faqs',
                    cfg.faqs.map((x: any, j: number) =>
                      j === i ? { ...x, hi: e.target.value } : x,
                    ),
                  )
                }
                style={{ marginTop: 4 }}
              />
              <button
                className="small ghost"
                onClick={() =>
                  set(
                    'faqs',
                    cfg.faqs.filter((_: any, j: number) => j !== i),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <p className="row">
            <button
              className="ghost"
              onClick={() =>
                set('faqs', [
                  ...cfg.faqs,
                  { id: `faq${Date.now() % 100000}`, keywords: [], en: '', hi: '' },
                ])
              }
            >
              Add FAQ
            </button>
            <button onClick={() => save(['faqs'])}>Save FAQs</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Follow-ups</h2>
          <label htmlFor="r1">Appointment reminder: hours before</label>
          <input
            id="r1"
            type="number"
            value={fr.reminder_hours_before}
            onChange={(e) => set('followupRules', { ...fr, reminder_hours_before: e.target.value })}
          />
          <label htmlFor="r2">Post-visit check-in: hours after the visit</label>
          <input
            id="r2"
            type="number"
            value={fr.post_visit_hours}
            onChange={(e) => set('followupRules', { ...fr, post_visit_hours: e.target.value })}
          />
          <label htmlFor="r3">Review recall: days since last visit</label>
          <input
            id="r3"
            type="number"
            value={fr.recall_days}
            onChange={(e) => set('followupRules', { ...fr, recall_days: e.target.value })}
          />
          <p>
            <button onClick={() => save(['followupRules'])}>Save follow-up timing</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Your WhatsApp number</h2>
          <p className="muted">
            Patients who write to this number get appointments with you, without being asked which
            doctor.
          </p>
          <input
            aria-label="Doctor WhatsApp number"
            placeholder="+919876543210"
            value={cfg.doctorWhatsappNumber ?? ''}
            onChange={(e) => set('doctorWhatsappNumber', e.target.value)}
          />
          <p>
            <button
              onClick={() =>
                staff('/staff/settings/whatsapp', { number: cfg.doctorWhatsappNumber ?? '' }, 'PUT')
                  .then(() => setMsg('Saved'))
                  .catch((x) => setErr(x.message))
              }
            >
              Save number
            </button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Agents</h2>
          <p className="muted">
            A switched-off agent hands its chats to the receptionist. Emergency (red-flag) detection
            is always on.
          </p>
          {AGENT_NAMES.map((a) => (
            <label key={a} className="check">
              <input
                type="checkbox"
                checked={cfg.agents[a] !== false}
                onChange={(e) => set('agents', { ...cfg.agents, [a]: e.target.checked })}
              />
              {AGENT_LABEL[a]}
            </label>
          ))}
          <p>
            <button onClick={() => save(['agents'])}>Save agents</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Emergency phrases</h2>
          <p className="muted">
            A built-in list of Hindi and English emergency phrases is always active and cannot be
            removed. You can add phrases specific to your clinic.
          </p>
          <div className="list">
            {cfg.redFlagPhrases.map((p: any) => (
              <div key={p.id} className="row between">
                <span>
                  {p.phrase} <span className="tag">{p.language}</span>
                </span>
                <button
                  className="small ghost"
                  onClick={() =>
                    staff(`/staff/settings/phrases/${p.id}`, undefined, 'DELETE')
                      .then(load)
                      .catch((x) => setErr(x.message))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!phrase.trim()) return;
              staff('/staff/settings/phrases', {
                phrase,
                language: /[ऀ-ॿ]/.test(phrase) ? 'hi' : 'en',
              })
                .then(() => {
                  setPhrase('');
                  load();
                })
                .catch((x) => setErr(x.message));
            }}
          >
            <input
              aria-label="New emergency phrase"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="e.g. bee sting swelling"
            />
            <button type="submit">Add phrase</button>
          </form>
        </div>
      </div>
    </div>
  );
}
