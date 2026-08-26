import { createOpenAiCompatProvider } from './openai-compat';
import { VERDICT_JSON_SCHEMA } from '../schema';

function capture(responseBody: unknown) {
  const seen: any[] = [];
  const fetchFn = async (url: string, init?: any) => {
    seen.push({ url, body: JSON.parse(init.body), init });
    return new Response(JSON.stringify(responseBody), { status: 200 });
  };
  return { seen, fetchFn: fetchFn as any };
}

const ok = { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } };

describe('openai-compat provider', () => {
  it('posts to /chat/completions with system and user messages', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://localhost:11434/v1', model: 'qwen3:14b', jsonSchemaSupport: true, fetchFn,
    });
    const out = await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(seen[0].body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(out.raw).toBe('{"a":1}');
    expect(out.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('uses response_format json_schema when the server supports it', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://localhost:11434/v1', model: 'm', jsonSchemaSupport: true, fetchFn,
    });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].body.response_format.type).toBe('json_schema');
    expect(seen[0].body.messages[0].content).toBe('s');
  });

  it('falls back to schema-in-the-prompt when unsupported', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://localhost:11434/v1', model: 'm', jsonSchemaSupport: false, fetchFn,
    });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].body.response_format).toBeUndefined();
    expect(seen[0].body.messages[0].content).toContain('"subscores"');
  });

  it('strips a trailing slash from baseUrl', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({ baseUrl: 'http://localhost:11434/v1/', model: 'm', fetchFn });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('throws on a non-ok response', async () => {
    const fetchFn = (async () => new Response('boom', { status: 500 })) as any;
    const p = createOpenAiCompatProvider({ baseUrl: 'http://x/v1', model: 'm', fetchFn });
    await expect(p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA }))
      .rejects.toThrow(/500/);
  });

  it('passes an abort signal on every request', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({ baseUrl: 'http://x/v1', model: 'm', fetchFn });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].init.signal.aborted).toBe(false);
  });

  it('aborts the request once timeoutMs elapses', async () => {
    // A server that never answers: the only thing that can settle this
    // promise is the signal the provider is expected to pass.
    const fetchFn = ((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as any;
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://x/v1', model: 'm', timeoutMs: 10, fetchFn,
    });
    await expect(p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA }))
      .rejects.toThrow(/abort/i);
  });

  it('does not abort a request that answers within timeoutMs', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://x/v1', model: 'm', timeoutMs: 5000, fetchFn,
    });
    const out = await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(out.raw).toBe('{"a":1}');
    expect(seen[0].init.signal.aborted).toBe(false);
  });
});
