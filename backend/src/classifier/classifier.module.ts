import { Module } from '@nestjs/common';
import { ClassifierService } from './classifier.service';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAiCompatProvider } from './providers/openai-compat';
import { LLM_PROVIDER, type LLMProvider } from './providers/types';

// Re-exported for callers that already import the token from this module.
export { LLM_PROVIDER };

/**
 * Exported for its unit test. A non-numeric or non-positive value must fall
 * back rather than reach AbortSignal.timeout, which treats NaN as 0 and would
 * abort every request instantly — a typo that silently breaks all scoring.
 */
export function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LLM_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

export function selectProvider(env: NodeJS.ProcessEnv): LLMProvider {
  if (env.LLM_BASE_URL) {
    return createOpenAiCompatProvider({
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL ?? 'llama3.1',
      apiKey: env.LLM_API_KEY,
      jsonSchemaSupport: env.LLM_JSON_SCHEMA === 'true',
      timeoutMs: resolveTimeoutMs(env),
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
  }
  throw new Error('Set ANTHROPIC_API_KEY, or LLM_BASE_URL for a local model');
}

@Module({
  providers: [
    ClassifierService,
    { provide: LLM_PROVIDER, useFactory: (): LLMProvider => selectProvider(process.env) },
  ],
  exports: [ClassifierService, LLM_PROVIDER],
})
export class ClassifierModule {}
