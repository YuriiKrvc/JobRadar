import { Test } from '@nestjs/testing';
import { PipelineService } from './pipeline.service';
import { PostingsRepository } from '../db/postings.repository';
import { ClassifierService } from '../classifier/classifier.service';
import { BUILD_SOURCE } from '../sources/sources.module';
import { SettingsService } from '../settings/settings.service';
import { NotifyConfig } from '../notify/notify.config';
import { NOTIFIER } from '../notify/types';
import { LLM_PROVIDER } from '../classifier/classifier.module';
import type { JobSource, RawPosting } from '../types';
import type { AppSettings, SourceSpec } from '../settings/schema';

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

// A spec whose `name` is the fake source's id: that is the key the injected
// BUILD_SOURCE resolves on, exactly as the real factory names its adapter
// after the spec.
function spec(name: string): SourceSpec {
  return {
    id: `id-${name}`,
    name,
    url: `https://${name}.example.com/jobs`,
    selectors: { item: 'li', link: 'a' },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
  };
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
    blockedTitleWords: [], blockedDescriptionWords: [],
  },
  rubric: {
    version: '1', body: 'r',
    weights: { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 },
  },
  sources: [spec('a')],
};

function withProfile(over: Partial<AppSettings['profile']>): AppSettings {
  return { ...settings, profile: { ...settings.profile, ...over } };
}

