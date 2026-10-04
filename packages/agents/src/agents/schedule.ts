import { normalise } from '@sahayak/shared';
import type { LlmGate } from '../llm';
import { classifyIntent } from '../intent';
import { call, say, type Turn } from '../turn';
import { offerSlots } from './frontdesk';

/**
 * "Running 30 min late", "half an hour late", "1 hour deri", "30 मिनट देर". Returns minutes (5-240) or null.
 * Deterministic first; the LLM is only a fallback for unusual phrasing.
 */
export function parseLateMinutes(text: string): number | null {
  const n = normalise(text);
  if (!/\b(late|delay|delayed|behind|der|deri|dair)\b|देर|लेट|विलंब/.test(n)) return null;
  let m = n.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|ghante|ghanta|घंटे|घंटा)/);
  if (m) return clamp(Math.round(Number(m[1]) * 60));
  m = n.match(/(\d+)\s*(?:minutes?|mins?|min|minute|mint|मिनट)/);
  if (m) return clamp(Number(m[1]));
  if (/half an hour|half hour|aadha ghanta|आधा घंटा/.test(n)) return 30;
  if (/quarter of an hour|15 ?min/.test(n)) return 15;
  if (/an hour|one hour|ek ghanta|एक घंटा/.test(n)) return 60;
  return null;
}
const clamp = (x: number) => (x >= 5 && x <= 240 ? x : null as unknown as number);

export async function parseLateRequest(gate: LlmGate | null, text: string): Promise<number | null> {
  const det = parseLateMinutes(text);
  if (det) return det;
  if (!gate?.available()) return null;
  try {
    const r = await gate.chat({ messages: [
      { role: 'system', content: 'The doctor says they are running late. Extract the delay in minutes. Reply ONLY JSON {"minutes": <integer or null>}.' },
      { role: 'user', content: text }], temperature: 0, maxTokens: 30 });
    const j = JSON.parse((r.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const v = Number(j.minutes);
    return Number.isInteger(v) && v >= 5 && v <= 240 ? v : null;
  } catch { return null; }
}

/** Patient replies to "doctor is running late": 1 = keep the new time, 2 = see other slots. */
export async function continueSchedule(turn: Turn): Promise<boolean> {
  const st = turn.state;
  if (st.flow !== 'late_notice') return false;
  const intent = classifyIntent(turn.text);
  const t = normalise(turn.text);
  const keep = t === '1' || intent === 'yes' || /\b(keep|fine|ok|theek)\b/.test(t);
  const other = t === '2' || /\b(other|change|different|reschedule|cancel)\b/.test(t) || intent === 'reschedule' || intent === 'no';
  if (keep) {
    await call(turn, 'schedule', 'record_late_response', { itemId: st.itemId, response: 'kept' });
    const info = await call(turn, 'schedule', 'get_clinic_info', {});
    const { fmtTime } = await import('@sahayak/core');
    await call(turn, 'schedule', 'set_conversation_state', { state: {} });
    await say(turn, 'schedule', 'msg.late_kept', { when: fmtTime(st.newStart, info.timezone, turn.lang) });
    return true;
  }
  if (other) {
    await call(turn, 'schedule', 'record_late_response', { itemId: st.itemId, response: 'rebooking' });
    await offerSlots(turn, 'schedule', { id: st.doctorId, name: st.doctorName }, st.appointmentId);
    return true;
  }
  return false;
}
