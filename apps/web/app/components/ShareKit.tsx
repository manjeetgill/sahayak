'use client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

const CHANNELS = [
  { src: 'whatsapp', label: 'WhatsApp status / groups' },
  { src: 'google', label: 'Google profile' },
  { src: 'instagram', label: 'Instagram or Facebook' },
  { src: 'card', label: 'Visiting card / prescription pad' },
  { src: 'poster', label: 'Clinic poster' },
];

const caption = (clinic: string, lang: 'en' | 'hi', url: string) =>
  lang === 'en'
    ? `${clinic}: save time at the clinic. Check in from your phone before you arrive: ${url}`
    : `${clinic}: क्लिनिक में समय बचाइए। आने से पहले अपने फ़ोन से चेक-इन करें: ${url}`;

/** Links for each place the clinic is shared, ready captions, and where new patients came from. */
export function ShareKit() {
  const { x: ui } = useStaffLang();
  const [data, setData] = useState<{
    slug: string;
    clinic: string;
    sources: { source: string; patients: number }[];
  } | null>(null);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    staff('/staff/growth')
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);
  if (err)
    return (
      <div className="error" role="alert">
        {err}
      </div>
    );
  if (!data) return null;
  const link = (src: string) => `${location.origin}/c/${data.slug}/checkin?src=${src}`;
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied('');
    }
  };
  return (
    <div data-testid="share-kit">
      <header className="doctor-page-heading">
        <div>
          <h1>{ui("Share your clinic")}</h1>
          <p className="muted">{ui("One link for each place you share. New patients are counted by the link they used.")}</p>
        </div>
        <button className="ghost" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
          {lang === 'en' ? 'हिन्दी' : 'English'}
        </button>
      </header>
      {CHANNELS.map((c) => (
        <section key={c.src} className="card" style={{ marginBottom: '.8rem' }}>
          <h3>{c.label}</h3>
          <p className="muted" style={{ wordBreak: 'break-all' }}>
            {link(c.src)}
          </p>
          <p>{caption(data.clinic, lang, link(c.src))}</p>
          <div className="row">
            <button
              className="small"
              onClick={() => copy(c.src, caption(data.clinic, lang, link(c.src)))}
            >
              {copied === c.src ? 'Copied' : 'Copy message'}
            </button>
            <button className="small ghost" onClick={() => copy(`${c.src}-link`, link(c.src))}>
              {copied === `${c.src}-link` ? 'Copied' : 'Copy link only'}
            </button>
          </div>
          {c.src === 'card' && (
            <div style={{ marginTop: '.6rem' }}>
              <QRCodeSVG value={link(c.src)} size={140} />
            </div>
          )}
        </section>
      ))}
      <section className="card">
        <h3>{ui("Where new patients came from (last 90 days)")}</h3>
        {data.sources.length === 0 ? (
          <p className="muted">{ui("No new patients yet.")}</p>
        ) : (
          <ul data-testid="sources">
            {data.sources.map((s) => (
              <li key={s.source}>
                {s.source === 'other' ? 'Other / direct' : s.source}: <b>{s.patients}</b>
              </li>
            ))}
          </ul>
        )}
        <p className="muted">{ui("Patients you import from an old list are not counted here. The printable reception poster is under Clinic setup.")}</p>
      </section>
    </div>
  );
}
