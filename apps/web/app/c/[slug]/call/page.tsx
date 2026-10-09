'use client';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useStaffLang } from '../../../../lib/staffText';

type Turn = { who: 'caller' | 'agent'; text: string };

/** Phone-call simulator: type what the caller says; the agent's reply is what would be spoken. */
export default function Call({ params }: { params: { slug: string } }) {
  const { lang, setLang, x } = useStaffLang();
  const [phone, setPhone] = useState(
    params.slug.startsWith('showcase-') ? '+910000000098' : '9876501003',
  );
  const [text, setText] = useState('');
  const [log, setLog] = useState<Turn[]>([]);
  const [transfer, setTransfer] = useState(false);
  const speak = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    setLog((l) => [...l, { who: 'caller', text: v }]);
    const r = await api(`/voice/${params.slug}/turn`, { body: { from: phone, text: v } });
    setLog((l) => [...l, ...r.replies.map((t: string) => ({ who: 'agent' as const, text: t }))]);
    if (r.transferToHuman) setTransfer(true);
  };
  return (
    <div className="wrap practice-call-page">
      <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
      <h1>{x('Try a phone conversation')}</h1>
      <label htmlFor="ph">{x('Caller number')}</label>
      <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div
        className="card call-transcript"
        style={{ margin: '1rem 0', minHeight: 200 }}
        data-testid="call-log"
      >
        {log.map((l, i) => (
          <p key={i} style={{ textAlign: l.who === 'caller' ? 'right' : 'left' }}>
            <span className="tag">
              {l.who === 'caller' ? '🗣' : '🔊'} {l.text}
            </span>
          </p>
        ))}
        {transfer && (
          <p className="banner warn">
            {x('The assistant has asked the reception team to help. No real call is transferred.')}
          </p>
        )}
      </div>
      <form className="row" onSubmit={speak}>
        <input
          aria-label={x('Caller says')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={x('What the caller says')}
        />
        <button type="submit">{x('Send')}</button>
      </form>
      <p className="muted">
        {x('This is a practice conversation. Type what a patient might say to see the reply. No real phone call is made.')}
      </p>
    </div>
  );
}
