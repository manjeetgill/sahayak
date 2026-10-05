import { z } from 'zod';
import { ToolError } from '@sahayak/core';
const Credentials = z.record(
  z.string().uuid(),
  z.object({ key: z.string().min(10), externalUserId: z.string().min(1) }),
);
export interface WhatsAppPlatformOptions {
  baseUrl: string;
  clinics: z.infer<typeof Credentials>;
  fetchImpl?: typeof fetch;
}
export function whatsappPlatformFromEnv(env = process.env): WhatsAppPlatformOptions | undefined {
  if (!env.AGENT_CHANNEL_PLATFORM_URL || !env.AGENT_CHANNEL_CREDENTIALS) return undefined;
  try {
    const url = new URL(env.AGENT_CHANNEL_PLATFORM_URL);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
      return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return {
      baseUrl: url.toString().replace(/\/$/, ''),
      clinics: Credentials.parse(JSON.parse(env.AGENT_CHANNEL_CREDENTIALS)),
    };
  } catch {
    return undefined;
  }
}
export async function whatsappPlatform<T>(
  options: WhatsAppPlatformOptions | undefined,
  clinicId: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method?: 'GET' | 'POST' | 'PUT',
): Promise<T> {
  const credential = options?.clinics[clinicId];
  if (!options || !credential)
    throw new ToolError(
      'whatsapp_setup_required',
      'Your setup team needs to connect this clinic to the agent platform.',
      503,
    );
  try {
    const response = await (options.fetchImpl ?? fetch)(
      options.baseUrl + (path.startsWith('/v1/') ? path : '/v1/whatsapp/chakra' + path),
      {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: 'Bearer ' + credential.key,
          'X-External-User-ID': credential.externalUserId,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!response.ok) throw new Error('upstream');
    return schema.parse(await response.json());
  } catch {
    throw new ToolError(
      'agent_service_unavailable',
      'Agent service unavailable. Your details are saved. Ask your setup team to check before restarting authorization.',
      503,
    );
  }
}
