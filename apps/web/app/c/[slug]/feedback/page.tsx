'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
export default function Feedback({ params }: { params: { slug: string } }) {
  const [token, setToken] = useState(''),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [urgent, setUrgent] = useState(false),
    [stopped, setStopped] = useState(false);
  const [recovery, setRecovery] = useState(''),
    [help, setHelp] = useState('none'),
    [theme, setTheme] = useState('none'),
    [message, setMessage] = useState(''),
    [answer, setAnswer] = useState('');
  const path = `/public/${params.slug}/feedback`;
  useEffect(() => {
    let generation = 0;
    const open = () => {
      const request = ++generation;
      const t = location.hash.slice(1);
      setToken(t);
      setData(null);
      setError('');
      setDone(false);
      setStopped(false);
      setUrgent(false);
      setRecovery('');
      setHelp('none');
      setTheme('none');
      setMessage('');
      setAnswer('');
      if (!/^[a-f0-9]{64}$/.test(t)) {
        setError('This private link is incomplete. Please contact the clinic for a new link.');
        return;
      }
      api(`${path}/open`, { body: { token: t } })
        .then((d) => {
          if (generation !== request) return;
          setData(d);
          setDone(d.submitted);
        })
        .catch((e) => {
          if (generation === request) setError(e.message);
        });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => {
      generation++;
      window.removeEventListener('hashchange', open);
    };
  }, [path]);
  const hi = data?.language === 'hi';
  const label = (en: string, hindi: string) => (hi ? hindi : en);
  return (
    <main className="wrap feedback-patient" style={{ maxWidth: 640 }}>
      <a className="auth-brand" href="/">
        ✚ Sahayak
      </a>
      <h1>{data?.clinic ?? 'Patient check-in'}</h1>
      <p>
        {label(
          'Your private update helps the clinic understand what you need.',
          'आपकी निजी जानकारी से क्लिनिक आपकी ज़रूरत समझ सकता है।',
        )}
      </p>
      <p className="banner">
        {label(
          'Replies are not continuously monitored. If you need urgent help, call your local emergency service or go to the nearest emergency department. Do not wait for a reply here.',
          'उत्तर लगातार नहीं देखे जाते। आपात स्थिति में स्थानीय आपात सेवा या नज़दीकी इमरजेंसी में जाएँ। यहाँ उत्तर का इंतज़ार न करें।',
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {stopped ? (
        <p role="status">
          {label(
            'Future check-in messages have been stopped. A message already on its way may still arrive. Any concern you already reported remains available to the clinic for review.',
            'आगे के चेक-इन संदेश बंद कर दिए गए हैं। आपकी पहले भेजी गई चिंता क्लिनिक की समीक्षा के लिए उपलब्ध रहेगी।',
          )}
        </p>
      ) : done ? (
        <section className="card" role="status">
          <h2>
            {label('Thank you. Your response is saved.', 'धन्यवाद। आपका उत्तर सहेज लिया गया है।')}
          </h2>
          <p>
            {label(
              'The clinic team can review it. This is not confirmation that a doctor has read it.',
              'क्लिनिक टीम इसकी समीक्षा कर सकती है। इसका अर्थ यह नहीं कि डॉक्टर ने इसे पढ़ लिया है।',
            )}
          </p>
          {urgent && (
            <p className="banner urgent" role="alert">
              {label(
                'Your message may describe an emergency. Seek emergency help now; do not wait for this inbox.',
                'आपका संदेश आपात स्थिति का संकेत हो सकता है। तुरंत आपात सहायता लें; उत्तर का इंतज़ार न करें।',
              )}
            </p>
          )}
        </section>
      ) : (
        data && (
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const result = await api(
                  `${path}/${data.purpose === 'resolution' ? 'resolution' : 'response'}`,
                  {
                    body:
                      data.purpose === 'resolution'
                        ? { token, answer }
                        : { token, recovery, help, theme, message },
                  },
                );
                setUrgent(!!result.urgent);
                setDone(true);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {data.purpose === 'resolution' ? (
              <fieldset>
                <legend>
                  {label('Were we able to address your concern?', 'क्या आपकी चिंता का समाधान हुआ?')}
                </legend>
                {[
                  ['yes', 'Yes', 'हाँ'],
                  ['partly', 'Partly', 'कुछ हद तक'],
                  ['help', 'I still need help', 'मुझे अभी भी मदद चाहिए'],
                ].map(([value, en, hn]) => (
                  <label className="check" key={value}>
                    <input
                      type="radio"
                      name="answer"
                      value={value}
                      required
                      checked={answer === value}
                      onChange={() => setAnswer(value)}
                    />
                    {label(en, hn)}
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <fieldset>
                  <legend>
                    {label(
                      'How are you feeling since your visit?',
                      'विज़िट के बाद आप कैसा महसूस कर रहे हैं?',
                    )}
                  </legend>
                  {[
                    ['better', 'Better', 'बेहतर'],
                    ['same', 'About the same', 'लगभग वैसा ही'],
                    ['worse', 'Worse', 'पहले से खराब'],
                    ['callback', 'Please contact me', 'कृपया मुझसे संपर्क करें'],
                  ].map(([value, en, hn]) => (
                    <label className="check" key={value}>
                      <input
                        type="radio"
                        name="recovery"
                        value={value}
                        required
                        checked={recovery === value}
                        onChange={() => setRecovery(value)}
                      />
                      {label(en, hn)}
                    </label>
                  ))}
                </fieldset>
                <label>
                  {label('What do you need help with?', 'आपको किस बारे में मदद चाहिए?')}
                  <select value={help} onChange={(e) => setHelp(e.target.value)}>
                    {[
                      ['none', 'Nothing right now', 'अभी कुछ नहीं'],
                      ['instructions', 'Understanding instructions', 'निर्देश समझना'],
                      ['medicine', 'A medicine question', 'दवा का सवाल'],
                      ['next_steps', 'What to do next', 'आगे क्या करें'],
                      ['visit', 'A problem with my visit', 'विज़िट की समस्या'],
                      ['other', 'Something else', 'कुछ और'],
                    ].map(([v, en, hn]) => (
                      <option key={v} value={v}>
                        {label(en, hn)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {label(
                    'What could the clinic improve? (optional)',
                    'क्लिनिक क्या बेहतर कर सकता है? (वैकल्पिक)',
                  )}
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    {[
                      ['none', 'No feedback to add', 'अभी कोई सुझाव नहीं'],
                      ['waiting', 'Waiting time', 'इंतज़ार का समय'],
                      ['explanation', 'Clearer explanations', 'स्पष्ट जानकारी'],
                      ['staff', 'Staff behaviour', 'स्टाफ का व्यवहार'],
                      ['fees', 'Fees', 'फीस'],
                      ['booking', 'Booking', 'बुकिंग'],
                      ['other', 'Something else', 'कुछ और'],
                    ].map(([v, en, hn]) => (
                      <option key={v} value={v}>
                        {label(en, hn)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {label(
                    'Tell us in your own words (optional)',
                    'अपने शब्दों में बताइए (वैकल्पिक)',
                  )}
                  <textarea
                    maxLength={2000}
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </label>
              </>
            )}
            <p className="muted">
              {label(
                'Only the clinic team can view this response. This form does not give medical advice or change your treatment.',
                'यह उत्तर केवल क्लिनिक टीम देख सकती है। यह फ़ॉर्म चिकित्सा सलाह या उपचार में बदलाव नहीं करता।',
              )}
            </p>
            <button disabled={busy}>
              {busy
                ? label('Saving…', 'सहेज रहे हैं…')
                : label('Send my response', 'मेरा उत्तर भेजें')}
            </button>
          </form>
        )
      )}
      {data && !stopped && (
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`${path}/stop`, { body: { token } });
              setStopped(true);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label('Stop future check-in messages', 'आगे के चेक-इन संदेश बंद करें')}
        </button>
      )}
    </main>
  );
}
