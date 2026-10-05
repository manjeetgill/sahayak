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

export interface NemotronOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

/** NVIDIA-hosted Nemotron through the OpenAI-compatible chat completions API. */
export class NemotronProvider implements LlmProvider {
  readonly name = 'nemotron';
  constructor(private o: NemotronOptions) {}

  static fromEnv(env = process.env): NemotronProvider | null {
    if (!env.LLM_API_KEY) return null;
    return new NemotronProvider({
      baseUrl: env.LLM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b',
      timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 8000),
    });
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const retries = this.o.retries ?? 2;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
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
