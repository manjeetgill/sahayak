'use client';
import { useStaffLang } from '../../../lib/staffText';
import { useEffect, useState, useRef } from 'react';
import { staff, useSession } from '../../../lib/api';
export default function References() {
  const { lang, x: ui } = useStaffLang();
  const s = useSession('doctor');
  const editor = useRef<HTMLDetailsElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [data, setData] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [topic, setTopic] = useState(''),
    [results, setResults] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [guidelines, setGuidelines] = useState(true);
  const [form, setForm] = useState({
    title: '',
    url: '',
    publishedOn: '',
    reviewDue: '',
    notes: '',
  });
  const load = () => staff('/staff/references').then((r) => setData(r.references));
  useEffect(() => {
    if (s) load().catch((e) => setError(e.message));
  }, [s]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!s) return null;
  return (
    <main className="wrap references-page" style={{ maxWidth: 1120 }}>
      <a href="/doctor">{ui("← Today’s clinic")}</a>
      <h1>{ui("Medical reference")}</h1>
      <p>
        {ui('Find original publications and keep a clinic-reviewed reading list. Results are publication details, not a generated treatment recommendation or a complete review of the evidence.')}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="workspace-split">
        <div className="reference-search-panel">
          <fieldset className="card" disabled={busy}>
            <legend>{ui("Search PubMed")}</legend>
            <label>
              {ui('General medical topic')}
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={ui('For example: diabetes follow-up guidelines')}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={guidelines}
                onChange={(e) => setGuidelines(e.target.checked)}
              />
              {ui('Guidelines only')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {ui('Send this general topic to PubMed. I have not included patient details.')}
            </label>
            <button
              disabled={!consent || topic.trim().length < 3}
              onClick={() =>
                run(async () =>
                  setResults(
                    await staff('/staff/workbench/reference-search', {
                      topic,
                      consent: true,
                      guidelinesOnly: guidelines,
                    }),
                  ),
                )
              }
            >
              {ui("Find publications")}
            </button>
          </fieldset>
          {results && (
            <section>
              <p>
                {ui('Retrieved')} {new Date(results.retrievedAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN')}. {ui('Publication date order; new does not necessarily mean better evidence.')}
              </p>
              {!results.results.length && (
                <p>{ui("No publications matched. Try a different general topic.")}</p>
              )}
              {results.results.map((r: any) => (
                <article className="card" key={r.id}>
                  <h2>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>
                  </h2>
                  <p>
                    {r.date} · {r.journal} · {r.types.join(', ')}
                  </p>
                  <button
                    onClick={() => {
                      setEditing(null);
                      setForm({ ...form, title: r.title, url: r.url });
                      if (editor.current) {
                        editor.current.open = true;
                        editor.current.scrollIntoView({ behavior: 'smooth' });
                      }
                    }}
                  >
                    {ui("Use in reading list")}
                  </button>
                </article>
              ))}
            </section>
          )}
        </div>
        <section className="card reading-list-panel">
          <h2>{ui("Clinic reading list")}</h2>
          <p>
            {ui('Review the original publication before recording your notes. Dates and notes below are entered by your clinic; no guideline changes are applied automatically.')}
          </p>
          <details ref={editor}>
            <summary>{ui("Add a reviewed reference")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await staff('/staff/workbench/references', { ...form, id: editing ?? undefined });
                  await load();
                  setEditing(null);
                  setForm({ title: '', url: '', publishedOn: '', reviewDue: '', notes: '' });
                });
              }}
            >
              <fieldset disabled={busy}>
                {Object.entries({
                  title: 'Title',
                  url: 'Original source link',
                  publishedOn: 'Publication date',
                  reviewDue: 'Review again on',
                  notes: 'Your evidence notes and limitations (no patient details)',
                }).map(([key, label]) => (
                  <label key={key}>
                    {ui(label)}
                    <input
                      required
                      type={
                        key.endsWith('On') || key === 'reviewDue'
                          ? 'date'
                          : key === 'url'
                            ? 'url'
                            : 'text'
                      }
                      value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <button>{ui(editing ? 'Save updated review' : 'Save reviewed reference')}</button>
                {editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setForm({ title: '', url: '', publishedOn: '', reviewDue: '', notes: '' });
                    }}
                  >
                    {ui("Cancel editing")}
                  </button>
                )}
              </fieldset>
            </form>
          </details>
          {!data.length && <p>{ui("No references saved yet.")}</p>}
          {data.map((r) => (
            <article className="card" key={r.id}>
              <h3>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              </h3>
              <p>
                {ui('Published')} {String(r.published_on).slice(0, 10)} · {ui('Reviewed by')} {r.reviewer} {ui('on')}{' '}
                {new Date(r.reviewed_at).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN')}
              </p>
              <p>{r.notes}</p>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(r.id);
                  setForm({
                    title: r.title,
                    url: r.url,
                    publishedOn: r.published_on,
                    reviewDue: r.review_due,
                    notes: r.notes,
                  });
                  if (editor.current) {
                    editor.current.open = true;
                    editor.current.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
              >
                {ui("Review or edit")}
              </button>{' '}
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm(ui('Remove this reference from the active reading list?')))
                    void run(async () => {
                      await staff('/staff/workbench/reference-archive', { id: r.id });
                      await load();
                    });
                }}
              >
                {ui("Remove from reading list")}
              </button>
              <p>
                {ui('Review again:')} {String(r.review_due).slice(0, 10)}
                {new Date(r.review_due) < new Date() ? ui(' · Review due') : ''}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
