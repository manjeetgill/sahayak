'use client';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';

type Shortcuts = {
  templates: { id: string; name: string; body: string }[];
  medicines: { id: string; line: string }[];
};

/** My visit shortcuts: templates I start notes from, and medicine lines I prescribe often. Written by me, never by the assistant. */
export default function ShortcutsPage() {
  const s = useSession('doctor');
  const [data, setData] = useState<Shortcuts | null>(null);
  const [name, setName] = useState(''),
    [body, setBody] = useState(''),
    [line, setLine] = useState('');
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const load = useCallback(async () => setData(await staff('/staff/shortcuts')), []);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s, load]);
  if (!s || !data) return null;
  const run = async (fn: () => Promise<any>, ok = '') => {
    setErr('');
    setMsg('');
    try {
      const r = await fn();
      if (ok) setMsg(typeof ok === 'string' ? ok : '');
      if (r?.incomplete?.length) setMsg(`Saved. Note: ${r.incomplete.join('; ')}`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="shortcuts-page">
      <header className="doctor-page-heading">
        <div>
          <span className="page-eyebrow">Clinic</span>
          <h1>My visit shortcuts</h1>
          <p className="muted">
            Start a note from your own wording and add medicines you prescribe often. Everything
            here is written by you. Nothing is added to a patient's record until you review and sign
            it.
          </p>
        </div>
      </header>
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

      <section className="card" data-testid="templates">
        <h2>Visit templates</h2>
        <p className="muted">
          Headings and wording you start from. Use <code>___</code> for a blank you will fill in at
          the visit.
        </p>
        {!data.templates.length && (
          <p>
            <button
              className="ghost"
              onClick={() =>
                run(() => staff('/staff/shortcuts/starter', {}), 'Starter templates added')
              }
            >
              Add three starter templates
            </button>{' '}
            <span className="muted">(headings and blanks only)</span>
          </p>
        )}
        <div className="list">
          {data.templates.map((t) => (
            <div key={t.id} className="row between" style={{ alignItems: 'flex-start' }}>
              <div>
                <b>{t.name}</b>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{t.body}</pre>
              </div>
              <button
                className="small ghost"
                onClick={() =>
                  confirm(`Delete "${t.name}"?`) &&
                  run(() => staff(`/staff/shortcuts/templates/${t.id}`, undefined, 'DELETE'))
                }
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await staff('/staff/shortcuts/templates', { name, body });
              setName('');
              setBody('');
            }, 'Template saved');
          }}
        >
          <label htmlFor="tn">Template name</label>
          <input
            id="tn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BP follow-up"
            required
          />
          <label htmlFor="tb">Wording</label>
          <textarea
            id="tb"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={'Complaint: ___\nExamination: BP ___\nPlan: ___\nFollow up: ___'}
            required
          />
          <p>
            <button type="submit">Save template</button>
          </p>
        </form>
      </section>

      <section className="card" style={{ marginTop: '1rem' }} data-testid="medicines">
        <h2>Favourite medicines</h2>
        <p className="muted">
          One line, exactly as you would dictate it. When you write a prescription you add it with
          one tap. Doses and durations are copied as written, never suggested.
        </p>
        <div className="list">
          {data.medicines.map((m) => (
            <div key={m.id} className="row between">
              <span>{m.line}</span>
              <button
                className="small ghost"
                onClick={() =>
                  run(() => staff(`/staff/shortcuts/medicines/${m.id}`, undefined, 'DELETE'))
                }
              >
                Delete
              </button>
            </div>
          ))}
          {!data.medicines.length && <p className="muted">No favourites yet.</p>}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await staff('/staff/shortcuts/medicines', { line });
              setLine('');
              return r;
            }, 'Saved');
          }}
        >
          <input
            aria-label="Medicine line"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="tab paracetamol 500 mg twice a day for 3 days"
            required
          />
          <button type="submit">Add</button>
        </form>
      </section>
    </div>
  );
}
