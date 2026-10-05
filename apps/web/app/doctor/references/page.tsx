'use client';
import { useEffect, useState, useRef } from 'react';
import { staff, useSession } from '../../../lib/api';
export default function References() {
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
    <main className="wrap" style={{ maxWidth: 900 }}>
      <a href="/doctor">← Today’s clinic</a>
      <h1>Medical reference</h1>
      <p>
        Find original publications and keep a clinic-reviewed reading list. Results are publication
        details, not a generated treatment recommendation or a complete review of the evidence.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy}>
        <legend>Search PubMed</legend>
        <label>
          General medical topic
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="For example: diabetes follow-up guidelines"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={guidelines}
            onChange={(e) => setGuidelines(e.target.checked)}
          />
          Guidelines only
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Send this general topic to PubMed. I have not included patient details.
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
          Find publications
        </button>
      </fieldset>
      {results && (
        <section>
          <p>
            Retrieved {new Date(results.retrievedAt).toLocaleString()}. Publication date order; new
            does not necessarily mean better evidence.
          </p>
          {!results.results.length && (
            <p>No publications matched. Try a different general topic.</p>
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
                Use in reading list
              </button>
            </article>
          ))}
        </section>
      )}
      <h2>Clinic reading list</h2>
      <p>
        Review the original publication before recording your notes. Dates and notes below are
        entered by your clinic; no guideline changes are applied automatically.
      </p>
      <details ref={editor}>
        <summary>Add a reviewed reference</summary>
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
                {label}
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
            <button>{editing ? 'Save updated review' : 'Save reviewed reference'}</button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm({ title: '', url: '', publishedOn: '', reviewDue: '', notes: '' });
                }}
              >
                Cancel editing
              </button>
            )}
          </fieldset>
        </form>
      </details>
      {!data.length && <p>No references saved yet.</p>}
      {data.map((r) => (
        <article className="card" key={r.id}>
          <h3>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title}
            </a>
          </h3>
          <p>
            Published {String(r.published_on).slice(0, 10)} · Reviewed by {r.reviewer} on{' '}
            {new Date(r.reviewed_at).toLocaleDateString()}
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
            Review or edit
          </button>{' '}
          <button
            disabled={busy}
            onClick={() => {
              if (confirm('Remove this reference from the active reading list?'))
                void run(async () => {
                  await staff('/staff/workbench/reference-archive', { id: r.id });
                  await load();
                });
            }}
          >
            Remove from reading list
          </button>
          <p>
            Review again: {String(r.review_due).slice(0, 10)}
            {new Date(r.review_due) < new Date() ? ' · Review due' : ''}
          </p>
        </article>
      ))}
    </main>
  );
}