async function build(over: {
  sources?: JobSource[];
  settings?: AppSettings;
  specs?: Array<{ name: string; blockedTitleWords?: string[]; blockedDescriptionWords?: string[] }>;
  loadSettings?: () => Promise<AppSettings>;
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
  const byName = new Map(sources.map((src) => [src.id, src]));
  // Unless the test pins its own `sources` array (e.g. to test the
  // no-sources-enabled path), the snapshot's specs are derived from the fakes
  // it passed in, so every spec resolves to one of them — even when the test
  // also overrides `settings` for an unrelated field like `profile`.
  const derivedSpecs = sources.map((src) => spec(src.id));
  const loaded = over.settings
    ? { ...over.settings, sources: over.settings.sources === settings.sources ? derivedSpecs : over.settings.sources }
    : { ...settings, sources: derivedSpecs };
  // A test that wants one source to carry its own word lists patches the
  // snapshot's specs by name after it's built, rather than hand-rolling a
  // whole SourceSpec.
  if (over.specs) {
    const patchByName = new Map(over.specs.map((p) => [p.name, p]));
    loaded.sources = loaded.sources.map((sp) => {
      const patch = patchByName.get(sp.name);
      return patch
        ? {
            ...sp,
            blockedTitleWords: patch.blockedTitleWords ?? sp.blockedTitleWords,
            blockedDescriptionWords: patch.blockedDescriptionWords ?? sp.blockedDescriptionWords,
          }
        : sp;
    });
  }

  const moduleRef = await Test.createTestingModule({
    providers: [
      PipelineService,
      { provide: PostingsRepository, useValue: repo },
      { provide: ClassifierService, useValue: { classify } },
      {
        provide: SettingsService,
        useValue: { load: over.loadSettings ?? (async () => loaded) },
      },
      { provide: BUILD_SOURCE, useValue: (s: SourceSpec) => byName.get(s.name)! },
      { provide: NotifyConfig, useValue: { thresholdFor: () => 50 } },
      { provide: NOTIFIER, useValue: over.notifier ?? { channel: 'telegram', send: async () => {} } },
      { provide: LLM_PROVIDER, useValue: { id: 'fake' } },
    ],
  }).compile();

  // `svc` is the original name; `service` is an alias so the newer tests can
  // use the name the brief specifies without a rewrite of the existing ones.
  const svc = moduleRef.get(PipelineService);
  return { svc, service: svc, repo };
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
      settings: { ...settings, sources: [] },
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

// The spec's Error handling section: "Settings read failure in the worker
// writes a run_log row and returns." Without it the only trace of an unseeded
// or degraded database is a stderr line, and the dashboard shows an empty
// table with no banner and no health row.
describe('settings read failure', () => {
  it('writes a run_log row and returns a zero summary', async () => {
    const repo = fakeRepo();
    const { svc } = await build({
      repo,
      loadSettings: async () => { throw new Error('Run the seeder: app_settings is empty'); },
    });

    const s = await svc.run();

    expect(s.fetched).toBe(0);
    expect(s.classified).toBe(0);
    expect(repo.runs).toEqual([{ source: 'settings', status: 'error' }]);
    expect(repo.logRun).toHaveBeenCalledWith(
      'settings', 'error', 0, expect.stringMatching(/Run the seeder/),
    );
  });

  it('does not propagate the error to the caller', async () => {
    const { svc } = await build({
      loadSettings: async () => { throw new Error('connection refused'); },
    });
    await expect(svc.run()).resolves.toMatchObject({ fetched: 0 });
  });

  it('never builds sources or classifies when settings cannot be read', async () => {
    const classify = jest.fn();
    const { svc } = await build({
      classify,
      loadSettings: async () => { throw new Error('boom'); },
    });
    await svc.run();
    expect(classify).not.toHaveBeenCalled();
  });
});

describe('blocklists and hydration', () => {
  it('rejects a blocked title without fetching the detail page', async () => {
    const hydrate = jest.fn(async (p: RawPosting) => ({ ...p, description: 'full body' }));
    const src: JobSource = { id: 'Acme', listPostings: async () => [posting('a:1', { title: 'PHP Developer' })], hydrate };
    const { service, repo } = await build({
      sources: [src],
      settings: withProfile({ blockedTitleWords: ['php'] }),
    });

    const s = await service.run();

    expect(hydrate).not.toHaveBeenCalled();
    expect(s.hardFiltered).toBe(1);
    expect(repo.insertScore).toHaveBeenCalledWith('a:1', expect.objectContaining({
      total: 0, verdict: 'NO', providerId: 'hard-filter',
      reasoning: 'hard-filter:title-word:php',
    }));
  });

  it('unions the global and per-source title words', async () => {
    const src: JobSource = { id: 'Acme', listPostings: async () => [posting('a:1', { title: 'Intern Engineer' })] };
    const { service } = await build({
      sources: [src],
      specs: [{ name: 'Acme', blockedTitleWords: ['intern'] }],
      settings: withProfile({ blockedTitleWords: ['php'] }),
    });
    expect((await service.run()).hardFiltered).toBe(1);
  });

  it('hydrates a new posting, re-upserts it, and classifies the fetched body', async () => {
    const hydrate = jest.fn(async (p: RawPosting) => ({ ...p, description: 'node postgres deep dive' }));
    const src: JobSource = { id: 'Acme', listPostings: async () => [posting('a:1', { description: '' })], hydrate };
    const classify = jest.fn(async (_p: RawPosting, _s: AppSettings) => ({
      total: 80, verdict: 'STRONG', subscores: {}, reasoning: 'ok',
      providerId: 'fake', settingsVersion: '1',
    }));
    const { service, repo } = await build({ sources: [src], classify });

    await service.run();

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(repo.upsert).toHaveBeenCalledTimes(2);
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: 'node postgres deep dive' }),
    );
    expect(classify.mock.calls[0]![0].description).toBe('node postgres deep dive');
  });

  it('does not hydrate a posting that already has a score', async () => {
    const hydrate = jest.fn(async (p: RawPosting) => p);
    const src: JobSource = { id: 'Acme', listPostings: async () => [posting('a:1')], hydrate };
    const repo = fakeRepo();
    await repo.insertScore('a:1', { total: 10 } as any);
    const { service } = await build({ sources: [src], repo });

    const s = await service.run();

    expect(hydrate).not.toHaveBeenCalled();
    expect(s.skippedDuplicate).toBe(1);
  });

  it('leaves a posting unscored and logs a source error when hydrate throws', async () => {
    const src: JobSource = {
      id: 'Acme',
      listPostings: async () => [posting('a:1')],
      hydrate: async () => { throw new Error('HTTP 404'); },
    };
    const { service, repo } = await build({ sources: [src] });

    const s = await service.run();

    expect(s.sourceErrors).toBe(1);
    expect(s.classified).toBe(0);
    expect(repo.insertScore).not.toHaveBeenCalled();
    expect(repo.runs).toEqual(expect.arrayContaining([{ source: 'Acme', status: 'error' }]));
  });

  it('applies the description blocklist to the hydrated body, not the snippet', async () => {
    const src: JobSource = {
      id: 'Acme',
      listPostings: async () => [posting('a:1', { description: 'clean snippet' })],
      hydrate: async (p) => ({ ...p, description: 'Relocation required to Berlin' }),
    };
    const { service, repo } = await build({
      sources: [src],
      settings: withProfile({ blockedDescriptionWords: ['relocation required'] }),
    });

    expect((await service.run()).hardFiltered).toBe(1);
    expect(repo.insertScore).toHaveBeenCalledWith('a:1', expect.objectContaining({
      reasoning: 'hard-filter:description-word:relocation required',
    }));
  });

  it('still runs when a source has no hydrate method', async () => {
    const src: JobSource = { id: 'Legacy', listPostings: async () => [posting('a:1')] };
    const { service } = await build({ sources: [src] });
    expect((await service.run()).classified).toBe(1);
  });
});
