import { zodToJsonSchema } from 'zod-to-json-schema';
import { actorKey, getTool, listTools } from '@sahayak/core';
import type { ChatMessage } from './llm';
import { ctxFor, call, type Turn } from './turn';

/**
 * Let the LLM call a small allow-list of tools on behalf of an agent. Every call still goes through
 * callTool (validation, permissions, audit). Returns the final text (or null if the model gave none).
 */
export async function runToolLoop(turn: Turn, agent: string, system: string, user: string, toolNames: string[], maxSteps = 4): Promise<string | null> {
  const key = actorKey(ctxFor(turn, agent).actor);
  const tools = listTools().filter((x) => toolNames.includes(x.name) && x.allow.includes(key)).map((x) => ({
    name: x.name, description: x.description, parameters: zodToJsonSchema(x.input, { target: 'openApi3' }) as Record<string, unknown>,
  }));
  const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (let step = 0; step < maxSteps; step++) {
    const r = await turn.env.gate.chat({ messages, tools });
    if (!r.toolCalls.length) return r.content;
    messages.push({ role: 'assistant', content: r.content, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) });
    for (const c of r.toolCalls) {
      let out: unknown;
      try {
        if (!getTool(c.name) || !toolNames.includes(c.name)) throw new Error('tool not available');
        out = await call(turn, agent, c.name, JSON.parse(c.arguments || '{}'));
      } catch (e) { out = { error: (e as Error).message }; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(out) });
    }
  }
  return null;
}
