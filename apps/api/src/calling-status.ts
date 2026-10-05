import { ToolError } from '@sahayak/core';
import { z } from 'zod';
import type { CallingBridgeOptions } from './calling-bridge';
import type { WhatsAppPlatformOptions } from './whatsapp-platform';

export async function callingStatus(
  bindings: CallingBridgeOptions | undefined,
  platform: WhatsAppPlatformOptions | undefined,
  clinicId: string,
) {
  const binding = Object.entries(bindings ?? {}).find(([, b]) => b.clinicId === clinicId);
  const base = {
    configured: false,
    bookingAdapter: !!binding,
    requestedNumber: binding?.[1].requestedNumber ?? null,
    state: binding ? 'AWAITING_VOICE_PROVIDER' : 'NOT_CONFIGURED',
  };
  if (!binding) return base;
  const credential = platform?.clinics[clinicId];
  if (!platform || !credential) return { ...base, state: 'UNAVAILABLE' };
  try {
    const response = await (platform.fetchImpl ?? fetch)(
      platform.baseUrl + '/v1/calling/agents/' + binding[0] + '/setup',
      {
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
        headers: {
          Authorization: 'Bearer ' + credential.key,
          'X-External-User-ID': credential.externalUserId,
        },
      },
    );
    if (!response.ok) throw new Error('unavailable');
    const setup = z
      .object({ configured: z.boolean(), enabled: z.boolean() })
      .parse(await response.json());
    return {
      ...base,
      configured: setup.configured && setup.enabled,
      state: setup.configured
        ? setup.enabled
          ? 'ENABLED_NEEDS_PHONE_TEST'
          : 'PAUSED'
        : 'AWAITING_VOICE_PROVIDER',
    };
  } catch {
    return { ...base, state: 'UNAVAILABLE' };
  }
}

export async function callingRequest<T>(
  bindings: CallingBridgeOptions | undefined,
  platform: WhatsAppPlatformOptions | undefined,
  clinicId: string,
  operation: 'readiness' | 'calls' | 'activation',
  schema: z.ZodType<T>,
  body?: unknown,
  before?: string,
): Promise<T> {
  const binding = Object.entries(bindings ?? {}).find(([, b]) => b.clinicId === clinicId);
  const credential = platform?.clinics[clinicId];
  if (!binding || !platform || !credential)
    throw new ToolError(
      'calling_setup_required',
      'Your setup team must connect the clinic calling agent.',
      409,
    );
  const path =
    '/v1/calling/agents/' +
    binding[0] +
    '/' +
    operation +
    (before ? '?before=' + encodeURIComponent(before) : '');
  try {
    const response = await (platform.fetchImpl ?? fetch)(platform.baseUrl + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(operation === 'calls' ? 3000 : 12000),
      headers: {
        Authorization: 'Bearer ' + credential.key,
        'X-External-User-ID': credential.externalUserId,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 409)
      throw new ToolError(
        'calling_not_ready',
        'Calling could not be enabled. Check readiness and finish the listed setup step.',
        409,
      );
    if (!response.ok) throw new Error('upstream');
    return schema.parse(await response.json());
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(
      'agent_service_unavailable',
      'Agent service unavailable. Check the saved status before retrying a change.',
      503,
    );
  }
}
