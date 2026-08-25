import { Test } from '@nestjs/testing';
import { PipelineService } from './pipeline.service';
import { PostingsRepository } from '../db/postings.repository';
import { ClassifierService } from '../classifier/classifier.service';
import { BUILD_SOURCES } from '../sources/sources.module';
import { SettingsService } from '../settings/settings.service';
import { NotifyConfig } from '../notify/notify.config';
import { NOTIFIER } from '../notify/types';
import { LLM_PROVIDER } from '../classifier/classifier.module';
import type { JobSource, RawPosting } from '../types';
import type { AppSettings } from '../settings/schema';

function posting(id: string, over: Partial<RawPosting> = {}): RawPosting {
  return {
    id, source: 'x', externalId: id, url: `https://e.com/${id}`, title: 'T',
    company: 'C', location: 'Remote', employmentType: 'full-time',
    description: 'node postgres', raw: {}, ...over,
  };
}

function source(id: string, out: RawPosting[] | Error): JobSource {
  return { id, listPostings: async () => { if (out instanceof Error) throw out; return out; } };
}

function fakeRepo() {
  const seen = new Set<string>();
  const withScore = new Set<string>();
  return {
    scored: [] as { postingId: string; total: number }[],
    runs: [] as { source: string; status: string }[],
    upsert: jest.fn(async (p: RawPosting) => {
      const isNew = !seen.has(p.id); seen.add(p.id); return { isNew };
    }),
    hasScore: jest.fn(async (id: string) => withScore.has(id)),
    insertScore: jest.fn(async function (this: any, postingId: string, v: any) {
      withScore.add(postingId);
      this.scored.push({ postingId, total: v.total });
      return this.scored.length;
    }),
    pendingNotifications: jest.fn(async () => [] as any[]),
    recordNotification: jest.fn(async () => {}),
    logRun: jest.fn(async function (this: any, source: string, status: string) {
      this.runs.push({ source, status });
    }),
  };
}

const settings: AppSettings = {
  cv: 'a real cv',
  profile: {
    excludedLocations: ['onsite: usa'], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
  },
  rubric: {
    version: '1', body: 'r',
    weights: { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 },
  },
  sources: { ats: [{ board: 'greenhouse', slug: 'acme' }], djinni: [], dou: [] },
};

async function build(over: {
  sources?: JobSource[];
  settings?: AppSettings;
  classify?: (p: RawPosting, s: AppSettings) => Promise<any>;
  notifier?: { channel: string; send: (i: any) => Promise<void> };
  repo?: ReturnType<typeof fakeRepo>;
} = {}) {
  const repo = over.repo ?? fakeRepo();
  const classify = over.classify ?? (async () => ({
    total: 80, verdict: 'STRONG', subscores: {}, reasoning: 'ok',
    providerId: 'fake', settingsVersion: '1',
  }));
  const sources = over.sources ?? [source('a', [posting('a:1')])];

  const moduleRef = await Test.createTestingModule({
    providers: [
      PipelineService,
      { provide: PostingsRepository, useValue: repo },
      { provide: ClassifierService, useValue: { classify } },
      { provide: SettingsService, useValue: { load: async () => over.settings ?? settings } },
      { provide: BUILD_SOURCES, useValue: () => sources },
      { provide: NotifyConfig, useValue: { thresholdFor: () => 50 } },
      { provide: NOTIFIER, useValue: over.notifier ?? { channel: 'telegram', send: async () => {} } },
      { provide: LLM_PROVIDER, useValue: { id: 'fake' } },
    ],
  }).compile();

  return { svc: moduleRef.get(PipelineService), repo };
}

