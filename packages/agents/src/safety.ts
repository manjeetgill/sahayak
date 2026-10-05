import { detectRedFlagKeywords, normalise, type Lang } from '@sahayak/shared';
import type { LlmGate } from './llm';

/** Language of a message: Devanagari => Hindi, otherwise the fallback (Hinglish keeps the conversation language). */
export function detectLang(text: string, fallback: Lang): Lang {
  return /[ऀ-ॿ]/.test(text) ? 'hi' : fallback;
}

export interface RedFlagResult {
  hit: boolean;
  topic?: string;
  source?: 'keywords' | 'classifier';
}

const CLASSIFIER_PROMPT = `You are a safety classifier for a clinic front desk. Messages may be in English, Hindi or Hinglish.
Decide if the message describes a possible medical EMERGENCY or self-harm risk happening now (e.g. chest pain, trouble breathing, heavy bleeding, unconscious, stroke signs, seizure, pregnancy complication, very high fever in an infant, suicidal thoughts, poisoning).
Reply ONLY with JSON: {"emergency": true|false, "topic": "<short topic>"}. When unsure, answer true.`;

/**
 * Two layers, run on EVERY patient message before any agent replies.
 * Layer 1 is deterministic (built-in list + clinic additions). Layer 2 is an LLM classifier.
 * Either one triggering is a red flag. If the LLM is down, layer 1 still protects.
 */
export async function checkRedFlag(
  gate: LlmGate | null,
  text: string,
  clinicPhrases: { phrase: string }[],
): Promise<RedFlagResult> {
  const k = detectRedFlagKeywords(text, clinicPhrases);
  if (k) return { hit: true, topic: k.topic, source: 'keywords' };
  if (gate?.available()) {
    try {
      const r = await gate.chat({
        messages: [
          { role: 'system', content: CLASSIFIER_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0,
        maxTokens: 60,
        // Every message still runs the classifier; slow inference falls back to
        // the existing deterministic safety layer without repeated waits.
        timeoutMs: 1500,
        retries: 0,
      });
      const m = (r.content ?? '').match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (j.emergency === true)
          return { hit: true, topic: String(j.topic ?? 'unspecified'), source: 'classifier' };
      }
    } catch {
      /* LLM failure never blocks the flow; the deterministic layer already ran */
    }
  }
  return { hit: false };
}

const MEDICAL_Q = [
  /\b(should i|can i|may i)\b.*\b(take|eat|drink|stop|skip|use|apply)\b/,
  /\bwhich (medicine|tablet|drug|antibiotic)\b/,
  /\b(dose|dosage|how many tablets|how much (medicine|paracetamol))\b/,
  /\b(is it|is this) (serious|dangerous|normal|safe|cancer)\b/,
  /\bwhat (is|could be) (wrong|this|causing)\b/,
  /\bside ?effects?\b/,
  /\b(diagnos|symptom|prescri|treatment for|cure for|remedy)\w*/,
  /\bwhy (do|am) i (have|feel|getting)\b/,
  /\b(dawai|dawa|davai|goli|tablet)\b.*\b(kab|kitni|le sakta|le sakti|khaun|khani)\b/,
  /\b(kya|kaun si) (dawai|dawa|goli)\b/,
  /\bdawai (bata|batao)\b/,
  /\bkya (ye|yeh|mujhe) .*(serious|gambhir|khatarnak|bimari)\b/,
  /\bpet (me|mein) dard\b.*\bkya\b/,
  /दवा|दवाई|गोली|खुराक|इलाज|साइड इफेक्ट|बीमारी क्या|क्या यह (गंभीर|खतरनाक)|क्या मैं .*(ले|खा) सकता|क्या मैं .*(ले|खा) सकती|कौन सी दवा/,
];
export function isMedicalQuestion(text: string): boolean {
  const n = normalise(text);
  return MEDICAL_Q.some((r) => r.test(n));
}

const HUMAN = [
  /\b(talk|speak|connect|chat) (to|with) (a |the )?(person|human|someone|receptionist|staff|doctor|agent)\b/,
  /\b(real|actual) (person|human)\b/,
  /\breceptionist\b/,
  /\bhuman\b/,
  /\bcall me\b/,
  /\bbaat karni\b/,
  /\bkisi se baat\b/,
  /इंसान से|किसी से बात|रिसेप्शनिस्ट|व्यक्ति से बात|मुझसे बात करो|बात करनी/,
];
export function wantsHuman(text: string): boolean {
  const n = normalise(text);
  return HUMAN.some((r) => r.test(n));
}

const UPSET = [
  /\b(useless|worst|terrible|pathetic|rude|angry|furious|disgusting|fed up|complaint|unacceptable|waste of time|cheated|fraud)\b/,
  /\b(bakwaas|bekaar|gussa|ghatiya|shikayat|pareshan)\b/,
  /बकवास|बेकार|गुस्सा|घटिया|शिकायत|परेशान/,
];
export function isUpset(text: string): boolean {
  const n = normalise(text);
  return UPSET.some((r) => r.test(n));
}

const QUEUE_JUMP = [
  /\b(put me|make me|move me|take me) (first|ahead|up|next)\b/,
  /\b(skip|jump) (the )?(queue|line)\b/,
  /\b(go|see the doctor) first\b/,
  /\bpehle (bhej|dikha|bula)\w*/,
  /\bjaldi\b.*\b(number|baari|bari)\b/,
  /मुझे पहले|पहले भेज|पहले बुला|पहले दिखा|कतार में आगे/,
];
export function wantsQueueJump(text: string): boolean {
  const n = normalise(text);
  return QUEUE_JUMP.some((r) => r.test(n));
}

export { violatesMedicalPolicy } from '@sahayak/shared';
