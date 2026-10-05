'use client';
import { useState } from 'react';
import { staff } from '../../../../lib/api';

const scenarios = [
  [
    'Clinic timings',
    'What are your clinic timings?',
    'क्लिनिक का समय क्या है?',
    'Answers using clinic information.',
  ],
  [
    'Appointment enquiry',
    'I want to book an appointment',
    'मुझे अपॉइंटमेंट बुक करना है',
    'Starts the appointment or new enquiry flow.',
  ],
  [
    'Ask for the receptionist',
    'I want to talk to a person',
    'मुझे रिसेप्शनिस्ट से बात करनी है',
    'Hands the conversation to a human.',
  ],
  [
    'Emergency',
    'I have severe chest pain and cannot breathe',
    'मेरे सीने में दर्द है और सांस नहीं आ रही',
    'Shows emergency guidance and raises an urgent flag.',
  ],
  [
    'Medical question',
    'Which medicine should I take for fever?',
    'बुखार के लिए कौन सी दवा लूं?',
    'Declines medical advice and directs the patient to a clinician.',
  ],
];
export function GuidedTest({ channel }: { channel: 'whatsapp' | 'voice' }) {
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [scenario, setScenario] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // Each scenario starts a separate conversation; prior handoffs cannot hide the result.
      const from =
        '+1999' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => n % 10).join('');
      setResult(
        await staff('/staff/agents/test', {
          from,
          channel,
          language,
          text: scenarios[scenario][language === 'en' ? 1 : 2],
        }),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3>Try a practice conversation</h3>
      <p>
        No WhatsApp message is delivered and no phone is dialled by this test. It uses a generated
        test contact and stores a conversation in this clinic. Example to trys may create enquiries or
        alerts for staff. Mark practice alerts as handled afterwards. The configured AI service may process the
        sample text.
      </p>
      <label>
        Language
        <select
          value={language}
          disabled={busy}
          onChange={(e) => {
            setLanguage(e.target.value as 'en' | 'hi');
            setResult(null);
          }}
        >
          <option value="en">English</option>
          <option value="hi">हिन्दी</option>
        </select>
      </label>
      <label>
        Example to try
        <select
          value={scenario}
          disabled={busy}
          onChange={(e) => {
            setScenario(Number(e.target.value));
            setResult(null);
          }}
        >
          {scenarios.map(([name], i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <blockquote>{scenarios[scenario][language === 'en' ? 1 : 2]}</blockquote>
      <p>
        <b>What should happen:</b> {scenarios[scenario][3]}
      </p>
      <label className="check">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        I understand this creates test records in this clinic.
      </label>
      <button disabled={busy || !accepted} onClick={() => void run()}>
        {busy ? 'Testing…' : 'Try this example'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <h4>Assistant’s reply</h4>
          {result.replies.map((text: string, i: number) => (
            <p key={i}>{text}</p>
          ))}
          <p>
            Reply handled by: {result.handledBy === 'human' ? 'Reception team' : 'Clinic assistant'}{' '}
            · Emergency alert raised: {result.redFlag ? 'Yes' : 'No'}
          </p>
          <p>
            Compare this response with the expected behaviour. This does not send a real message or make a call.
          </p>
        </div>
      )}
    </section>
  );
}
