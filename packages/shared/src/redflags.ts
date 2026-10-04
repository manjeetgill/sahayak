import type { Lang } from './i18n/index';

/**
 * Built-in red-flag phrases (deterministic layer). Clinics may ADD phrases (stored per clinic)
 * but this list can never be reduced. Matching is case-insensitive on normalised text and covers
 * Hindi (Devanagari), Hinglish (Roman) and English.
 */
export const BUILTIN_RED_FLAGS: { topic: string; phrases: string[] }[] = [
  { topic: 'chest_pain', phrases: ['chest pain', 'pain in my chest', 'heart attack', 'seene mein dard', 'seene me dard', 'chhati mein dard', 'सीने में दर्द', 'छाती में दर्द', 'दिल का दौरा'] },
  { topic: 'breathlessness', phrases: ['breathless', "can't breathe", 'cannot breathe', 'difficulty breathing', 'short of breath', 'saans phoolna', 'saans nahi aa', 'sans phoolna', 'सांस फूल', 'साँस फूल', 'सांस नहीं', 'साँस नहीं', 'सांस लेने में तकलीफ'] },
  { topic: 'heavy_bleeding', phrases: ['heavy bleeding', 'bleeding a lot', 'bleeding heavily', "won't stop bleeding", 'bahut khoon', 'khoon nahi ruk', 'बहुत खून', 'खून नहीं रुक', 'ज्यादा खून', 'ज़्यादा खून'] },
  { topic: 'unconscious', phrases: ['unconscious', 'fainted', 'passed out', 'not responding', 'behosh', 'behoshi', 'बेहोश'] },
  { topic: 'stroke', phrases: ['stroke', 'face drooping', 'face is drooping', 'slurred speech', 'cannot speak', 'one side weak', 'lakwa', 'लकवा', 'मुंह टेढ़ा', 'बोल नहीं पा', 'zubaan lad'] },
  { topic: 'seizure', phrases: ['seizure', 'convulsion', 'fits', 'epileptic', 'daura pad', 'mirgi', 'दौरा पड़', 'मिर्गी', 'झटके'] },
  { topic: 'pregnancy', phrases: ['pregnant and bleeding', 'pregnancy bleeding', 'bleeding in pregnancy', 'baby not moving', 'water broke', 'labour pain', 'labor pain', 'garbh mein dard', 'pregnancy mein khoon', 'बच्चा हिल नहीं', 'पानी की थैली फट', 'प्रसव पीड़ा', 'गर्भावस्था में खून', 'गर्भ में दर्द'] },
  { topic: 'infant_fever', phrases: ['baby has high fever', 'infant fever', 'newborn fever', 'baby fever very high', 'bachche ko tez bukhar', 'bacche ko tez bukhar', 'baby ko tez bukhar', 'बच्चे को तेज बुखार', 'बच्चे को तेज़ बुखार', 'नवजात को बुखार'] },
  { topic: 'suicide', phrases: ['suicide', 'kill myself', 'want to die', 'end my life', 'self harm', 'aatmahatya', 'marna chahta', 'marna chahti', 'jaan dena chahta', 'आत्महत्या', 'मरना चाहता', 'मरना चाहती', 'जान देना'] },
  { topic: 'poisoning', phrases: ['poison', 'overdose', 'swallowed', 'drank phenyl', 'zeher', 'jahar', 'जहर', 'ज़हर', 'विष खा'] },
];

export function normalise(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/[‌‍]/g, '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

export interface RedFlagMatch { topic: string; phrase: string }

/** Deterministic layer. `extra` = clinic-added phrases (additive only). */
export function detectRedFlagKeywords(text: string, extra: { phrase: string; language?: Lang }[] = []): RedFlagMatch | null {
  const n = normalise(text);
  for (const g of BUILTIN_RED_FLAGS) {
    for (const p of g.phrases) if (n.includes(normalise(p))) return { topic: g.topic, phrase: p };
  }
  for (const e of extra) {
    const p = normalise(e.phrase);
    if (p && n.includes(p)) return { topic: 'clinic_defined', phrase: e.phrase };
  }
  return null;
}
