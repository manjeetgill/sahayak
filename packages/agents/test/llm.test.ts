import { describe, it, expect, vi } from 'vitest';
import { LlmUnavailable, NemotronProvider, TogetherProvider, modelProviderFromEnv } from '../src';

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

describe('Sahayak model selection', () => {
  it('keeps legacy installations on NVIDIA and allows explicit offline mode', () => {
    expect(modelProviderFromEnv({ LLM_API_KEY: 'legacy' })?.name).toBe('nemotron');
    expect(modelProviderFromEnv({ LLM_PROVIDER: 'offline', TOGETHER_API_KEY: 'key' })).toBeNull();
    expect(() => modelProviderFromEnv({ LLM_PROVIDER: 'typo' })).toThrow(/LLM_PROVIDER/);
  });
  it('never uses NVIDIA credentials when Together is selected', () => {
    expect(
      modelProviderFromEnv({ LLM_PROVIDER: 'together', LLM_API_KEY: 'nvidia-key' }),
    ).toBeNull();
  });
  it('uses Together endpoint and model despite stale NVIDIA settings', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ content: 'Ready' }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const provider = modelProviderFromEnv({
        LLM_PROVIDER: 'together',
        TOGETHER_API_KEY: 'together-key',
        LLM_API_KEY: 'nvidia-key',
        LLM_BASE_URL: 'https://nvidia.example/v1',
        LLM_MODEL: 'nvidia-model',
      })!;
      await provider.chat({ messages: [], maxTokens: 512 });
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe('https://api.together.ai/v1/chat/completions');
      expect(init.headers.authorization).toBe('Bearer together-key');
      expect(JSON.parse(init.body)).toMatchObject({
        model: 'openai/gpt-oss-120b',
        reasoning_effort: 'low',
        max_tokens: 512,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('supports a different Together model without GPT-OSS reasoning parameters', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ content: 'Ready' }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const provider = TogetherProvider.fromEnv({
        TOGETHER_API_KEY: 'key',
        TOGETHER_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      })!;
      await provider.chat({ messages: [] });
      expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning_effort).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('rejects invalid timeouts and reasoning effort', () => {
    expect(() =>
      TogetherProvider.fromEnv({ TOGETHER_API_KEY: 'key', LLM_TIMEOUT_MS: 'NaN' }),
    ).toThrow(/TIMEOUT/);
    expect(() =>
      TogetherProvider.fromEnv({ TOGETHER_API_KEY: 'key', TOGETHER_REASONING_EFFORT: 'none' }),
    ).toThrow(/EFFORT/);
  });
  it('parses Together tool calls and never returns private reasoning as the answer', async () => {
    const provider = new TogetherProvider({
      apiKey: 'key',
      model: 'openai/gpt-oss-120b',
      timeoutMs: 100,
      fetchImpl: (async () =>
        ok({
          content: null,
          reasoning: 'private',
          tool_calls: [{ id: 'call1', function: { name: 'get_clinic_info', arguments: '{}' } }],
        })) as any,
    });
    expect(await provider.chat({ messages: [] })).toEqual({
      content: null,
      toolCalls: [{ id: 'call1', name: 'get_clinic_info', arguments: '{}' }],
    });
  });
  it('rejects reasoning-only or truncated answers without spending on retries', async () => {
    for (const response of [
      { choices: [{ message: { content: null, reasoning: 'hidden' } }] },
      { choices: [{ finish_reason: 'length', message: { content: 'partial answer' } }] },
    ]) {
      const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
      const provider = new TogetherProvider({
        apiKey: 'key',
        model: 'test',
        timeoutMs: 100,
        fetchImpl: fetcher,
      });
      await expect(provider.chat({ messages: [] })).rejects.toThrow(LlmUnavailable);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
