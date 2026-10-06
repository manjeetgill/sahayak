import type { EventBus } from '@sahayak/core';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}
export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface LlmRequest {
  messages: ChatMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
  /** Per-call latency bounds; never sent to the model API. */
  timeoutMs?: number;
  retries?: number;
}
export interface LlmResponse {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: string }[];
}

export class LlmUnavailable extends Error {}

/** Our own interface: swap the hosted model for a self-hosted one without touching the agents. */
export interface LlmProvider {
  readonly name: string;
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export interface CompatibleModelOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/** Shared transport; provider credentials and defaults are selected separately below. */
export class CompatibleModelProvider implements LlmProvider {
  constructor(
    readonly name: string,
    private o: CompatibleModelOptions,
  ) {}

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const retries = Math.max(0, Math.min(req.retries ?? this.o.retries ?? 2, this.o.retries ?? 2));
    const timeoutMs = Math.max(1, Math.min(req.timeoutMs ?? this.o.timeoutMs, this.o.timeoutMs));
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await (this.o.fetchImpl ?? fetch)(
          `${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            method: 'POST',
            signal: ctl.signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.o.apiKey}`,
            },
            body: JSON.stringify({
              model: this.o.model,
              messages: req.messages,
              temperature: req.temperature ?? 0.2,
              max_tokens: req.maxTokens ?? 600,
              ...(this.o.reasoningEffort ? { reasoning_effort: this.o.reasoningEffort } : {}),
              ...(req.tools?.length
                ? {
                    tools: req.tools.map((t) => ({ type: 'function', function: t })),
                    tool_choice: 'auto',
                  }
                : {}),
            }),
          },
        );
        if (res.status === 429 || res.status >= 500) throw new Error(`LLM HTTP ${res.status}`);
        if (!res.ok) throw new LlmUnavailable(`LLM HTTP ${res.status}`); // 4xx other than 429: do not retry
        const j: any = await res.json();
        const m = j.choices?.[0]?.message;
        if (!m) throw new Error('LLM returned no message');
        if (j.choices[0].finish_reason === 'length')
          throw new LlmUnavailable('LLM response exceeded its token budget');
        if (!m.content?.trim() && !m.tool_calls?.length)
          throw new LlmUnavailable('LLM returned no answer or tool call');
        return {
          content: m.content ?? null,
          toolCalls: (m.tool_calls ?? []).map((c: any) => ({
            id: c.id,
            name: c.function.name,
            arguments: c.function.arguments,
          })),
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof LlmUnavailable) break;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LlmUnavailable(`LLM unavailable: ${(lastErr as Error)?.message ?? lastErr}`);
  }
}

export type NemotronOptions = CompatibleModelOptions;

/** Legacy NVIDIA configuration is retained for existing installations. */
export class NemotronProvider extends CompatibleModelProvider {
  constructor(options: NemotronOptions) {
    super('nemotron', options);
  }
  static fromEnv(env = process.env): NemotronProvider | null {
    if (!env.LLM_API_KEY?.trim()) return null;
    return new NemotronProvider({
      baseUrl: env.LLM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      apiKey: env.LLM_API_KEY.trim(),
      model: env.LLM_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b',
      timeoutMs: modelTimeout(env),
    });
  }
}

function modelTimeout(env: NodeJS.ProcessEnv): number {
  const value = Number(env.LLM_TIMEOUT_MS || 8000);
  if (!Number.isFinite(value) || value < 1 || value > 120000)
    throw new Error('LLM_TIMEOUT_MS must be between 1 and 120000');
  return value;
}

export class TogetherProvider extends CompatibleModelProvider {
  constructor(options: Omit<CompatibleModelOptions, 'baseUrl'>) {
    super('together', { ...options, baseUrl: 'https://api.together.ai/v1' });
  }
  static fromEnv(env = process.env): TogetherProvider | null {
    // Never send an existing NVIDIA key to Together or inherit its model/base URL.
    if (!env.TOGETHER_API_KEY?.trim()) return null;
    const model = env.TOGETHER_MODEL?.trim() || 'openai/gpt-oss-120b';
    const effort = env.TOGETHER_REASONING_EFFORT || 'low';
    if (!['low', 'medium', 'high'].includes(effort))
      throw new Error('TOGETHER_REASONING_EFFORT must be low, medium or high');
    return new TogetherProvider({
      apiKey: env.TOGETHER_API_KEY.trim(),
      model,
      timeoutMs: modelTimeout(env),
      reasoningEffort: model.startsWith('openai/gpt-oss-')
        ? (effort as 'low' | 'medium' | 'high')
        : undefined,
    });
  }
}

/** Sahayak owns this selection independently of agent authoring/channel services. */
export function modelProviderFromEnv(env = process.env): LlmProvider | null {
  switch ((env.LLM_PROVIDER || 'nemotron').trim().toLowerCase()) {
    case 'offline':
      return null;
    case 'nemotron':
    case 'nvidia':
      return NemotronProvider.fromEnv(env);
    case 'together':
      return TogetherProvider.fromEnv(env);
    default:
      throw new Error('LLM_PROVIDER must be nemotron, nvidia, together or offline');
  }
}

/**
 * Wraps a provider and tracks health. Agents ask `gate.available()`; when the model is down or slow,
 * everything falls back to plain software and the console shows a banner (via `llm_status` events).
 */
export class LlmGate {
  private failures = 0;
  private downUntil = 0;
  private lastReported: boolean | null = null;
  constructor(
    public provider: LlmProvider | null,
    private bus?: EventBus,
    private clinicIds: () => string[] = () => [],
  ) {}

  available(): boolean {
    return !!this.provider && Date.now() >= this.downUntil;
  }
  get configured() {
    return !!this.provider;
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    if (!this.provider || !this.available()) throw new LlmUnavailable('LLM not available');
    try {
      const out = await this.provider.chat(req);
      this.failures = 0;
      this.report(true);
      return out;
    } catch (e) {
      if (++this.failures >= 2) {
        this.downUntil = Date.now() + 30_000;
        this.report(false);
      }
      throw e instanceof LlmUnavailable ? e : new LlmUnavailable((e as Error).message);
    }
  }
  private report(ok: boolean) {
    if (this.lastReported === ok) return;
    this.lastReported = ok;
    for (const id of this.clinicIds()) this.bus?.publish(id, { type: 'llm_status', ok });
  }
  status() {
    return { configured: this.configured, ok: this.configured ? this.available() : false };
  }
}
