'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useLive } from '../../../../lib/api';
import { useStaffLang } from '../../../../lib/staffText';

type Msg = { direction: 'in' | 'out'; sender: string; body: string; created_at: string };

/** A phone-shaped chat that stands in for WhatsApp, so the demo needs no vendor account. */
export default function Sim({ params }: { params: { slug: string } }) {
  const { lang, setLang, x } = useStaffLang();
  const [phone, setPhone] = useState(
    params.slug.startsWith('showcase-') ? '+910000000099' : '9876501000',
  );
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(() => {
    api<Msg[]>(`/sim/${params.slug}/messages?phone=${encodeURIComponent(phone)}`)
      .then(setMsgs)
      .catch(() => setMsgs([]));
  }, [params.slug, phone]);
  useEffect(() => {
    load();
  }, [load]);
  useLive(`/ws/public/${params.slug}`, (e) => {
    if (e.type === 'conversation_updated') load();
  });
  useEffect(() => {
    end.current?.scrollIntoView();
  }, [msgs]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    await api(`/sim/${params.slug}/message`, { body: { from: phone, text: v } }).catch(() => {});
    load();
  };
  return (
    <div className="wrap practice-chat-page" style={{ maxWidth: 640 }}>
      <button className="ghost" type="button" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिन्दी'}</button>
      <h1>{x('Try a WhatsApp conversation')}</h1>
      <p>
        {x('Use made-up patient details. This chat is saved for practice; no real WhatsApp message is sent.')}
      </p>
      <label htmlFor="ph">{x('Practice patient phone number')}</label>
      <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="phone">
        <header>Sahayak · {x('Clinic')}</header>
        <div className="chat" data-testid="chat">
          {msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.direction}`}>
              {m.body}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="compose" onSubmit={send}>
          <label
            title={x('Send a photo or PDF')}
            style={{ margin: 0, cursor: 'pointer', alignSelf: 'center' }}
          >
            📎
            <input
              aria-label={x('Attach file')}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const base64 = await new Promise<string>((res) => {
                  const r = new FileReader();
                  r.onload = () => res(String(r.result).split(',')[1] ?? '');
                  r.readAsDataURL(f);
                });
                await api(`/sim/${params.slug}/media`, {
                  body: { from: phone, filename: f.name, base64 },
                }).catch(() => {});
                e.target.value = '';
                load();
              }}
            />
          </label>
          <input
            aria-label={x('Message')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={x('Type a message')}
          />
          <button type="submit">{x('Send')}</button>
        </form>
      </div>
      <p className="muted">
        {params.slug.startsWith('showcase-')
          ? x('Try asking about clinic hours or booking an appointment. To show a human handoff, ask to speak with reception. Use only made-up patient details.')
          : x('Try asking about clinic hours, booking an appointment, or describe an urgent concern in Hindi. Example patient numbers: 9876501000–9876501024.')}
      </p>
    </div>
  );
}