describe('PipelineService', () => {
  it('classifies a new posting and records the score', async () => {
    const { svc, repo } = await build();
    const summary = await svc.run();
    expect(summary.fetched).toBe(1);
    expect(summary.classified).toBe(1);
    expect(repo.scored[0]!.total).toBe(80);
  });

  it('skips a posting that already has a score and never classifies it', async () => {
    const classify = jest.fn(async () => ({
      total: 80, verdict: 'STRONG', subscores: {}, reasoning: 'ok',
      providerId: 'fake', settingsVersion: '1',
    }));
    const { svc } = await build({
      sources: [source('a', [posting('a:1'), posting('a:1')])], classify,
    });
    const summary = await svc.run();
    expect(summary.skippedDuplicate).toBe(1);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('hard-filters before the classifier is called', async () => {
    const classify = jest.fn();
    const { svc, repo } = await build({
      sources: [source('a', [posting('a:9', { location: 'Onsite: USA' })])], classify,
    });
    const summary = await svc.run();
    expect(summary.hardFiltered).toBe(1);
    expect(classify).not.toHaveBeenCalled();
    expect(repo.scored[0]!.total).toBe(0);
  });

  it('isolates a failing source and still processes the others', async () => {
    const { svc, repo } = await build({
      sources: [source('broken', new Error('selector miss')), source('ok', [posting('ok:1')])],
    });
    const summary = await svc.run();
    expect(summary.sourceErrors).toBe(1);
    expect(summary.classified).toBe(1);
    expect(repo.runs).toContainEqual({ source: 'broken', status: 'error' });
    expect(repo.runs).toContainEqual({ source: 'ok', status: 'ok' });
  });

  it('records a failed notification without aborting the run', async () => {
    const repo = fakeRepo();
    repo.pendingNotifications = jest.fn(async () => ([{
      scoreId: 7, postingId: 'a:1', title: 'T', company: 'C',
      url: 'u', location: null, total: 80, verdict: 'STRONG', reasoning: 'r',
    }])) as any;
    const { svc } = await build({
      repo,
      notifier: { channel: 'telegram', send: async () => { throw new Error('telegram down'); } },
    });
    const summary = await svc.run();
    expect(summary.notifyErrors).toBe(1);
    expect(repo.recordNotification).toHaveBeenCalledWith(7, 'telegram', 'telegram down');
  });

  it('retries a posting whose classification failed on the previous run', async () => {
    const repo = fakeRepo();
    const src = source('a', [posting('a:1')]);

    const failing = await build({
      repo, sources: [src], classify: async () => { throw new Error('bad json'); },
    });
    const first = await failing.svc.run();
    expect(first.classifyErrors).toBe(1);
    expect(repo.scored).toHaveLength(0);

    const working = await build({ repo, sources: [src] });
    const second = await working.svc.run();
    expect(second.skippedDuplicate).toBe(0);
    expect(second.classified).toBe(1);
  });
});

describe('incomplete settings', () => {
  it('skips the run and logs when the CV is empty', async () => {
    const repo = fakeRepo();
    const { svc } = await build({ repo, settings: { ...settings, cv: '   ' } });
    const s = await svc.run();

    expect(s.fetched).toBe(0);
    expect(s.classified).toBe(0);
    expect(repo.runs).toEqual([{ source: 'settings', status: 'error' }]);
    expect(repo.logRun).toHaveBeenCalledWith(
      'settings', 'error', 0, expect.stringMatching(/settings incomplete: no CV/),
    );
  });

  it('skips the run and logs when no source is enabled', async () => {
    const repo = fakeRepo();
    const { svc } = await build({
      repo,
      settings: { ...settings, sources: { ats: [], djinni: [], dou: [] } },
    });
    const s = await svc.run();

    expect(s.fetched).toBe(0);
    expect(repo.logRun).toHaveBeenCalledWith(
      'settings', 'error', 0, expect.stringMatching(/no enabled sources/),
    );
  });

  it('never calls the classifier when settings are incomplete', async () => {
    const classify = jest.fn();
    const { svc } = await build({ classify, settings: { ...settings, cv: '' } });
    await svc.run();
    expect(classify).not.toHaveBeenCalled();
  });

  it('runs normally when settings are complete', async () => {
    const { svc } = await build();
    const s = await svc.run();
    expect(s.fetched).toBe(1);
  });
});
