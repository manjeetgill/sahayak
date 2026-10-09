import type { NoteContent } from '@sahayak/core';
import type { LlmGate } from '../llm';

export type NoteField =
  | 'complaint'
  | 'history'
  | 'examination'
  | 'diagnosis'
  | 'plan'
  | 'follow_up'
  | 'assessment'
  | 'differential'
  | 'investigations'
  | 'instructions';
export interface Structured {
  note: NoteContent;
  flags: string[];
  usedAi: boolean;
}

// Section headings in English, Hinglish and Hindi. Order matters only for readability.
const LABELS: [NoteField, string][] = [
  [
    'complaint',
    'chief complaints?|presenting complaints?|complaints?|c\\/o|cc|शिकायत(?:ें)?|तकलीफ़?',
  ],
  ['history', 'past history|history|h\\/o|hx|इतिहास'],
  ['examination', 'on examination|examination|exam|o\\/e|findings|vitals|जांच|परीक्षण'],
  ['diagnosis', 'provisional diagnosis|diagnosis|dx|impression|निदान'],
  ['follow_up', 'follow[ -]?up|f\\/u|review after|फॉलो[ -]?अप'],
  ['assessment', 'assessment|आकलन'],
  ['differential', 'differential diagnosis|differential|संभावित निदान'],
  ['investigations', 'investigations|tests requested|जांच के अनुरोध'],
  ['instructions', 'patient instructions|instructions|मरीज़ के निर्देश'],
  ['plan', 'treatment plan|plan|advice|advised|management|treatment|rx|सलाह|उपचार|योजना'],
];
const ALT = LABELS.map(([f, re]) => `(?<${f}>${re})`).join('|');
const COLON = new RegExp(`(?:^|[\\n.;।])\\s*(?:${ALT})\\s*[:\\-–]`, 'gimu');
// Spoken dictation often has no punctuation: allow the stronger headings as plain words at a sentence start.
const SPOKEN_ALT = LABELS.filter(([f]) => f !== 'history')
  .map(([f, re]) => `(?<${f}>${re})`)
  .join('|');
const SPOKEN = new RegExp(`(?:^|[\\n.;।])\\s*(?:${SPOKEN_ALT})\\s+`, 'gimu');

function split(text: string, re: RegExp): { field: NoteField; start: number; end: number }[] {
  const hits: { field: NoteField; start: number; end: number }[] = [];
  for (const m of text.matchAll(re)) {
    const field = (Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0] ??
      '') as NoteField;
    if (field) hits.push({ field, start: m.index!, end: m.index! + m[0].length });
  }
  return hits;
}

/**
 * Put what the doctor said under the right headings. Deterministic and conservative: it only moves the doctor's
 * own words around, never adds or rewrites anything. Text it cannot place is kept under History and flagged.
 */
export function structureDeterministic(transcript: string): Structured {
  const text = transcript.trim();
  let hits = split(text, COLON);
  if (!hits.length) hits = split(text, SPOKEN);
  const flags: string[] = [];
  const note: Record<string, string> = {};
  if (!hits.length) {
    note.history = text;
    flags.push(
      'No section headings were found, so everything is under History. Please arrange it.',
    );
    return { note: note as NoteContent, flags, usedAi: false };
  }
  const lead = text
    .slice(0, hits[0].start)
    .trim()
    .replace(/^[.;\s]+/, '');
  if (lead) {
    note.history = lead;
    flags.push('Some text came before the first heading and was placed under History.');
  }
  hits.forEach((h, i) => {
    const body = text
      .slice(h.end, hits[i + 1]?.start ?? text.length)
      .trim()
      .replace(/^[.;।\s]+|[.;।\s]+$/g, '');
    if (body) note[h.field] = note[h.field] ? `${note[h.field]}. ${body}` : body;
  });
  return { note: note as NoteContent, flags, usedAi: false };
}

/** Browser speech recognition has no reliable speaker identification. The doctor labels each turn.
 * Keep patient words separate from doctor statements; never turn patient speech into findings or a plan.
 */
