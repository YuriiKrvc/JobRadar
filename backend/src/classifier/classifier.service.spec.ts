import { Test } from '@nestjs/testing';
import { ClassifierService } from './classifier.service';
import { LLM_PROVIDER } from './classifier.module';
import { FakeProvider } from './providers/fake';
import type { CompletionRequest, LLMProvider } from './providers/types';
import type { RawPosting } from '../types';
import type { AppSettings } from '../settings/schema';

const posting: RawPosting = {
  id: 'x:1', source: 'x', externalId: '1', url: 'https://e.com/1',
  title: 'Node Engineer', company: 'Acme', location: 'Remote',
  employmentType: 'full-time', description: 'Node and Postgres', raw: {},
};

const good = JSON.stringify({
  subscores: {
    coreStack: { score: 90, note: 'node + pg match' },
    seniority: { score: 80, note: 'senior' },
    domain: { score: 60, note: 'adjacent' },
    logistics: { score: 100, note: 'remote' },
    growth: { score: 70, note: 'good' },
  },
  summary: 'Strong stack overlap, remote friendly.',
});

const settings: AppSettings = {
  cv: 'cv',
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
    blockedTitleWords: [], blockedDescriptionWords: [],
  },
  rubric: {
    version: '1',
    body: 'score five dimensions',
    weights: { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 },
  },
  sources: [],
};

async function service(responses: string[]) {
  const provider = new FakeProvider(responses);
  const moduleRef = await Test.createTestingModule({
    providers: [
      ClassifierService,
      { provide: LLM_PROVIDER, useValue: provider },
    ],
  }).compile();
  return { svc: moduleRef.get(ClassifierService), provider };
}

describe('ClassifierService', () => {
  it('computes the total in code and bands the verdict', async () => {
    const { svc } = await service([good]);
    const v = await svc.classify(posting, settings);
    expect(v.total).toBe(84); // 8350 / 100 = 83.5, rounds to 84
    expect(v.verdict).toBe('STRONG');
    expect(v.providerId).toBe('fake');
    expect(v.settingsVersion).toBe('1');
  });

  it('uses the weights from the snapshot, not a hardcoded constant', async () => {
    const { svc } = await service([good]);
    const coreOnly: AppSettings = {
      ...settings,
      rubric: {
        ...settings.rubric,
        weights: { coreStack: 100, seniority: 0, domain: 0, logistics: 0, growth: 0 },
      },
    };
    const v = await svc.classify(posting, coreOnly);
    expect(v.total).toBe(90); // the coreStack subscore alone
  });

  it('retries once with the validation error when the first response is invalid', async () => {
    const { svc, provider } = await service(['not json at all', good]);
    const v = await svc.classify(posting, settings);
    expect(v.total).toBe(84);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.user).toMatch(/previous response was invalid/i);
  });

  it('throws after a failed repair attempt', async () => {
    const { svc, provider } = await service(['garbage', 'still garbage']);
    await expect(svc.classify(posting, settings)).rejects.toThrow(/failed schema validation twice/i);
    expect(provider.calls).toHaveLength(2);
  });

  it('tolerates prose wrapped around a JSON object', async () => {
    const { svc } = await service(['Here you go:\n```json\n' + good + '\n```\nDone.']);
    expect((await svc.classify(posting, settings)).total).toBe(84);
  });

  it('rejects out-of-range dimension scores', async () => {
    const bad = JSON.stringify({
      subscores: {
        coreStack: { score: 150, note: 'x' }, seniority: { score: 0, note: 'x' },
        domain: { score: 0, note: 'x' }, logistics: { score: 0, note: 'x' },
        growth: { score: 0, note: 'x' },
      },
      summary: 's',
    });
    const { svc } = await service([bad, bad]);
    await expect(svc.classify(posting, settings)).rejects.toThrow();
  });

  it('does not retry a timeout with a repair prompt', async () => {
    const timeoutError = new DOMException('signal timed out', 'TimeoutError');
    let calls = 0;
    const provider: LLMProvider = {
      id: 'timeout-fake',
      async complete(_req: CompletionRequest) {
        calls += 1;
        throw timeoutError;
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ClassifierService, { provide: LLM_PROVIDER, useValue: provider }],
    }).compile();
    const svc = moduleRef.get(ClassifierService);

    await expect(svc.classify(posting, settings)).rejects.toBe(timeoutError);
    expect(calls).toBe(1);
  });

  it('does not retry an explicit abort with a repair prompt', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    let calls = 0;
    const provider: LLMProvider = {
      id: 'abort-fake',
      async complete(_req: CompletionRequest) {
        calls += 1;
        throw abortError;
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ClassifierService, { provide: LLM_PROVIDER, useValue: provider }],
    }).compile();
    const svc = moduleRef.get(ClassifierService);

    await expect(svc.classify(posting, settings)).rejects.toBe(abortError);
    expect(calls).toBe(1);
  });
});
