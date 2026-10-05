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