export function structureConversation(transcript: string): Structured {
  const patient: string[] = [];
  const doctor: string[] = [];
  const unlabeled: string[] = [];
  for (const line of transcript.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
    if (/^Patient:\s*/i.test(line)) patient.push(line.replace(/^Patient:\s*/i, ''));
    else if (/^Doctor:\s*/i.test(line)) doctor.push(line.replace(/^Doctor:\s*/i, ''));
    else unlabeled.push(line);
  }
  const note: Record<string, string> = {};
  const doctorFlags: string[] = [];
  for (const utterance of doctor) {
    const arranged = structureDeterministic(utterance);
    for (const [field, value] of Object.entries(arranged.note)) {
      if (value) note[field] = note[field] ? `${note[field]}\n${value}` : value;
    }
    doctorFlags.push(...arranged.flags);
  }
  if (patient.length) {
    const reported = patient.map((part) => `Patient said: ${part}`).join('\n');
    note.complaint = note.complaint ? `${note.complaint}\n${reported}` : reported;
  }
  if (unlabeled.length) {
    const other = unlabeled.join('\n');
    note.history = note.history ? `${note.history}\n${other}` : other;
  }
  return {
    note: note as NoteContent,
    flags: [
      'Speaker labels are set by the doctor, not detected by the microphone. Check every statement against the transcript before signing.',
      ...new Set(doctorFlags),
      ...(unlabeled.length ? ['Unlabelled speech was placed under History.'] : []),
    ],
    usedAi: false,
  };
}

// Compare complete source segments, retaining short words, numbers and negation.
// A word-overlap score could accept changed doses or a dropped "no".
const canonical = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/[\s.;।]+/gu, ' ')
    .trim();
const segments = (s: string) =>
  s
    .split(/(?:[.;।]\s+|\n+)/u)
    .map(canonical)
    .filter(Boolean);
export function isGrounded(note: NoteContent, transcript: string): boolean {
  const base = structureDeterministic(transcript);
  if (
    !base.flags.length &&
    Object.entries(note).some(
      ([field, value]) =>
        canonical(value ?? '') !== canonical((base.note as Record<string, string>)[field] ?? ''),
    )
  )
    return false;
  const source = Object.values(base.note).flatMap((v) => segments(v ?? ''));
  const output = Object.values(note).flatMap((v) => segments(v ?? ''));
  if (source.length !== output.length) return false;
  const remaining = [...source];
  for (const segment of output) {
    const index = remaining.indexOf(segment);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

const SYSTEM = `You organise a doctor's dictated visit note into sections. Use ONLY the doctor's own words: you may split, reorder and tidy punctuation, but you must not add, infer, translate, summarise or correct medical content.
Sections: complaint, history, examination, diagnosis, plan, follow_up, assessment, differential, investigations, instructions. Leave a section empty if the doctor did not say it. Do not invent a diagnosis or a plan.
Reply ONLY with JSON: {"complaint":"","history":"","examination":"","diagnosis":"","plan":"","follow_up":"","assessment":"","differential":"","investigations":"","instructions":"","unclear":["short notes about anything you could not place"]}`;

/**
 * Structure a dictation. The AI path is optional and off by default (it sends the doctor's words, with no patient
 * name or number, to the hosted model). Its output is accepted only if every word traces back to the transcript.
 */
export async function structureNote(
  gate: LlmGate | null,
  transcript: string,
  useAi: boolean,
): Promise<Structured> {
  const base = structureDeterministic(transcript);
  if (!useAi || !gate?.available()) return base;
  try {
    const r = await gate.chat({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
      maxTokens: 900,
    });
    const j = JSON.parse((r.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const note: Record<string, string> = {};
    for (const f of [
      'complaint',
      'history',
      'examination',
      'diagnosis',
      'plan',
      'follow_up',
      'assessment',
      'differential',
      'investigations',
      'instructions',
    ])
      if (typeof j[f] === 'string' && j[f].trim()) note[f] = j[f].trim();
    if (!Object.keys(note).length || !isGrounded(note as NoteContent, transcript)) {
      return {
        ...base,
        flags: [
          ...base.flags,
          'The AI arrangement was rejected because it contained words you did not say; sections were arranged by headings instead.',
        ],
      };
    }
    const unclear = Array.isArray(j.unclear)
      ? j.unclear.filter((x: unknown) => typeof x === 'string').slice(0, 5)
      : [];
    return {
      note: note as NoteContent,
      flags: unclear.length
        ? ['Some wording needs review. Compare every section with the original transcript.']
        : [],
      usedAi: true,
    };
  } catch {
    return base;
  }
}
