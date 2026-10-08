'use client';
import { useState } from 'react';
import { staff } from '../../lib/api';

const EXAMPLES = [
  'How many patients today?',
  "Who didn't show up yesterday?",
  'Appointments tomorrow',
  'Average waiting time this week',
  'Busiest hours this month',
];

/** Ask a question about the clinic in plain words (English or Hindi). Read-only, from the clinic's own data. */
export function AskClinic() {
  const [q, setQ] = useState('');
  const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r =
        text.trim().toLowerCase() === 'brief'
          ? { answer: (await staff('/staff/brief')).text }
          : await staff('/staff/ask', { question: text });
      setLog((l) => [{ q: text, a: r.answer }, ...l].slice(0, 8));
    } catch (e: any) {
      setLog((l) => [{ q: text, a: e.message }, ...l]);
    }
    setQ('');
    setBusy(false);
  };
  return (
    <div className="card" data-testid="ask-clinic">
      <h3>Ask your clinic</h3>
      <form
        className="row ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input
          aria-label="Ask your clinic"
          placeholder="e.g. who didn't show up yesterday?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Ask
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => ask('brief')}>
          Today's summary
        </button>
      </form>
      {!log.length && (
        <p className="muted" style={{ fontSize: '.85rem' }}>
          Try:{' '}
          {EXAMPLES.map((x) => (
            <a
              key={x}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                ask(x);
              }}
              style={{ marginRight: 10 }}
            >
              {x}
            </a>
          ))}
        </p>
      )}
      <div className="list" aria-live="polite">
        {log.map((l, i) => (
          <div key={i}>
            <div className="muted" style={{ fontSize: '.8rem' }}>
              {l.q}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{l.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
