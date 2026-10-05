import { z } from 'zod';
import { explainSpec, validateSpec, ToolError } from '@sahayak/core';

export interface AgentPlatformOptions {
  baseUrl: string;
  key: string;
  fetchImpl?: typeof fetch;
}

const DraftResponse = z.discriminatedUnion('understood', [
  z.object({ understood: z.literal(false), help: z.string().optional() }),
  z.object({
    understood: z.literal(true),
    name: z.string().min(1).max(80),
    spec: z.unknown(),
    platformDraftId: z.string().uuid(),
    platformVersion: z.number().int().positive(),
    notes: z.array(z.string()).optional(),
  }),
]);

export async function draftFromPlatform(
  options: AgentPlatformOptions,
  clinicId: string,
  text: string,
) {
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${options.baseUrl.replace(/\/$/, '')}/api/integrations/sahayak/drafts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-integration-key': options.key },
        body: JSON.stringify({ clinic_id: clinicId, request: text }),
        signal: AbortSignal.timeout(35_000),
      },
    );
  } catch {
    throw new ToolError('agent_platform_unavailable', 'Agent platform is unavailable. Please try again.', 503);
  }
  if (!response.ok)
    throw new ToolError('agent_platform_unavailable', `Agent platform returned HTTP ${response.status}.`, 503);
  const parsed = DraftResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new ToolError('agent_platform_invalid', 'Agent platform returned an invalid draft.', 502);
  if (!parsed.data.understood)
    return { understood: false, help: parsed.data.help ?? 'Could not draft this agent.' };
  const draft = parsed.data;
  const valid = validateSpec(draft.spec);
  return {
    understood: true,
    name: draft.name,
    spec: valid.ok ? valid.spec : draft.spec,
    problems: valid.ok ? [] : valid.problems,
    explain: valid.ok ? explainSpec(valid.spec) : [],
    notes: draft.notes ?? [],
    platformDraftId: draft.platformDraftId,
    platformVersion: draft.platformVersion,
  };
}

export function agentPlatformFromEnv(env = process.env): AgentPlatformOptions | undefined {
  if (!env.AGENT_PLATFORM_URL) return undefined;
  if (!env.AGENT_PLATFORM_KEY) throw new Error('AGENT_PLATFORM_KEY is required with AGENT_PLATFORM_URL');
  const url = new URL(env.AGENT_PLATFORM_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)))
    throw new Error('Agent platform must use HTTPS or loopback HTTP');
  return { baseUrl: url.toString().replace(/\/$/, ''), key: env.AGENT_PLATFORM_KEY };
}
