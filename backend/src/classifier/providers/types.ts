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
