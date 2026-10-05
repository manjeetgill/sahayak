import { describe, expect, it } from 'vitest';
import { agentPlatformFromEnv, draftFromPlatform } from '../src/agent-platform';

const spec = {
  trigger: { type: 'schedule', every: 'week', weekday: 1, at: '10:00' },
  audience: { tags: ['diabetes'] },
  action: { type: 'message_patients', text: { en: 'Hello {name}, please contact {clinic}.' } },
};
const id = '59bb74c7-f9d8-4f7b-a9c7-67258943cda8';

describe('agent platform authoring boundary', () => {
  it('sends only the clinic id and request, then validates the returned spec locally', async () => {
    let request: Request | undefined;
    const out = await draftFromPlatform(
      {
        baseUrl: 'http://127.0.0.1:8000',
        key: 'secret',
        fetchImpl: async (input, init) => {
          request = new Request(input, init);
          return Response.json({ understood: true, name: 'Reminder', spec, platformDraftId: id, platformVersion: 1 });
        },
      },
      id,
      'remind my patients',
    );
    expect(request?.headers.get('x-integration-key')).toBe('secret');
    expect(await request?.json()).toEqual({ clinic_id: id, request: 'remind my patients' });
    expect(out.understood).toBe(true);
    expect(out.problems).toEqual([]);
    expect(out.platformDraftId).toBe(id);
  });

  it('does not trust a platform draft that violates Sahayak policy', async () => {
    const out = await draftFromPlatform(
      { baseUrl: 'http://127.0.0.1:8000', key: 'secret',
        fetchImpl: async () => Response.json({ understood: true, name: 'Unsafe',
          spec: { ...spec, action: { type: 'message_patients', text: { en: 'Take two tablets now.' } } },
          platformDraftId: id, platformVersion: 1 }) },
      id, 'send medical advice',
    );
    expect(out.problems?.length).toBeGreaterThan(0);
    expect(out.explain).toEqual([]);
  });

  it('rejects insecure nonlocal URLs and incomplete configuration', () => {
    expect(() => agentPlatformFromEnv({ AGENT_PLATFORM_URL: 'http://example.com', AGENT_PLATFORM_KEY: 'x' } as NodeJS.ProcessEnv)).toThrow();
    expect(() => agentPlatformFromEnv({ AGENT_PLATFORM_URL: 'http://127.0.0.1:8000' } as NodeJS.ProcessEnv)).toThrow();
  });
});
