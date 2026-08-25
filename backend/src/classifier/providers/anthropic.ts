import Anthropic from '@anthropic-ai/sdk';
import type { CompletionRequest, LLMProvider } from './types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5';

export interface MessagesClient {
  messages: { create(params: Record<string, unknown>): Promise<any> };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  client?: MessagesClient;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LLMProvider {
  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
  // The SDK's `create` is overloaded on streaming/non-streaming params, so it does
  // not structurally match this narrow injection seam. The cast is safe: we only
  // ever call it with the non-streaming shape below.
  const client: MessagesClient =
    opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as MessagesClient);

  return {
    id: `anthropic:${model}`,
    async complete(req: CompletionRequest) {
      // Deliberately omitted for Haiku 4.5: output_config.effort (errors),
      // thinking (unnecessary), and cache_control (prefix is under the
      // 4096-token cache minimum, so a marker is a silent no-op).
      const res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: req.schema } },
      });

      const block = (res.content ?? []).find((b: any) => b.type === 'text');
      if (!block) throw new Error('Anthropic response contained no text block');

      const usage = res.usage
        ? { inputTokens: res.usage.input_tokens ?? 0, outputTokens: res.usage.output_tokens ?? 0 }
        : undefined;

      return { raw: block.text as string, usage };
    },
  };
}
