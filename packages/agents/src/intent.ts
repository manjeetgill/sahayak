import { normalise } from '@sahayak/shared';

export type Intent =
  | 'queue_status'
  | 'timings'
  | 'address'
  | 'book'
  | 'cancel'
  | 'reschedule'
  | 'greeting'
  | 'thanks'
  | 'yes'
  | 'no'
  | 'number'
  | 'other';

const R: [Intent, RegExp][] = [
  ['cancel', /\b(cancel|cancle|radd|raddh)\b|रद्द|कैंसल/],
  [
    'reschedule',
    /\b(reschedule|postpone|change (my )?(appointment|time|slot)|move (my )?appointment|dusra time|time badal)\b|बदल(ना|ें)|दूसरा समय|समय बदल/,
  ],
  [
    'book',
    /\b(book|booking|appointment|appoint|slot|available|availability|see (the )?doctor|consult|mil(na|ne)|milna chahta|dikhana)\b|अपॉइंटमेंट|बुक|मिलना|दिखाना|उपलब्ध/,
  ],
  [
    'queue_status',
    /\b(my (turn|token|number)|token|how long|how much longer|wait(ing)?( time)?|when (is|will).*(turn|my)|kitna time|kab tak|meri baari|meri bari|number kab)\b|मेरी बारी|टोकन|कितना समय|कब तक|कितनी देर/,
  ],
  [
    'timings',
    /\b(timing|timings|time|open|opening|close|closing|hours|schedule|when are you|kab (khul|band)|samay|kitne baje)\b|समय|खुला|खुलता|बंद|कब से कब|कितने बजे/,
  ],
  [
    'address',
    /\b(address|location|where|direction|directions|route|map|near|kahan|pata|parking)\b|पता|कहाँ|कहां|लोकेशन|रास्ता|पार्किंग/,
  ],
  ['thanks', /^(thanks?|thank you|thx|shukriya|dhanyavad|ok thanks?)\b|^(धन्यवाद|शुक्रिया)/],
  [
    'greeting',
    /^(hi+|hello+|hey+|namaste|namaskar|good (morning|afternoon|evening)|hii+|helo)\b|^(नमस्ते|नमस्कार|हेलो|हाय)/,
  ],
  [
    'yes',
    /^(yes|y|yeah|yep|ok|okay|sure|haan|han|ha|ji|ji haan|theek hai)\b|^(हाँ|हां|जी|ठीक है|जी हाँ)/,
  ],
  ['no', /^(no|n|nope|nahi|nahin|na)\b|^(नहीं|ना)/],
  ['number', /^\s*\d{1,2}\s*[).]?\s*$/],
];

export function classifyIntent(text: string): Intent {
  const n = normalise(text);
  // Order: number/yes/no first (short replies inside a flow), then topical intents.
  for (const k of ['number', 'yes', 'no'] as Intent[]) {
    const hit = R.find(([i]) => i === k)!;
    if (hit[1].test(n)) return k;
  }
  for (const [i, re] of R)
    if (!['number', 'yes', 'no', 'greeting', 'thanks'].includes(i) && re.test(n)) return i;
  for (const k of ['thanks', 'greeting'] as Intent[]) {
    const hit = R.find(([i]) => i === k)!;
    if (hit[1].test(n)) return k;
  }
  return 'other';
}

export function parseChoice(text: string, max: number): number | null {
  const m = normalise(text).match(/^\s*(\d{1,2})\s*[).]?\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}
