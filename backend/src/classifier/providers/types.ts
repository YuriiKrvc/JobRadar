/**
 * DI token for the active provider. It lives here, not in classifier.module.ts,
 * because ClassifierService needs it: importing it from the module would make
 * module and service import each other and Nest would throw
 * CircularDependencyException while scanning ClassifierModule's providers.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export interface LLMProvider {
  readonly id: string;
  complete(req: CompletionRequest): Promise<{ raw: string; usage?: TokenUsage }>;
}
