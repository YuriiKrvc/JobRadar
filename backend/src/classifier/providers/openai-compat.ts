import type { CompletionRequest, LLMProvider } from './types';

export interface OpenAiCompatOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Set true for servers that honour response_format json_schema (vLLM, recent Ollama). */
  jsonSchemaSupport?: boolean;
  maxTokens?: number;
  /**
   * Abort a request after this many ms. A local model can hang where a hosted
   * API would not, and PipelineService awaits classification inline — one hung
   * request stalls the whole tick. Generous by default: a cold 8B model on CPU
   * can legitimately take a minute, and a timeout that fires on a slow but
   * working request is worse than no timeout at all.
   */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function createOpenAiCompatProvider(opts: OpenAiCompatOptions): LLMProvider {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetchFn ?? fetch;

  return {
    id: `openai-compat:${opts.model}`,
    async complete(req: CompletionRequest) {
      const system = opts.jsonSchemaSupport
        ? req.system
        : `${req.system}\n\nReturn JSON conforming exactly to this schema:\n${JSON.stringify(req.schema)}`;

      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.user },
        ],
      };

      if (opts.jsonSchemaSupport) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'fit_verdict', schema: req.schema, strict: true },
        };
      }

      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });

      if (!res.ok) {
        throw new Error(`${this.id} returned HTTP ${res.status}: ${await res.text()}`);
      }

      const json: any = await res.json();
      const raw = json.choices?.[0]?.message?.content;
      if (typeof raw !== 'string') throw new Error(`${this.id} returned no message content`);

      const usage = json.usage
        ? { inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 }
        : undefined;

      return { raw, usage };
    },
  };
}
