'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
import { CareNav } from '../../components/CareNav';
import { useStaffLang } from '../../../lib/staffText';
export default function Templates() {
  const { x } = useStaffLang();
  const session = useSession('doctor');
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<any[]>([]),
    [title, setTitle] = useState(''),
    [previousId, setPrevious] = useState<string>(),
    [steps, setSteps] = useState([{ title: '', message: '', afterDays: 0 }]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => setItems((await staff('/staff/workbench/template-list', {})).templates);
  useEffect(() => {
    if (session) load().catch((e) => setError(e.message));
  }, [session]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!session) return null;
  return (
    <main className="wrap" style={{ maxWidth: 900 }}>
      <a href="/doctor">← {x('Today’s clinic')}</a>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{x('Care')}</span>
          <h1>{x('Reusable care plans')}</h1>
        </div>
        <button onClick={() => setCreating((v) => !v)}>
          {x(creating ? 'Close form' : 'Create reusable plan')}
        </button>
      </div>
      <p>
        {x('Save clinic wording and a schedule. Keep patient names and personal details out. Each patient’s plan must still be reviewed and approved before use.')}
      </p>
      <CareNav />
      {error && <p role="alert">{error}</p>}
      <div className={`workspace-split plans-workspace ${creating ? 'creating' : ''}`}>
        <fieldset disabled={busy} hidden={!creating}>
          <legend>{x(previousId ? 'New version for review' : 'Create a reusable plan')}</legend>
          <label>
            {x('Plan title')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {steps.map((s, n) => (
            <fieldset key={n}>
              <legend>{x('Step')} {n + 1}</legend>
              <label>
                {x('Task name')}
                <input
                  value={s.title}
                  onChange={(e) =>
                    setSteps(steps.map((x, j) => (j === n ? { ...x, title: e.target.value } : x)))
                  }
                />
              </label>
              <label>
                {x('Wording for the patient')}
                <textarea
                  value={s.message}
                  onChange={(e) =>
                    setSteps(steps.map((x, j) => (j === n ? { ...x, message: e.target.value } : x)))
                  }
                />
              </label>
              <label>
                {x('Days after plan starts')}
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={s.afterDays}
                  onChange={(e) =>
                    setSteps(
                      steps.map((x, j) =>
                        j === n ? { ...x, afterDays: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
              {steps.length > 1 && (
                <button onClick={() => setSteps(steps.filter((_, j) => j !== n))}>
                  {x('Remove step')}
                </button>
              )}
            </fieldset>
          ))}
          <button
            disabled={steps.length >= 12}
            onClick={() => setSteps([...steps, { title: '', message: '', afterDays: 0 }])}
          >
            {x('Add step')}
          </button>{' '}
          <button
            disabled={!title.trim() || steps.some((s) => !s.title.trim() || !s.message.trim())}
            onClick={() =>
              run(async () => {
                await staff('/staff/workbench/template-save', { title, steps, previousId });
                setTitle('');
                setPrevious(undefined);
                setSteps([{ title: '', message: '', afterDays: 0 }]);
              })
            }
          >
            {x('Save version for review')}
          </button>
        </fieldset>
        <section className="card">
          <h2>{x('Plan library and version history')}</h2>
          {!items.length && <p>{x('No reusable plans yet.')}</p>}
          {items.map((t) => (
            <article className="card" key={t.id}>
              <h3>
                {t.title} · {x('version')} {t.version}
              </h3>
              <p>
                {x(t.archived_at ? 'Retired' : t.approved_at ? 'Approved' : 'Awaiting approval')} ·{' '}
                {t.author}
              </p>
              {t.steps.map((s: any, n: number) => (
                <p key={n}>
                  <b>
                    {x('Day')} {s.afterDays}: {s.title}
                  </b>
                  <br />
                  {s.message}
                </p>
              ))}
              {!t.archived_at && !t.approved_at && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        x('I reviewed all wording and dates and checked that no patient details are included. Approve this reusable plan?'),
                      )
                    )
                      void run(() =>
                        staff('/staff/workbench/template-review', { id: t.id, action: 'approve' }),
                      );
                  }}
                >
                  {x('Approve reusable plan')}
                </button>
              )}{' '}
              <button
                disabled={busy}
                onClick={() => {
                  setCreating(true);
                  setPrevious(t.id);
                  setTitle(t.title);
                  setSteps(t.steps.map((s: any) => ({ ...s })));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                {x('Create revised version')}
              </button>{' '}
              {!t.archived_at && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        x('Retire this version from new use? Existing patient plans will stay unchanged.'),
                      )
                    )
                      void run(() =>
                        staff('/staff/workbench/template-review', { id: t.id, action: 'archive' }),
                      );
                  }}
                >
                  {x('Retire version')}
                </button>
              )}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
