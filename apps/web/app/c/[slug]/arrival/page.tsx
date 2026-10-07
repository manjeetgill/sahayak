'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
export default function Arrival({ params }: { params: { slug: string } }) {
  const [info, setInfo] = useState<any>(null),
    [settings, setSettings] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(''),
    [receipt, setReceipt] = useState<any>(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    doctorId: '',
    language: 'en',
    visit: false,
    whatsapp: false,
    followup: false,
  });
  const attempt = useRef('');
  const hi = form.language === 'hi';
  const text = (en: string, hn: string) => (hi ? hn : en);
  useEffect(() => {
    const raw = location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(raw)) setToken(raw);
    Promise.all([api(`/public/${params.slug}`), api(`/public/${params.slug}/arrival/setup`)])
      .then(([i, s]) => {
        setInfo(i);
        setSettings(s);
        setForm((f) => ({ ...f, doctorId: i.doctors[0]?.id ?? '', language: i.defaultLanguage }));
      })
      .catch((e) => setError(e.message));
  }, [params.slug]);
  useEffect(() => {
    if (!token) return;
    let stop = false;
    const refresh = () =>
      api(`/public/${params.slug}/arrival/status`, { body: { accessToken: token } })
        .then((r) => {
          if (!stop) {
            setReceipt(r);
            setError('');
          }
        })
        .catch((e) => {
          if (!stop) setError(e.message);
        });
    void refresh();
    const t = setInterval(() => void refresh(), 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token, params.slug]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    if (!attempt.current) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      attempt.current = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      await api(`/public/${params.slug}/arrival`, {
        body: {
          name: form.name,
          phone: form.phone.replace(/[\s-]/g, ''),
          doctorId: form.doctorId,
          language: form.language,
          consent: {
            visit_data: form.visit,
            whatsapp_messaging: form.whatsapp,
            reminders_followups: form.followup,
          },
          accessToken: attempt.current,
        },
      });
      history.replaceState(null, '', `#${attempt.current}`);
      setToken(attempt.current);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="wrap checkin-page">
      <h1>{info?.clinic ?? 'Clinic check-in'}</h1>
      <button className="ghost" onClick={() => setForm({ ...form, language: hi ? 'en' : 'hi' })}>
        {hi ? 'English' : 'हिन्दी'}
      </button>
      <p>
        {text(
          '1. Your details → 2. Pay at reception → 3. Join the doctor’s queue',
          '1. अपनी जानकारी → 2. रिसेप्शन पर भुगतान → 3. डॉक्टर की कतार',
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {token ? (
        <section className="card" role="status">
          {receipt ? (
            <>
              <h2>{text('Your visit status', 'आपकी विज़िट की स्थिति')}</h2>
              <p>
                {text('Reference', 'संदर्भ')}: <strong>{receipt.reference}</strong>
              </p>
              <p>{receipt.doctor}</p>
              {receipt.status === 'awaiting_payment' ? (
                <>
                  <h3>{text('Details received', 'जानकारी मिल गई')}</h3>
                  <p>
                    {text('Please pay', 'कृपया भुगतान करें')}{' '}
                    <strong>₹{(receipt.amountPaise / 100).toFixed(2)}</strong>{' '}
                    {text(
                      'at reception. Show this screen. Your queue token appears here after staff confirms payment.',
                      'रिसेप्शन पर। यह स्क्रीन दिखाएं। भुगतान की पुष्टि के बाद टोकन यहां दिखेगा।',
                    )}
                  </p>
                </>
              ) : receipt.status === 'cancelled' ? (
                <p>
                  {text(
                    'This check-in was cancelled. Please contact reception.',
                    'यह चेक-इन रद्द हो गया। रिसेप्शन से संपर्क करें।',
                  )}
                </p>
              ) : (
                <>
                  <p>
                    {receipt.paidPaise >= receipt.amountPaise
                      ? text('Payment recorded', 'भुगतान दर्ज है')
                      : text(
                          'Payment record needs reception review',
                          'भुगतान की जानकारी रिसेप्शन से जांचें',
                        )}
                  </p>
                  <div className="token">{receipt.token}</div>
                  <h3>
                    {receipt.visitStatus === 'done'
                      ? text('Consultation complete', 'परामर्श पूरा हुआ')
                      : ['called', 'in_consultation'].includes(receipt.visitStatus)
                        ? text('The doctor is ready for you', 'डॉक्टर आपके लिए तैयार हैं')
                        : receipt.visitStatus === 'waiting'
                          ? text('You are in the queue', 'आप कतार में हैं')
                          : text('Please check with reception', 'कृपया रिसेप्शन से पूछें')}
                  </h3>
                  {receipt.feedbackAt && (
                    <p>
                      {text(
                        'Your clinic check-in is scheduled for',
                        'आपकी अगली जानकारी लेने का समय',
                      )}{' '}
                      {new Date(receipt.feedbackAt).toLocaleString(hi ? 'hi-IN' : 'en-IN')}.{' '}
                      {text(
                        'WhatsApp delivery depends on the clinic’s connection and your permission.',
                        'WhatsApp संदेश क्लिनिक के कनेक्शन और आपकी अनुमति पर निर्भर है।',
                      )}
                    </p>
                  )}
                </>
              )}
              <p className="muted">
                {text(
                  'This page updates automatically. Keep this private link on your phone.',
                  'यह पेज अपने आप अपडेट होता है। इस निजी लिंक को अपने फोन में रखें।',
                )}
              </p>
            </>
          ) : (
            <p>{text('Loading your visit…', 'आपकी विज़िट लोड हो रही है…')}</p>
          )}
        </section>
      ) : settings && !settings.enabled ? (
        <p>
          {text(
            'Please check in with reception. QR payment check-in is not enabled yet.',
            'कृपया रिसेप्शन पर चेक-इन करें। QR भुगतान चेक-इन अभी चालू नहीं है।',
          )}
        </p>
      ) : info && settings ? (
        <form className="card" onSubmit={submit}>
          <h2>{text('Patient details', 'मरीज़ की जानकारी')}</h2>
          <label htmlFor="arrival-name">{text('Patient name', 'मरीज़ का नाम')}</label>
          <input
            id="arrival-name"
            required
            maxLength={100}
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label htmlFor="arrival-phone">{text('Mobile number', 'मोबाइल नंबर')}</label>
          <input
            id="arrival-phone"
            type="tel"
            required
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <label htmlFor="arrival-doctor">{text('Doctor', 'डॉक्टर')}</label>
          <select
            id="arrival-doctor"
            value={form.doctorId}
            required
            onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
          >
            {info.doctors.map((d: any) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p>
            {text('Consultation fee', 'परामर्श शुल्क')}:{' '}
            <strong>₹{(settings.amountPaise / 100).toFixed(2)}</strong> ·{' '}
            {text('Pay at reception', 'रिसेप्शन पर भुगतान करें')}
          </p>
          <label className="check">
            <input
              type="checkbox"
              required
              checked={form.visit}
              onChange={(e) => setForm({ ...form, visit: e.target.checked })}
            />
            {text(
              'I agree to the clinic recording my details for this visit.',
              'मैं इस विज़िट के लिए अपनी जानकारी दर्ज करने की अनुमति देता/देती हूं।',
            )}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })}
            />
            {text(
              'Send me visit updates on WhatsApp (optional).',
              'मुझे WhatsApp पर विज़िट की जानकारी भेजें (वैकल्पिक)।',
            )}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.followup}
              onChange={(e) => setForm({ ...form, followup: e.target.checked })}
            />
            {text(
              'Contact me for follow-ups and feedback after my visit (optional). I can reply STOP.',
              'विज़िट के बाद फ़ॉलो-अप और फीडबैक के लिए संपर्क करें (वैकल्पिक)। मैं STOP भेजकर बंद कर सकता/सकती हूं।',
            )}
          </label>
          <p>
            <button disabled={busy}>
              {busy
                ? text('Saving…', 'सहेजा जा रहा है…')
                : text(
                    'Submit details & pay at reception',
                    'जानकारी जमा करें और रिसेप्शन पर भुगतान करें',
                  )}
            </button>
          </p>
        </form>
      ) : (
        <p>Loading…</p>
      )}
    </main>
  );
}
