'use client';
import { useEffect, useState } from 'react';
import { useSection } from '../../components/useSection';
import { staff, useSession } from '../../../lib/api';
import { useStaffLang } from '../../../lib/staffText';

const settingsSection = (hash: string) =>
  [
    'all',
    'clinic-details',
    'patient-questions',
    'common-questions',
    'follow-ups',
    'public-page',
    'messaging',
    'privacy-retention',
    'clinic-assistants',
    'connected-software',
    'safety-controls',
  ].includes(hash)
    ? hash
    : 'all';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Agent builder: the admin configures how the front-desk assistants behave. Safety rules are not configurable here. */
export default function Settings() {
  const { x } = useStaffLang();
  const s = useSession('admin');
  const selectedSection = useSection(settingsSection, 'all');
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState(''),
    [err, setErr] = useState('');
  const [phrase, setPhrase] = useState('');
  const load = () => staff('/staff/settings').then(setCfg);
  useEffect(() => {
    if (s) {
      load().catch((e) => setErr(e.message));
    }
  }, [s]);
  if (!s) return null;
  if (!cfg)
    return (
      <div className="wrap">
        {err ? (
          <p role="alert" className="error">
            {err}
          </p>
        ) : (
          <p>{x("Loading clinic details…")}</p>
        )}
      </div>
    );
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
      setMsg(x('Saved'));
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const fr = cfg.followupRules;
  return (
    <div>
      <div className="topbar">
        <b>{x("Clinic settings")}</b>
        <a href="/admin">{x("← Back to clinic setup")}</a>
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

        <header className="screen-heading">
          <span className="eyebrow">{x("Clinic")}</span>
          <h1>{x("Clinic settings")}</h1>
          <p className="muted">{x("All settings are shown below. Use the section links to focus on one area.")}</p>
        </header>
        <div className="settings-page-grid">
          <nav className="settings-section-nav" aria-label={x('Settings sections')}>
            <a href="#all" aria-current={selectedSection === 'all' ? 'page' : undefined}>{x("Show all settings")}</a>
            <a
              href="#messaging"
              aria-current={selectedSection === 'messaging' ? 'page' : undefined}
            >{x("Daily staff summary")}</a>
            <a
              href="#clinic-details"
              aria-current={selectedSection === 'clinic-details' ? 'page' : undefined}
            >{x("Clinic details")}</a>
            <a
              href="#patient-questions"
              aria-current={selectedSection === 'patient-questions' ? 'page' : undefined}
            >{x("Patient questions")}</a>
            <a
              href="#common-questions"
              aria-current={selectedSection === 'common-questions' ? 'page' : undefined}
            >{x("Common questions")}</a>
            <a
              href="#follow-ups"
              aria-current={selectedSection === 'follow-ups' ? 'page' : undefined}
            >{x("Follow-ups")}</a>
            <a
              href="#public-page"
              aria-current={selectedSection === 'public-page' ? 'page' : undefined}
            >{x("Public page")}</a>
            <a
              href="#connected-software"
              aria-current={selectedSection === 'connected-software' ? 'page' : undefined}
            >{x("Connected software")}</a>
            <a
              href="#privacy-retention"
              aria-current={selectedSection === 'privacy-retention' ? 'page' : undefined}
            >{x("Privacy")}</a>
            <a
              href="#clinic-assistants"
              aria-current={selectedSection === 'clinic-assistants' ? 'page' : undefined}
            >{x("Assistants")}</a>
            <a
              href="#safety-controls"
              aria-current={selectedSection === 'safety-controls' ? 'page' : undefined}
            >{x("Safety")}</a>
          </nav>
          <div className="settings-sections">
            <section
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'messaging'}
              id="messaging"
            >
              <h2>{x("Daily staff summary")}</h2>
              <p>{x("Doctors add their own WhatsApp number in My profile. Delivery needs a working clinic connection.")}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={cfg.brief?.enabled === true}
                  onChange={(e) => set('brief', { ...cfg.brief, enabled: e.target.checked })}
                />
                {x('Send the daily summary')}
              </label>
              <label htmlFor="summary-time">{x("Send it at (clinic time)")}</label>
              <input
                id="summary-time"
                type="time"
                value={cfg.brief?.time ?? '20:00'}
                onChange={(e) => set('brief', { ...cfg.brief, time: e.target.value })}
              />
              <p>
                <button onClick={() => save(['brief'])}>{x("Save summary settings")}</button>
              </p>
            </section>
            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'clinic-details'}
              id="clinic-details"
            >
              <h2>{x("Clinic information")}</h2>
              <p className="muted">{x("The clinic assistant uses these details when answering patients.")}</p>
              <label htmlFor="addr">{x("Address")}</label>
              <input
                id="addr"
                value={cfg.address ?? ''}
                onChange={(e) => set('address', e.target.value)}
              />
              <label htmlFor="dir">{x("Directions")}</label>
              <input
                id="dir"
                value={cfg.directions ?? ''}
                onChange={(e) => set('directions', e.target.value)}
              />
              <label htmlFor="ph">{x("Clinic phone")}</label>
              <input
                id="ph"
                value={cfg.phone ?? ''}
                onChange={(e) => set('phone', e.target.value)}
              />
              <label htmlFor="avg">{x("Average consultation (minutes)")}</label>
              <input
                id="avg"
                type="number"
                value={cfg.avgConsultMinutes}
                onChange={(e) => set('avgConsultMinutes', e.target.value)}
              />
              <h3 style={{ marginTop: '1rem' }}>{x("Timings")}</h3>
              {DAYS.map((d) => (
                <div key={d} className="row" style={{ margin: '4px 0' }}>
                  <span style={{ width: 40 }}>{x(d)}</span>
                  <input
                    aria-label={`${x('Timings')} ${x(d)}`}
                    placeholder={x('09:00-13:00, 17:00-20:00 or Closed')}
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
                >{x("Save clinic information")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'patient-questions'}
              id="patient-questions"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Before-visit questions")}</h2>
              <p className="muted">{x("Asked on WhatsApp while the patient waits. Both languages required. Questions only: the assistant never gives medical advice.")}</p>
              {cfg.intakeQuestions.map((q: any, i: number) => (
                <div key={i} className="row" style={{ margin: '4px 0' }}>
                  <input
                    aria-label={`${x('Question')} ${i + 1} ${x('English')}`}
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
                    aria-label={`${x('Question')} ${i + 1} ${x('Hindi')}`}
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
                  >{x("Remove")}</button>
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
                >{x("Add question")}</button>
                <button onClick={() => save(['intakeQuestions'])}>{x("Save questions")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'common-questions'}
              id="common-questions"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Answers to common questions (FAQ)")}</h2>
              <p className="muted">{x("When a patient message contains one of the keywords, the assistant sends your answer. Clinic information only, no medical advice.")}</p>
              {cfg.faqs.map((f: any, i: number) => (
                <div
                  key={f.id}
                  style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}
                >
                  <input
                    aria-label={`${x('FAQ')} ${i + 1} ${x('keywords')}`}
                    placeholder={x('keywords, comma separated')}
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
                    aria-label={`${x('FAQ')} ${i + 1} ${x('answer')} ${x('English')}`}
                    placeholder={x('Answer (English)')}
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
                    aria-label={`${x('FAQ')} ${i + 1} ${x('answer')} ${x('Hindi')}`}
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
                  >{x("Remove")}</button>
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
                >{x("Add FAQ")}</button>
                <button onClick={() => save(['faqs'])}>{x("Save FAQs")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'follow-ups'}
              id="follow-ups"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Follow-ups")}</h2>
              <label htmlFor="r1">{x("Appointment reminder: hours before")}</label>
              <input
                id="r1"
                type="number"
                value={fr.reminder_hours_before}
                onChange={(e) =>
                  set('followupRules', { ...fr, reminder_hours_before: e.target.value })
                }
              />
              <label htmlFor="r2">{x("Post-visit check-in: hours after the visit")}</label>
              <input
                id="r2"
                type="number"
                value={fr.post_visit_hours}
                onChange={(e) => set('followupRules', { ...fr, post_visit_hours: e.target.value })}
              />
              <label htmlFor="r3">{x("Review recall: days since last visit")}</label>
              <input
                id="r3"
                type="number"
                value={fr.recall_days}
                onChange={(e) => set('followupRules', { ...fr, recall_days: e.target.value })}
              />
              <p>
                <button onClick={() => save(['followupRules'])}>{x("Save follow-up timing")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'public-page'}
              id="public-page"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Patient feedback and public page")}</h2>
              <p className="muted">{x("After a visit the assistant asks the patient to rate it from 1 to 5 (only patients who agreed to follow-up messages). Everyone who rates is offered your review link; low ratings alert the receptionist so you can reach out personally.")}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={cfg.reputation?.enabled === true}
                  onChange={(e) =>
                    set('reputation', { ...cfg.reputation, enabled: e.target.checked })
                  }
                />
                {x('Ask for feedback after visits')}
              </label>
              <label htmlFor="rurl">{x("Your Google review link (optional)")}</label>
              <input
                id="rurl"
                value={cfg.reputation?.review_url ?? ''}
                onChange={(e) =>
                  set('reputation', { ...cfg.reputation, review_url: e.target.value })
                }
                placeholder="https://g.page/r/..."
              />
              <label htmlFor="rdel">{x("Ask this many hours after the visit")}</label>
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
                {x('Show the average rating on my public page (needs at least 10 ratings; every rating counts, nothing is hidden)')}
              </label>
              <label htmlFor="about">{x("About the clinic (shown on your public page)")}</label>
              <textarea
                id="about"
                rows={3}
                value={cfg.publicPage?.about ?? ''}
                onChange={(e) => set('publicPage', { about: e.target.value })}
              />
              <p>
                <button onClick={() => save(['reputation', 'publicPage'])}>{x("Save")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'privacy-retention'}
              id="privacy-retention"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("How long we keep data")}</h2>
              <p className="muted">{x("Older data is deleted automatically every night (India's DPDP Act expects data not to be kept longer than needed). Activity history is never deleted; we only remove personal content.")}</p>
              {(
                [
                  ['messages_days', 'Chat messages: days (min 30)'],
                  ['intake_days', 'Intake answers: days (min 30)'],
                  ['audit_days', 'Personal details in activity history: days (at least 365)'],
                  ['inactive_patient_days', 'Erase patients with no visit for: days (min 365)'],
                ] as const
              ).map(([k, label]) => (
                <div key={k}>
                  <label htmlFor={k}>{x(label)}</label>
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
                <button onClick={() => save(['retentionRules'])}>{x("Save retention")}</button>
              </p>
            </div>

            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'clinic-assistants'}
              id="clinic-assistants"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Clinic assistants")}</h2>
              <p>{x("Choose which everyday tasks the clinic assistant helps with, and review reminders before turning them on.")}</p>
              <a href="/admin/agents">{x("Manage clinic assistants")}</a>
            </div>

            <details
              open
              hidden={selectedSection !== 'all' && selectedSection !== 'connected-software'}
              id="connected-software"
              className="card"
              style={{ marginTop: '1rem' }}
            >
              <summary>{x("Connected software — for your setup team")}</summary>
              <p>{x("Optional technical setup for exchanging information with another clinic system. Your daily work does not require this.")}</p>
              <a href="/admin/integrations">{x("Open connected software settings")}</a>
            </details>
            <div
              className="card"
              hidden={selectedSection !== 'all' && selectedSection !== 'safety-controls'}
              id="safety-controls"
              style={{ marginTop: '1rem' }}
            >
              <h2>{x("Emergency phrases")}</h2>
              <p className="muted">{x("A built-in list of Hindi and English emergency phrases is always active and cannot be removed. You can add phrases specific to your clinic.")}</p>
              <div className="list">
                {cfg.redFlagPhrases.map((p: any) => (
                  <div key={p.id} className="row between">
                    <span>
                      {p.phrase} <span className="tag">{p.language === 'hi' ? x('Hindi') : x('English')}</span>
                    </span>
                    <button
                      className="small ghost"
                      onClick={() =>
                        staff(`/staff/settings/phrases/${p.id}`, undefined, 'DELETE')
                          .then(load)
                          .catch((x) => setErr(x.message))
                      }
                    >{x("Remove")}</button>
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
                  aria-label={x('New emergency phrase')}
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder={x('e.g. bee sting swelling')}
                />
                <button type="submit">{x("Add phrase")}</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
