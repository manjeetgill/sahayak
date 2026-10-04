import { normalise } from '@sahayak/shared';
import type { NoteContent } from '@sahayak/core';
import type { LlmGate } from '../llm';

export type NoteField =
  'complaint' | 'history' | 'examination' | 'diagnosis' | 'plan' | 'follow_up';
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

const words = (s: string) =>
  normalise(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);

/** Every word the model wrote must come from the doctor's own words. Anything invented fails this check. */
export function isGrounded(note: NoteContent, transcript: string): boolean {
  const have = new Set(words(transcript));
  for (const v of Object.values(note)) {
    if (typeof v !== 'string') continue;
    const w = words(v);
    if (!w.length) continue;
    if (w.filter((x) => have.has(x)).length / w.length < 0.85) return false;
  }
  return true;
}

const SYSTEM = `You organise a doctor's dictated visit note into sections. Use ONLY the doctor's own words: you may split, reorder and tidy punctuation, but you must not add, infer, translate, summarise or correct medical content.
Sections: complaint, history, examination, diagnosis, plan, follow_up. Leave a section empty if the doctor did not say it. Do not invent a diagnosis or a plan.
Reply ONLY with JSON: {"complaint":"","history":"","examination":"","diagnosis":"","plan":"","follow_up":"","unclear":["short notes about anything you could not place"]}`;

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
    for (const f of ['complaint', 'history', 'examination', 'diagnosis', 'plan', 'follow_up'])
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
    return { note: note as NoteContent, flags: unclear, usedAi: true };
  } catch {
    return base;
  }
}
