import { callTool, type Actor, type ToolContext, type ToolRuntime } from '@sahayak/core';
import { t, type Lang, type MessageKey } from '@sahayak/shared';
import type { LlmGate } from './llm';

export interface AgentEnv {
  rt: ToolRuntime;
  gate: LlmGate;
}

/** Everything an agent needs for one inbound patient message. */
export interface Turn {
  env: AgentEnv;
  clinicId: string;
  conversationId: string;
  patientId: string | null;
  contact: string;
  lang: Lang;
  text: string;
  state: Record<string, any>;
  replies: string[];
}

export function ctxFor(turn: Turn, agent: string | 'system'): ToolContext {
  const actor: Actor =
    agent === 'system' ? { kind: 'system', name: 'orchestrator' } : { kind: 'agent', agent };
  return {
    clinicId: turn.clinicId,
    actor,
    patientId: turn.patientId,
    conversationId: turn.conversationId,
    lang: turn.lang,
  };
}

export const call = (turn: Turn, agent: string, tool: string, input: unknown) =>
  callTool(turn.env.rt, ctxFor(turn, agent), tool, input);

/** Send a reply through the send_message tool (audited, stored, delivered by the channel). */
export async function sayText(turn: Turn, agent: string, text: string) {
  await call(turn, agent, 'send_message', { conversationId: turn.conversationId, text });
  turn.replies.push(text);
}
export const say = (
  turn: Turn,
  agent: string,
  key: MessageKey,
  vars: Record<string, string | number> = {},
) => sayText(turn, agent, t(turn.lang, key, vars));

export async function setState(turn: Turn, agent: string, state: Record<string, any>) {
  turn.state = state;
  await call(turn, agent, 'set_conversation_state', { state });
}

export function formatTimings(timings: Record<string, string>): string {
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const label = (d: string) => d[0].toUpperCase() + d.slice(1);
  const groups: { from: string; to: string; v: string }[] = [];
  for (const d of days) {
    const v = timings[d];
    if (!v) continue;
    const last = groups[groups.length - 1];
    if (last && last.v === v) last.to = d;
    else groups.push({ from: d, to: d, v });
  }
  return groups
    .map((g) => `${g.from === g.to ? label(g.from) : `${label(g.from)}-${label(g.to)}`} ${g.v}`)
    .join('; ');
}
