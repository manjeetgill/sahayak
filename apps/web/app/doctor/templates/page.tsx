'use client';
import { useEffect, useState } from 'react';
import { staff, useSession } from '../../../lib/api';
export default function Templates() {
  const session = useSession('doctor');
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
      <a href="/doctor">← Today’s clinic</a>
      <h1>Reusable care plans</h1>
      <p>
        Save clinic wording and a schedule. Keep patient names and personal details out. Each
        patient’s plan must still be reviewed and approved before use.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <legend>{previousId ? 'New version for review' : 'Create a reusable plan'}</legend>
        <label>
          Plan title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {steps.map((s, n) => (
          <fieldset key={n}>
            <legend>Step {n + 1}</legend>
            <label>
              Task name
              <input
                value={s.title}
                onChange={(e) =>
                  setSteps(steps.map((x, j) => (j === n ? { ...x, title: e.target.value } : x)))
                }
              />
            </label>
            <label>
              Wording for the patient
              <textarea
                value={s.message}
                onChange={(e) =>
                  setSteps(steps.map((x, j) => (j === n ? { ...x, message: e.target.value } : x)))
                }
              />
            </label>
            <label>
              Days after plan starts
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
              <button onClick={() => setSteps(steps.filter((_, j) => j !== n))}>Remove step</button>
            )}
          </fieldset>
        ))}
        <button
          disabled={steps.length >= 12}
          onClick={() => setSteps([...steps, { title: '', message: '', afterDays: 0 }])}
        >
          Add step
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
          Save version for review
        </button>
      </fieldset>
      <h2>Plan library and version history</h2>
      {!items.length && <p>No reusable plans yet.</p>}
      {items.map((t) => (
        <article className="card" key={t.id}>
          <h3>
            {t.title} · version {t.version}
          </h3>
          <p>
            {t.archived_at ? 'Retired' : t.approved_at ? 'Approved' : 'Awaiting approval'} ·{' '}
            {t.author}
          </p>
          {t.steps.map((s: any, n: number) => (
            <p key={n}>
              <b>
                Day {s.afterDays}: {s.title}
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
                    'I reviewed all wording and dates and checked that no patient details are included. Approve this reusable plan?',
                  )
                )
                  void run(() =>
                    staff('/staff/workbench/template-review', { id: t.id, action: 'approve' }),
                  );
              }}
            >
              Approve reusable plan
            </button>
          )}{' '}
          <button
            disabled={busy}
            onClick={() => {
              setPrevious(t.id);
              setTitle(t.title);
              setSteps(t.steps.map((s: any) => ({ ...s })));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            Create revised version
          </button>{' '}
          {!t.archived_at && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    'Retire this version from new use? Existing patient plans will stay unchanged.',
                  )
                )
                  void run(() =>
                    staff('/staff/workbench/template-review', { id: t.id, action: 'archive' }),
                  );
              }}
            >
              Retire version
            </button>
          )}
        </article>
      ))}
    </main>
  );
}
