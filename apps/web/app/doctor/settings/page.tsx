'use client';
import { useEffect, useState } from 'react';
import { session, staff, useSession } from '../../../lib/api';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Agent builder: the doctor decides how the front-desk agents behave. Safety rules are not configurable here. */
export default function Settings() {
  const s = useSession('doctor');
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState(''),
    [err, setErr] = useState('');
  const [phrase, setPhrase] = useState('');
  const [prof, setProf] = useState({ registrationNo: '', qualifications: '' });
  const load = () => staff('/staff/settings').then(setCfg);
  useEffect(() => {
    if (s) {
      load().catch((e) => setErr(e.message));
      staff('/staff/doctors/all')
        .then((d: any[]) => {
          const me = d.find((x) => x.id === session.get()?.user.doctorId);
          if (me)
            setProf({
              registrationNo: me.registration_no ?? '',
              qualifications: me.qualifications ?? '',
            });
        })
        .catch(() => {});
    }
  }, [s]);
  if (!s || !cfg) return null;
  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });
  const save = async (keys: string[]) => {
    setErr('');
    setMsg('');
    const body: any = {};
    for (const k of keys) body[k] = k === 'avgConsultMinutes' ? Number(cfg[k]) : cfg[k];
    if (body.retentionRules)
      body.retentionRules = Object.fromEntries(
        Object.entries(body.retentionRules).map(([a, b]) => [a, Number(b)]),
      );
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
        <b>Clinic settings</b>
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
          <p className="muted">The clinic assistant uses these details when answering patients.</p>
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
          <h2>Before-visit questions</h2>
          <p className="muted">
            Asked on WhatsApp while the patient waits. Both languages required. Questions only:
            the assistant never gives medical advice.
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
            When a patient message contains one of the keywords, the assistant sends your answer. Clinic
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
          <h2>Patient feedback and public page</h2>
          <p className="muted">
            After a visit the assistant asks the patient to rate it from 1 to 5 (only patients who
            agreed to follow-up messages). Everyone who rates is offered your review link; low
            ratings alert the receptionist so you can reach out personally.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={cfg.reputation?.enabled === true}
              onChange={(e) => set('reputation', { ...cfg.reputation, enabled: e.target.checked })}
            />
            Ask for feedback after visits
          </label>
          <label htmlFor="rurl">Your Google review link (optional)</label>
          <input
            id="rurl"
            value={cfg.reputation?.review_url ?? ''}
            onChange={(e) => set('reputation', { ...cfg.reputation, review_url: e.target.value })}
            placeholder="https://g.page/r/..."
          />
          <label htmlFor="rdel">Ask this many hours after the visit</label>
          <input
            id="rdel"
            type="number"
            value={cfg.reputation?.delay_hours ?? 3}
            onChange={(e) =>
              set('reputation', { ...cfg.reputation, delay_hours: Number(e.target.value) })
            }
          />
          <label className="check">
            <input
              type="checkbox"
              checked={cfg.reputation?.show_rating === true}
              onChange={(e) =>
                set('reputation', { ...cfg.reputation, show_rating: e.target.checked })
              }
            />
            Show the average rating on my public page (needs at least 10 ratings; every rating
            counts, nothing is hidden)
          </label>
          <label htmlFor="about">About the clinic (shown on your public page)</label>
          <textarea
            id="about"
            rows={3}
            value={cfg.publicPage?.about ?? ''}
            onChange={(e) => set('publicPage', { about: e.target.value })}
          />
          <p>
            <button onClick={() => save(['reputation', 'publicPage'])}>Save</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Your professional details</h2>
          <p className="muted">
            Printed on every certificate and prescription you sign. Your medical registration number
            is required before you can sign.
          </p>
          <label htmlFor="reg">Medical registration number</label>
          <input
            id="reg"
            value={prof.registrationNo}
            onChange={(e) => setProf({ ...prof, registrationNo: e.target.value })}
            placeholder="e.g. PMC-12345"
          />
          <label htmlFor="qual">Qualifications</label>
          <input
            id="qual"
            value={prof.qualifications}
            onChange={(e) => setProf({ ...prof, qualifications: e.target.value })}
            placeholder="e.g. MBBS, MD (Medicine)"
          />
          <p>
            <button
              onClick={async () => {
                setErr('');
                setMsg('');
                try {
                  await staff(
                    `/staff/doctors/${session.get()?.user.doctorId}`,
                    {
                      registrationNo: prof.registrationNo || undefined,
                      qualifications: prof.qualifications || undefined,
                    },
                    'PATCH',
                  );
                  setMsg('Saved');
                } catch (x: any) {
                  setErr(x.message);
                }
              }}
            >
              Save professional details
            </button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Daily summary and questions on WhatsApp</h2>
          <p className="muted">
            Add your own WhatsApp number to get an end-of-day summary and to ask questions like "how
            many patients today?" by message. Only your registered number is recognised.
          </p>
          <input
            aria-label="My phone"
            placeholder="+919876543210"
            value={cfg.myPhone ?? ''}
            onChange={(e) => set('myPhone', e.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={cfg.brief?.enabled === true}
              onChange={(e) => set('brief', { ...cfg.brief, enabled: e.target.checked })}
            />
            Send the daily summary
          </label>
          <label htmlFor="bt">Send it at (clinic time)</label>
          <input
            id="bt"
            type="time"
            value={cfg.brief?.time ?? '20:00'}
            onChange={(e) => set('brief', { ...cfg.brief, time: e.target.value })}
          />
          <p>
            <button
              onClick={async () => {
                setErr('');
                setMsg('');
                try {
                  await staff('/staff/phone', { phone: cfg.myPhone ?? '' }, 'PUT');
                  await staff('/staff/settings', { brief: cfg.brief }, 'PUT');
                  setMsg('Saved');
                } catch (x: any) {
                  setErr(x.message);
                }
              }}
            >
              Save
            </button>
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
          <h2>How long we keep data</h2>
          <p className="muted">
            Older data is deleted automatically every night (India's DPDP Act expects data not to be
            kept longer than needed). Activity history is never deleted; we only remove personal
            content.
          </p>
          {(
            [
              ['messages_days', 'Chat messages: days (min 30)'],
              ['intake_days', 'Intake answers: days (min 30)'],
              ['audit_days', 'Personal details in activity history: days (at least 365)'],
              ['inactive_patient_days', 'Erase patients with no visit for: days (min 365)'],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <label htmlFor={k}>{label}</label>
              <input
                id={k}
                type="number"
                value={cfg.retentionRules?.[k] ?? ''}
                onChange={(e) =>
                  set('retentionRules', { ...cfg.retentionRules, [k]: e.target.value })
                }
              />
            </div>
          ))}
          <p>
            <button onClick={() => save(['retentionRules'])}>Save retention</button>
          </p>
        </div>

        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>Clinic assistants</h2>
          <p>
            Choose which everyday tasks the clinic assistant helps with, and review reminders before
            turning them on.
          </p>
          <a href="/doctor/agents">Manage clinic assistants</a>
        </div>

        <details className="card" style={{ marginTop: '1rem' }}>
          <summary>Connected software — for your setup team</summary>
          <p>
            Optional technical setup for exchanging information with another clinic system. Your
            daily work does not require this.
          </p>
          <a href="/doctor/integrations">Open connected software settings</a>
        </details>
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
