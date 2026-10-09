'use client';
import { useStaffLang } from '../../../lib/staffText';
import { useCallback, useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';

type Shortcuts = {
  templates: { id: string; name: string; body: string }[];
  medicines: { id: string; line: string }[];
};
type MedicineCatalog = { starter: string[]; custom: { id: string; name: string }[] };

/** My visit shortcuts: templates I start notes from, and medicine lines I prescribe often. Written by me, never by the assistant. */
export default function ShortcutsPage() {
  const { x: ui } = useStaffLang();
  const s = useSession('doctor');
  const [data, setData] = useState<Shortcuts | null>(null);
  const [catalog, setCatalog] = useState<MedicineCatalog | null>(null);
  const [name, setName] = useState(''),
    [body, setBody] = useState(''),
    [line, setLine] = useState('');
  const [medicineName, setMedicineName] = useState('');
  const [err, setErr] = useState(''),
    [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const [shortcuts, names] = await Promise.all([
      staff<Shortcuts>('/staff/shortcuts'), staff<MedicineCatalog>('/staff/medicine-catalog'),
    ]);
    setData(shortcuts); setCatalog(names);
  }, []);
  useEffect(() => {
    if (s) load().catch((e) => setErr(e.message));
  }, [s, load]);
  if (!s || !data) return null;
  const run = async (fn: () => Promise<any>, ok = '') => {
    setErr('');
    setMsg('');
    try {
      const r = await fn();
      if (ok) setMsg(typeof ok === 'string' ? ui(ok) : '');
      if (r?.incomplete?.length) setMsg(`${ui('Saved. Note:')} ${r.incomplete.join('; ')}`);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="shortcuts-page">
      <header className="doctor-page-heading">
        <div>
          <span className="page-eyebrow">{ui("Clinic")}</span>
          <h1>{ui("My visit shortcuts")}</h1>
          <p className="muted">
            {ui("Start a note from your own wording and add medicines you prescribe often. Everything here is written by you. Nothing is added to a patient's record until you review and sign it.")}
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
        <h2>{ui("Visit templates")}</h2>
        <p className="muted">
          {ui('Headings and wording you start from. Use')} <code>___</code> {ui('for a blank you will fill in at the visit.')}
        </p>
        {!data.templates.length && (
          <p>
            <button
              className="ghost"
              onClick={() =>
                run(() => staff('/staff/shortcuts/starter', {}), 'Starter templates added')
              }
            >
              {ui("Add three starter templates")}
            </button>{' '}
            <span className="muted">{ui("(headings and blanks only)")}</span>
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
                  confirm(`${ui('Delete')} "${t.name}"?`) &&
                  run(() => staff(`/staff/shortcuts/templates/${t.id}`, undefined, 'DELETE'))
                }
              >
                {ui("Delete")}
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
          <label htmlFor="tn">{ui("Template name")}</label>
          <input
            id="tn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ui('e.g. BP follow-up')}
            required
          />
          <label htmlFor="tb">{ui("Wording")}</label>
          <textarea
            id="tb"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={ui('Complaint: ___\nExamination: BP ___\nPlan: ___\nFollow up: ___')}
            required
          />
          <p>
            <button type="submit">{ui("Save template")}</button>
          </p>
        </form>
      </section>

      <section className="card" data-testid="medicine-catalog">
        <h2>{ui('My medicine names')}</h2>
        <p className="muted">{ui('Search common generic names when making a prescription. Add other names you use. These names carry no dose or treatment recommendation.')}</p>
        <p>{catalog?.starter.length ?? 0} {ui('starter names')} · {catalog?.custom.length ?? 0} {ui('names added by me')}</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => {
          await staff('/staff/medicine-catalog', { name: medicineName });
          setMedicineName('');
        }, 'Medicine name saved'); }}>
          <input aria-label={ui('Medicine name')} value={medicineName}
            onChange={(e) => setMedicineName(e.target.value)} required minLength={2} maxLength={100}
            placeholder={ui('Generic or brand name you want to find later')} />
          <button type="submit">{ui('Add name')}</button>
        </form>
        <div className="list">
          {catalog?.custom.map((item) => <div key={item.id} className="row between">
            <span>{item.name}</span>
            <button type="button" className="small ghost" onClick={() => void run(
              () => staff(`/staff/medicine-catalog/${item.id}`, undefined, 'DELETE'))}>
              {ui('Delete')}
            </button>
          </div>)}
        </div>
      </section>

      <section className="card" style={{ marginTop: '1rem' }} data-testid="medicines">
        <h2>{ui("Favourite medicines")}</h2>
        <p className="muted">
          {ui('One line, exactly as you would dictate it. When you write a prescription you add it with one tap. Doses and durations are copied as written, never suggested.')}
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
                {ui("Delete")}
              </button>
            </div>
          ))}
          {!data.medicines.length && <p className="muted">{ui("No favourites yet.")}</p>}
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
            aria-label={ui('Medicine line')}
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder={ui("tab paracetamol 500 mg twice a day for 3 days")}
            required
          />
          <button type="submit">{ui("Add")}</button>
        </form>
      </section>
    </div>
  );
}
