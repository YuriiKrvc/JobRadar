import { createAnthropicProvider } from './anthropic';
import { VERDICT_JSON_SCHEMA } from '../schema';

function stubClient(text: string) {
  const seen: any[] = [];
  return {
    seen,
    messages: {
      create: async (params: any) => {
        seen.push(params);
        return {
          content: [{ type: 'text', text }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  };
}

describe('anthropic provider', () => {
  it('defaults to claude-haiku-4-5 and reports the model in its id', async () => {
    const client = stubClient('{"ok":true}');
    const p = createAnthropicProvider({ apiKey: 'k', client: client as any });
    expect(p.id).toBe('anthropic:claude-haiku-4-5');
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(client.seen[0].model).toBe('claude-haiku-4-5');
  });

  it('never sends effort, thinking, or cache_control', async () => {
    const client = stubClient('{"ok":true}');
    const p = createAnthropicProvider({ apiKey: 'k', client: client as any });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    const params = client.seen[0];
    expect(params.output_config?.effort).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain('cache_control');
  });

  it('requests structured output using the supplied schema', async () => {
    const client = stubClient('{"ok":true}');
    const p = createAnthropicProvider({ apiKey: 'k', client: client as any });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(client.seen[0].output_config.format.type).toBe('json_schema');
    expect(client.seen[0].output_config.format.schema).toBe(VERDICT_JSON_SCHEMA);
  });

  it('returns the text block and token usage', async () => {
    const p = createAnthropicProvider({ apiKey: 'k', client: stubClient('{"a":1}') as any });
    const out = await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(out.raw).toBe('{"a":1}');
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('throws when the response carries no text block', async () => {
    const client = { messages: { create: async () => ({ content: [], usage: {} }) } };
    const p = createAnthropicProvider({ apiKey: 'k', client: client as any });
    await expect(p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA }))
      .rejects.toThrow(/no text block/i);
  });
});
