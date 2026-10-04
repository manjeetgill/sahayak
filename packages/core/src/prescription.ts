export interface RxItem {
  drug: string;
  strength?: string;
  form?: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
}

const FORMS =
  'tablet|tab|capsule|cap|syrup|syp|injection|inj|drops|ointment|oint|cream|gel|lotion|inhaler|powder|sachet|spray';
const FREQ: [RegExp, string][] = [
  [
    /\b(1-1-1|tds|tid|thrice(?: a day| daily)?|three times(?: a day| daily)?|3 times(?: a day| daily)?)\b/i,
    'three times a day',
  ],
  [
    /\b(1-0-1|1-1-0|0-1-1|bd|bid|twice(?: a day| daily)?|two times(?: a day| daily)?|2 times(?: a day| daily)?)\b/i,
    'twice a day',
  ],
  [/\b(qid|four times(?: a day| daily)?|4 times(?: a day| daily)?)\b/i, 'four times a day'],
  [
    /\b(1-0-0|0-1-0|0-0-1|od|once(?: a day| daily)?|daily|one time(?: a day| daily)?|1 time(?: a day| daily)?)\b/i,
    'once a day',
  ],
  [/\b(hs|at bedtime|bedtime|at night)\b/i, 'at bedtime'],
  [/\b(sos|prn|if needed|when needed|as needed)\b/i, 'only if needed'],
];

/**
 * Turn the doctor's dictated lines into prescription rows. Deliberately plain: it copies what was said
 * ("tab paracetamol 500 mg twice a day for 3 days"), never suggests, completes or corrects a medicine, dose or duration.
 * Anything it could not read is left blank and reported, so the doctor must fill it before signing.
 */
export function parsePrescriptionText(text: string): {
  items: RxItem[];
  advice?: string;
  follow_up?: string;
  incomplete: string[];
} {
  const items: RxItem[] = [];
  const incomplete: string[] = [];
  let advice: string | undefined;
  let follow_up: string | undefined;
  const lines = text
    .split(/\n|;|(?<=\d (?:days?|weeks?|months?)),\s*/i)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const adv = line.match(/^(?:advice|advise|instructions?|सलाह)\s*[:\-–]\s*(.+)$/i);
    if (adv) {
      advice = advice ? `${advice}. ${adv[1]}` : adv[1];
      continue;
    }
    const fu = line.match(/^(?:follow[ -]?up|review|f\/u|फॉलो[ -]?अप)\s*[:\-–]?\s*(.+)$/i);
    if (fu) {
      follow_up = fu[1];
      continue;
    }
    let rest = line.replace(/^(?:rx|\d+[.)])\s*[:\-–]?\s*/i, '');
    let form: string | undefined;
    const f = rest.match(new RegExp(`^(${FORMS})\\.?\\s+`, 'i'));
    if (f) {
      form = f[1].toLowerCase();
      rest = rest.slice(f[0].length);
    }
    const strength = rest.match(/\b(\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|iu|%))\b/i)?.[1];
    let frequency: string | undefined;
    for (const [re, label] of FREQ)
      if (re.test(rest)) {
        frequency = label;
        break;
      }
    const dur =
      rest.match(/\b(?:for|x|×)\s*(\d+)\s*(days?|weeks?|months?)\b/i) ??
      rest.match(/\b(\d+)\s*(days?|weeks?|months?)\b/i);
    const duration = dur
      ? `${dur[1]} ${dur[2].toLowerCase().replace(/s$/, '')}${Number(dur[1]) === 1 ? '' : 's'}`
      : undefined;
    const dose = rest.match(
      /\b(\d+(?:\.\d+)?|half|one|two|1\/2)\s*(?:tablets?|tabs?|capsules?|caps?|spoons?|teaspoons?|tsp|ml|drops?|puffs?)\b/i,
    )?.[0];
    const instructions = rest.match(
      /\b(after food|before food|with food|empty stomach|after meals|before meals|with water|with milk)\b/i,
    )?.[1];
    const name = rest
      .replace(/\b(\d+(?:\.\d+)?\s?(?:mg|mcg|µg|g|ml|iu|%))\b/gi, ' ')
      .replace(/\b(?:for|x|×)\s*\d+\s*(?:days?|weeks?|months?)\b/gi, ' ')
      .replace(/\b\d+\s*(?:days?|weeks?|months?)\b/gi, ' ')
      .replace(
        /\b(?:1-0-1|1-1-1|1-0-0|0-1-0|0-0-1|1-1-0|0-1-1|tds|tid|bd|bid|qid|od|hs|sos|prn|twice|thrice|once|daily|a day|times)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:after food|before food|with food|empty stomach|after meals|before meals|with water|with milk|at bedtime|bedtime|at night|if needed|when needed|as needed)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:half|one|two|\d+\/?\d*)\s*(?:tablets?|tabs?|capsules?|caps?|spoons?|teaspoons?|tsp|drops?|puffs?)\b/gi,
        ' ',
      )
      .replace(/[,.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const item: RxItem = {
      drug: name.slice(0, 80),
      strength,
      form,
      dose,
      frequency,
      duration,
      instructions,
    };
    items.push(Object.fromEntries(Object.entries(item).filter(([, v]) => v)) as unknown as RxItem);
    if (!form && !strength && !frequency && !duration && !dose)
      incomplete.push(
        `${name}: no strength, form, how often or duration found. Check that this is a medicine.`,
      );
    const missing = [!frequency && 'how often', !duration && 'duration'].filter(Boolean);
    if (missing.length) incomplete.push(`${name}: ${missing.join(' and ')} not found`);
  }
  return { items, advice, follow_up, incomplete };
}
