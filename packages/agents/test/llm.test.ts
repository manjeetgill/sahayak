import { describe, it, expect, vi } from 'vitest';
import { LlmUnavailable, NemotronProvider } from '../src';

const mk = (fetchImpl: any, retries = 2) =>
  new NemotronProvider({
    baseUrl: 'https://x/v1',
    apiKey: 'k',
    model: 'nemotron-3-ultra-550b-a55b',
    timeoutMs: 100,
    retries,
    fetchImpl,
  });
const ok = (message: any) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message }] }),
});

describe('Nemotron provider (OpenAI-compatible)', () => {
  it('sends model, key and tools; parses tool calls', async () => {
    let seen: any;
    const p = mk(async (url: string, init: any) => {
      seen = { url, init, body: JSON.parse(init.body) };
      return ok({
        content: null,
        tool_calls: [{ id: '1', function: { name: 'get_clinic_info', arguments: '{}' } }],
      });
    });
    const r = await p.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'get_clinic_info', description: 'd', parameters: { type: 'object' } }],
    });
    expect(seen.url).toBe('https://x/v1/chat/completions');
    expect(seen.init.headers.authorization).toBe('Bearer k');
    expect(seen.body.model).toBe('nemotron-3-ultra-550b-a55b');
    expect(seen.body.tools[0].function.name).toBe('get_clinic_info');
    expect(r.toolCalls[0]).toEqual({ id: '1', name: 'get_clinic_info', arguments: '{}' });
  });
  it('retries on 5xx then succeeds', async () => {
    let n = 0;
    const p = mk(async () => (++n < 3 ? { ok: false, status: 503 } : ok({ content: 'hello' })));
    expect((await p.chat({ messages: [] })).content).toBe('hello');
    expect(n).toBe(3);
  });
  it('does not retry on 4xx (bad key)', async () => {
    let n = 0;
    const p = mk(async () => {
      n++;
      return { ok: false, status: 401 };
    });
    await expect(p.chat({ messages: [] })).rejects.toThrow(LlmUnavailable);
    expect(n).toBe(1);
  });
  it('times out slow responses', async () => {
    const p = mk(
      (_u: string, init: any) =>
        new Promise((_res, rej) =>
          init.signal.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
      0,
    );
    await expect(p.chat({ messages: [] })).rejects.toThrow(/unavailable/);
  });
  it('is off when no key is configured', () =>
    expect(NemotronProvider.fromEnv({} as any)).toBeNull());
});

it('aborts a bounded call without retries and keeps transport settings out of the payload', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0,
      body: any;
    const p = new NemotronProvider({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'test',
      timeoutMs: 8000,
      retries: 2,
      fetchImpl: (async (_u: any, init: any) => {
        calls++;
        body = JSON.parse(init.body);
        return new Promise((_r, reject) =>
          init.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }) as any,
    });
    const result = expect(p.chat({ messages: [], timeoutMs: 1500, retries: 0 })).rejects.toThrow(
      LlmUnavailable,
    );
    await vi.advanceTimersByTimeAsync(1500);
    await result;
    expect(calls).toBe(1);
    expect(body.timeoutMs).toBeUndefined();
    expect(body.retries).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
