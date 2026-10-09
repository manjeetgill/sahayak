'use client';
import { useEffect, useRef, useState } from 'react';
import { staff } from '../../lib/api';
import { useStaffLang } from '../../lib/staffText';

export function ConversationCapture({
  patientId,
  canStart,
  onBegin,
  onSegment,
  onRecordingChange,
  onFinish,
}: {
  patientId: string;
  canStart: boolean;
  onBegin: (consentId: string) => void;
  onSegment: (speaker: 'Doctor' | 'Patient', words: string) => void;
  onRecordingChange: (recording: boolean) => void;
  onFinish: (hasTranscript: boolean) => void;
}) {
  const { lang: uiLang } = useStaffLang();
  const hi = uiLang === 'hi';
  const [agreed, setAgreed] = useState(false);
  const [speaker, setSpeaker] = useState<'Doctor' | 'Patient'>('Patient');
  const [language, setLanguage] = useState<'hi-IN' | 'en-IN'>('hi-IN');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<any>(null);
  const consent = useRef('');
  const nextSpeaker = useRef<'Doctor' | 'Patient' | null>(null);
  const keepAlive = useRef(false);
  const segmentCount = useRef(0);

  const finish = async () => {
    keepAlive.current = false;
    setRecording(false);
    onRecordingChange(false);
    const id = consent.current;
    consent.current = '';
    if (id) {
      onFinish(segmentCount.current > 0);
      try {
        await staff(`/staff/conversation-capture/${id}/stop`, {});
      } catch (e: any) {
        setError(e.message);
      }
    }
  };
  const startTurn = (SR: any, turnSpeaker: 'Doctor' | 'Patient') => {
    const r = new SR();
    r.lang = language;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const words = String(event.results[i][0]?.transcript ?? '').trim();
        if (words) {
          segmentCount.current += 1;
          onSegment(turnSpeaker, words);
        }
      }
    };
    r.onerror = (event: any) => {
      keepAlive.current = false;
      setError(`${hi ? 'बोलकर लिखना रुका' : 'Speech capture stopped'}: ${event.error}`);
    };
    r.onend = () => {
      const next = nextSpeaker.current;
      nextSpeaker.current = null;
      if (keepAlive.current && consent.current) {
        try {
          startTurn(SR, next ?? turnSpeaker);
        } catch (e: any) {
          setError(e.message);
          void finish();
        }
      } else void finish();
    };
    recognition.current = r;
    r.start();
  };
  useEffect(
    () => () => {
      keepAlive.current = false;
      nextSpeaker.current = null;
      recognition.current?.abort();
      const id = consent.current;
      if (id) void staff(`/staff/conversation-capture/${id}/stop`, {}).catch(() => {});
    },
    [],
  );

  const begin = async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR)
      return setError(
        hi
          ? 'इस ब्राउज़र में बोलकर लिखना उपलब्ध नहीं है। Chrome आज़माएँ।'
          : 'Speech capture is unavailable in this browser. Try Chrome.',
      );
    if (!agreed || !canStart) return;
    setError('');
    setBusy(true);
    try {
      // The server records consent before the microphone can start.
      const result = await staff<{ consentId: string }>(
        `/staff/patients/${patientId}/conversation-capture`,
        {},
      );
      consent.current = result.consentId;
      segmentCount.current = 0;
      keepAlive.current = true;
      onBegin(result.consentId);
      startTurn(SR, speaker);
      setRecording(true);
      onRecordingChange(true);
    } catch (e: any) {
      setError(e.message);
      await finish();
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="conversation-capture" open={recording}>
      <summary>
        {hi ? 'सहमति लेकर बातचीत से नोट बनाएँ' : 'Capture a consultation with patient consent'}
      </summary>
      <p className="muted">
        {hi
          ? 'मरीज़ की सहमति के बाद माइक्रोफ़ोन चालू करें। डॉक्टर और मरीज़ बोलने से पहले सही वक्ता चुनें। ब्राउज़र की बोलकर लिखने की सेवा आवाज़ को प्रोसेस कर सकती है। सहायक केवल लिखी बातचीत सहेजता है, ऑडियो नहीं।'
          : 'Get the patient’s agreement before turning on the microphone. Choose Doctor or Patient before each person speaks. Browser speech recognition may process audio through its speech service. Sahayak stores the transcript, not audio.'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!recording && (
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {hi
            ? 'मरीज़ ने बातचीत को लिखकर ड्राफ्ट नोट बनाने की सहमति दी है।'
            : 'The patient agreed to capture speech for a draft visit note.'}
        </label>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label>
          {hi ? 'अभी कौन बोल रहा है?' : 'Who is speaking?'}
          <select
            value={speaker}
            onChange={(e) => {
              const next = e.target.value as 'Doctor' | 'Patient';
              setSpeaker(next);
              if (recording) {
                nextSpeaker.current = next;
                recognition.current?.stop();
              }
            }}
          >
            <option value="Patient">{hi ? 'मरीज़' : 'Patient'}</option>
            <option value="Doctor">{hi ? 'डॉक्टर' : 'Doctor'}</option>
          </select>
        </label>
        <label>
          {hi ? 'बोली' : 'Speech language'}
          <select
            value={language}
            disabled={recording}
            onChange={(e) => setLanguage(e.target.value as 'hi-IN' | 'en-IN')}
          >
            <option value="hi-IN">हिन्दी</option>
            <option value="en-IN">{hi ? 'अंग्रेज़ी' : 'English'}</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={busy || (!recording && (!agreed || !canStart))}
        onClick={() => {
          if (recording) {
            keepAlive.current = false;
            nextSpeaker.current = null;
            recognition.current?.stop();
          } else void begin();
        }}
      >
        {recording
          ? hi
            ? '■ बातचीत रोकें'
            : '■ Stop capture'
          : hi
            ? '🎤 बातचीत शुरू करें'
            : '🎤 Start capture'}
      </button>
      {!canStart && !recording && (
        <p className="muted">
          {hi
            ? 'पहले मौजूदा नोट पूरा करें या साफ़ करें, फिर नई बातचीत शुरू करें।'
            : 'Finish or clear the current note before starting a new capture.'}
        </p>
      )}
      {recording && (
        <p role="status">
          {hi
            ? 'माइक्रोफ़ोन चालू है। वक्ता बदलें जब बोलने वाला बदले।'
            : 'Microphone on. Change the speaker when the person speaking changes.'}
        </p>
      )}
    </details>
  );
}
