import { resolveTimeoutMs, selectProvider } from './classifier.module';

// selectProvider takes env as an argument rather than reading process.env,
// which is the whole reason it is testable without mutating global state.
describe('selectProvider', () => {
  it('prefers a local base URL over an Anthropic key', () => {
    const p = selectProvider({
      LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      LLM_MODEL: 'llama3.1',
      ANTHROPIC_API_KEY: 'sk-ant-stale',
    } as NodeJS.ProcessEnv);
    expect(p.id).toBe('openai-compat:llama3.1');
  });

  it('defaults the model to llama3.1', () => {
    const p = selectProvider({ LLM_BASE_URL: 'http://x/v1' } as NodeJS.ProcessEnv);
    expect(p.id).toBe('openai-compat:llama3.1');
  });

  it('parses LLM_TIMEOUT_MS', () => {
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '30000' } as NodeJS.ProcessEnv)).toBe(30000);
  });

  it('falls back to 120000 when LLM_TIMEOUT_MS is absent', () => {
    expect(resolveTimeoutMs({} as NodeJS.ProcessEnv)).toBe(120000);
  });

  it('falls back to 120000 when LLM_TIMEOUT_MS is not a positive number', () => {
    // NaN or 0 would make AbortSignal.timeout abort every request immediately,
    // turning a typo into a classifier that never succeeds.
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: 'soon' } as NodeJS.ProcessEnv)).toBe(120000);
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv)).toBe(120000);
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '-5' } as NodeJS.ProcessEnv)).toBe(120000);
  });

  it('throws when neither a base URL nor an Anthropic key is set', () => {
    expect(() => selectProvider({} as NodeJS.ProcessEnv)).toThrow(/LLM_BASE_URL/);
  });
});
