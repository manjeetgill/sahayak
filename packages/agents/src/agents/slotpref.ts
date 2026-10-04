import { normalise } from '@sahayak/shared';

export interface SlotPreference {
  /** Search from this clinic-local date (YYYY-MM-DD) onward. */
  date?: string;
  /** Time-of-day window, clinic local "HH:MM". */
  from?: string;
  to?: string;
  /** "earliest / any time / next available". */
  asap?: boolean;
}

const DAYS: [number, RegExp][] = [
  [1, /\b(monday|mon|somvar|somwar)\b|सोमवार/],
  [2, /\b(tuesday|tue|tues|mangalvar|mangalwar)\b|मंगलवार/],
  [3, /\b(wednesday|wed|budhvar|budhwar)\b|बुधवार/],
  [
    4,
    /\b(thursday|thu|thur|thurs|guruvar|guruwar|veervar|brihaspativar)\b|गुरुवार|बृहस्पतिवार|वीरवार/,
  ],
  [5, /\b(friday|fri|shukravar|shukrawar)\b|शुक्रवार/],
  [6, /\b(saturday|sat|shanivar|shaniwar)\b|शनिवार/],
  [0, /\b(sunday|sun|ravivar|raviwar|itwar)\b|रविवार|इतवार/],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  ymd(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000));
const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date (YYYY-MM-DD) in the clinic's timezone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Understand "tomorrow evening", "Monday 5 pm", "kal subah", "शुक्रवार 4 बजे के बाद", "5 Oct", "earliest".
 * Returns null if nothing about day or time was recognised. Deterministic: works with no LLM.
 */
export function parseSlotPreference(
  text: string,
  tz: string,
  now = new Date(),
): SlotPreference | null {
  const n = normalise(text);
  const today = todayIn(tz, now);
  const pref: SlotPreference = {};

  // ---- day ----
  if (/\b(day after tomorrow|parso|parson)\b|परसों/.test(n)) pref.date = addDays(today, 2);
  else if (/\b(tomorrow|tmrw|tomorow|tommorow|kal)\b|कल/.test(n)) pref.date = addDays(today, 1);
  else if (/\b(today|aaj)\b|आज/.test(n)) pref.date = today;
  else {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    for (const [d, re] of DAYS) {
      if (re.test(n)) {
        let diff = (d - dow + 7) % 7;
        if (diff === 0 && /\bnext\b|अगले/.test(n)) diff = 7;
        pref.date = addDays(today, diff);
        break;
      }
    }
  }
  if (!pref.date) {
    const m = n.match(
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTHS.join('|')})[a-z]*\\b`),
    );
    const m2 = n.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
    let day: number | undefined, mon: number | undefined;
    if (m) {
      day = Number(m[1]);
      mon = MONTHS.indexOf(m[2]) + 1;
    } else if (m2 && !/[ap]m|baje|बजे|:/.test(n)) {
      day = Number(m2[1]);
      mon = Number(m2[2]);
    }
    if (day && mon && day <= 31 && mon <= 12) {
      let y = Number(today.slice(0, 4));
      let cand = `${y}-${pad(mon)}-${pad(day)}`;
      if (cand < today) cand = `${++y}-${pad(mon)}-${pad(day)}`;
      pref.date = cand;
    }
  }

  // ---- time of day ----
  const hm = (h: number, mi = 0) => `${pad(h)}:${pad(mi)}`;
  const to24 = (h: number, ampm?: string) => {
    if (ampm === 'pm' && h < 12) return h + 12;
    if (ampm === 'am' && h === 12) return 0;
    if (!ampm && h >= 1 && h <= 7) return h + 12; // "at 5" in a clinic means 5 pm
    return h;
  };
  const clock =
    n.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ??
    n.match(/\b(\d{1,2})(?::(\d{2}))?\s*()(?:baje|o'?clock)\b/) ??
    n.match(/(\d{1,2})(?::(\d{2}))?\s*()बजे/) ??
    n.match(/\b(?:at|after|before|around|by)\s+(\d{1,2})(?::(\d{2}))?()\b/);
  if (clock) {
    const h = to24(Number(clock[1]), clock[3] || undefined);
    if (h >= 0 && h <= 23) {
      const t = hm(h, Number(clock[2] ?? 0));
      if (/\bbefore\b|से पहले|\bpehle\b/.test(n)) pref.to = t;
      else pref.from = t;
    }
  }
  if (!pref.from && !pref.to) {
    if (/\b(morning|subah|subha)\b|सुबह|सवेरे/.test(n)) {
      pref.from = '06:00';
      pref.to = '12:00';
    } else if (/\b(afternoon|dopahar|dopaher)\b|दोपहर/.test(n)) {
      pref.from = '12:00';
      pref.to = '16:00';
    } else if (/\b(evening|shaam|sham)\b|शाम/.test(n)) {
      pref.from = '16:00';
      pref.to = '21:00';
    }
  }

  if (
    /\b(earliest|asap|soonest|first available|next available|any ?time|whenever|jaldi se jaldi|jald se jald|koi bhi|abhi)\b|जल्दी से जल्दी|कोई भी|कभी भी|अभी/.test(
      n,
    )
  )
    pref.asap = true;
  return pref.date || pref.from || pref.to || pref.asap ? pref : null;
}
