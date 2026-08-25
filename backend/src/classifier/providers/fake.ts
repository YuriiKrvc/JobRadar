import type { CompletionRequest, LLMProvider } from './types';

export class FakeProvider implements LLMProvider {
  readonly id = 'fake';
  readonly calls: CompletionRequest[] = [];
  private queue: string[];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async complete(req: CompletionRequest) {
    this.calls.push(req);
    const raw = this.queue.shift();
    if (raw === undefined) throw new Error('FakeProvider ran out of queued responses');
    return { raw };
  }
}
