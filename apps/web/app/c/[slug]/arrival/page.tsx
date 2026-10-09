'use client';
import { useEffect, useRef, useState } from 'react';
import { PatientOnlinePayment } from '../../../components/PatientOnlinePayment';
import { api } from '../../../../lib/api';
export default function Arrival({ params }: { params: { slug: string } }) {
  const [info, setInfo] = useState<any>(null),
    [settings, setSettings] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [waitingBusy, setWaitingBusy] = useState(false),
    [waitingAnswer, setWaitingAnswer] = useState(''),
    [waitingUrgent, setWaitingUrgent] = useState(false),
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
    evening: false,
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
            evening_checkins: form.evening && form.whatsapp && form.followup,
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
          settings?.onlinePaymentEnabled
            ? '1. Your details → 2. Pay online or at reception → 3. Join the doctor’s queue'
            : '1. Your details → 2. Pay at reception → 3. Join the doctor’s queue',
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
              {receipt.onlineState === 'review' && (
                <p role="alert">
                  {text(
                    'Payment needs reception review. Do not pay again.',
                    'रिसेप्शन से भुगतान की जांच करवाएं। दोबारा भुगतान न करें।',
                  )}
                </p>
              )}
              {(settings?.onlinePaymentEnabled || receipt.onlineState) &&
                receipt.status !== 'queued' && (
                  <PatientOnlinePayment
                    slug={params.slug}
                    token={token}
                    mode={settings?.paymentMode ?? 'test'}
                    onlineState={receipt.onlineState}
                    enabled={!!settings?.onlinePaymentEnabled}
                    hi={hi}
                  />
                )}
              {receipt.status === 'awaiting_payment' ? (
                <>
                  <h3>{text('Details received', 'जानकारी मिल गई')}</h3>
                  <p>
                    {text('Consultation fee', 'परामर्श शुल्क')}{' '}
                    <strong>₹{(receipt.amountPaise / 100).toFixed(2)}</strong>{' '}
                    {text(
                      receipt.onlineState
                        ? 'Online payment is in progress. Check payment status above before paying again.'
                        : 'Pay at reception, or online if available above. Your queue token appears here after payment is confirmed.',
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
                      ? text(
                          receipt.testPayment
                            ? 'Test payment verified — no real money collected'
                            : 'Payment recorded',
                          receipt.testPayment
                            ? 'टेस्ट भुगतान की पुष्टि — असली पैसे नहीं लिए गए'
                            : 'भुगतान दर्ज है',
                        )
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
                  {receipt.visitStatus === 'done' && receipt.feedbackWorkStatus === 'planned' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const link = await api(`/public/${params.slug}/arrival/feedback-link`, {
                            body: { accessToken: token },
                          });
                          location.href = link.path;
                        } catch (err: any) {
                          setError(err.message);
                          setBusy(false);
                        }
                      }}
                    >
                      {text(
                        'How was your visit? Tell the clinic',
                        'आपकी विज़िट कैसी रही? क्लिनिक को बताएं',
                      )}
                    </button>
                  )}
                  {receipt.visitStatus === 'waiting' &&
                    receipt.waitingQuestionEnabled &&
                    (receipt.waitingAnswer ? (
                      <p>
                        <strong>
                          {text('Your note for the doctor:', 'डॉक्टर के लिए आपकी बात:')}
                        </strong>{' '}
                        {receipt.waitingAnswer}
                      </p>
                    ) : (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setWaitingBusy(true);
                          setError('');
                          try {
                            const result = await api(
                              `/public/${params.slug}/arrival/waiting-answer`,
                              { body: { accessToken: token, answer: waitingAnswer } },
                            );
                            setWaitingUrgent(!!result.urgent);
                            setReceipt((r: any) => ({ ...r, waitingAnswer }));
                          } catch (err: any) {
                            setError(err.message);
                          } finally {
                            setWaitingBusy(false);
                          }
                        }}
                      >
                        <label htmlFor="waiting-answer">
                          {text(
                            'While you wait, is there one thing you want the doctor to know or ask?',
                            'इंतज़ार करते समय, क्या आप डॉक्टर को कुछ बताना या पूछना चाहते हैं?',
                          )}
                        </label>
                        <textarea
                          id="waiting-answer"
                          required
                          maxLength={1000}
                          rows={3}
                          value={waitingAnswer}
                          onChange={(e) => setWaitingAnswer(e.target.value)}
                        />
                        <button disabled={waitingBusy}>
                          {text('Send to doctor', 'डॉक्टर को भेजें')}
                        </button>
                        <p className="muted">
                          {text(
                            'The doctor can read this before your consultation. For urgent symptoms, tell reception immediately.',
                            'डॉक्टर इसे परामर्श से पहले पढ़ सकते हैं। तत्काल परेशानी हो तो रिसेप्शन को अभी बताएं।',
                          )}
                        </p>
                      </form>
                    ))}
                  {waitingUrgent && (
                    <p className="banner urgent" role="alert">
                      {text(
                        'Your message may describe an emergency. Tell reception now or seek urgent care. Do not wait in the queue.',
                        'आपका संदेश आपात स्थिति का संकेत हो सकता है। अभी रिसेप्शन को बताएं या तुरंत सहायता लें। कतार में प्रतीक्षा न करें।',
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
            {text(
              settings?.onlinePaymentEnabled ? 'Pay online or at reception' : 'Pay at reception',
              settings?.onlinePaymentEnabled
                ? 'ऑनलाइन या रिसेप्शन पर भुगतान करें'
                : 'रिसेप्शन पर भुगतान करें',
            )}
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
              onChange={(e) =>
                setForm({
                  ...form,
                  whatsapp: e.target.checked,
                  evening: e.target.checked ? form.evening : false,
                })
              }
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
              onChange={(e) =>
                setForm({
                  ...form,
                  followup: e.target.checked,
                  evening: e.target.checked ? form.evening : false,
                })
              }
            />
            {text(
              'Contact me for follow-ups and feedback after my visit (optional). I can reply STOP.',
              'विज़िट के बाद फ़ॉलो-अप और फीडबैक के लिए संपर्क करें (वैकल्पिक)। मैं STOP भेजकर बंद कर सकता/सकती हूं।',
            )}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.evening}
              disabled={!form.whatsapp || !form.followup}
              onChange={(e) => setForm({ ...form, evening: e.target.checked })}
            />
            {text(
              'After each visit, send me an evening “how are you feeling?” message for up to 3 nights (optional). I can reply EVENING STOP any time.',
              'हर विज़िट के बाद अधिकतम 3 शाम तक मेरा हाल पूछने वाला संदेश भेजें (वैकल्पिक)। मैं कभी भी EVENING STOP लिखकर बंद कर सकता/सकती हूं।',
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
