import { callTool, type ToolContext } from '@sahayak/core';
import { METRICS } from '@sahayak/core';
import type { AgentEnv } from '../turn';

const BRIEF =
  /^\s*(brief|summary|daily (brief|summary)|today'?s (brief|summary)|सारांश|आज का सारांश)\s*[?.!]*\s*$/i;

/** Pick a metric when the keywords did not recognise the question. The model only chooses from the fixed list: it never writes queries. */
async function classifyMetric(
  env: AgentEnv,
  question: string,
): Promise<(typeof METRICS)[number] | undefined> {
  if (!env.gate.available()) return undefined;
  try {
    const r = await env.gate.chat({
      messages: [
        {
          role: 'system',
          content: `Classify a clinic owner's question into exactly one of: ${METRICS.join(', ')}. Reply ONLY JSON {"metric": "<one of them or null>"}.`,
        },
        { role: 'user', content: question },
      ],
      temperature: 0,
      maxTokens: 30,
    });
    const m = JSON.parse((r.content ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}').metric;
    return (METRICS as readonly string[]).includes(m) ? m : undefined;
  } catch {
    return undefined;
  }
}

/** Answer a staff member's question about the clinic (WhatsApp or the "Ask your clinic" box). Read-only. */
export async function answerStaffQuestion(
  env: AgentEnv,
  ctx: ToolContext,
  question: string,
): Promise<string> {
  if (BRIEF.test(question)) return (await callTool(env.rt, ctx, 'build_daily_brief', {})).text;
  let out = await callTool(env.rt, ctx, 'ask_clinic', { question });
  if (!out.understood) {
    const metric = await classifyMetric(env, question);
    if (metric) out = await callTool(env.rt, ctx, 'ask_clinic', { question, metric });
  }
  return out.answer;
}
