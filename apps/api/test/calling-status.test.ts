import { it, expect, vi } from 'vitest';
import { callingStatus } from '../src/calling-status';
const clinic = '1cfd4dbd-b4bb-4d58-8e31-4aa3c5679b7b',
  agent = 'f57a3ec5-0294-435d-847e-15849364635f',
  app = 'd3820259-bce5-44d2-bc1a-4c02f1afcbe1';
const bindings = {
  [agent]: {
    clinicId: clinic,
    appId: app,
    secret: 'private-value-never-in-status-012345',
    requestedNumber: '+917703961610',
  },
};
it('keeps unbound clinics private and reports a draft as awaiting authorization', async () => {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify({ configured: false, enabled: false })),
  );
  const platform = {
    baseUrl: 'https://platform.invalid',
    clinics: { [clinic]: { key: 'private-app-key', externalUserId: 'owner' } },
    fetchImpl,
  };
  expect(await callingStatus(bindings, platform, 'other')).toMatchObject({
    configured: false,
    requestedNumber: null,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  const result = await callingStatus(bindings, platform, clinic);
  expect(result).toMatchObject({
    configured: false,
    requestedNumber: '+917703961610',
    state: 'AWAITING_VOICE_PROVIDER',
  });
  expect(JSON.stringify(result)).not.toContain('private');
});
it('reports unavailable on timeout and never treats malformed readiness as connected', async () => {
  const options = {
    baseUrl: 'https://platform.invalid',
    clinics: { [clinic]: { key: 'private-app-key', externalUserId: 'owner' } },
    fetchImpl: vi.fn(async () => {
      throw new Error('timeout');
    }),
  };
  expect((await callingStatus(bindings, options, clinic)).state).toBe('UNAVAILABLE');
  expect(
    (
      await callingStatus(
        bindings,
        { ...options, fetchImpl: async () => new Response('{}') },
        clinic,
      )
    ).configured,
  ).toBe(false);
});
