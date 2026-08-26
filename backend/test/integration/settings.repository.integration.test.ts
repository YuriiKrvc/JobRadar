import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { appSettings, sources } from '../../src/db/schema';
import { SettingsRepository } from '../../src/settings/settings.repository';
import { SettingsService } from '../../src/settings/settings.service';
import { SettingsController } from '../../src/settings/settings.controller';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);
const repo = new SettingsRepository(db);
const service = new SettingsService(repo);
const controller = new SettingsController(repo);

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const PROFILE = {
  excludedLocations: ['United States'], allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000, timezone: 'Europe/Kyiv',
  blockedTitleWords: [], blockedDescriptionWords: [],
};

const SELECTORS = { item: 'li.job', link: 'a.title' };

/** A minimal SourceInput; callers override name/url to stay unique. */
function sourceInput(over: Partial<{ name: string; url: string; selectors: any;
  blockedTitleWords: string[]; blockedDescriptionWords: string[] }> = {}) {
  return {
    name: 'Acme',
    url: 'https://acme.example/careers',
    selectors: SELECTORS,
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    ...over,
  };
}

beforeEach(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
  await db.insert(appSettings).values({
    cv: 'seed cv', rubricBody: 'seed rubric', rubricWeights: WEIGHTS, profile: PROFILE,
  });
});

afterAll(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
  await sql.end();
});

describe('SettingsRepository documents', () => {
  it('reads the singleton row', async () => {
    const row = await repo.readRow();
    expect(row.cv).toBe('seed cv');
    expect(row.version).toBe(1);
  });

  it('bumps the version on a cv update', async () => {
    await repo.updateCv('new cv');
    const row = await repo.readRow();
    expect(row.cv).toBe('new cv');
    expect(row.version).toBe(2);
  });

  it('bumps the version on a rubric update and stores weights', async () => {
    await repo.updateRubric('new rubric', { ...WEIGHTS, coreStack: 70 });
    const row = await repo.readRow();
    expect(row.rubricBody).toBe('new rubric');
    expect(row.rubricWeights.coreStack).toBe(70);
    expect(row.version).toBe(2);
  });

  it('surfaces an all-zero weights CHECK violation with its Postgres code', async () => {
    // Reaches the DB directly (bypassing RubricWeightsSchema's refine, which
    // normally blocks this) to exercise the app_settings_weights_nonzero
    // CHECK constraint and confirm bump() unwraps it the same way addSource
    // unwraps a unique violation.
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    await expect(
      repo.updateRubric('zeroed rubric', zeroed),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('bumps the version on a profile update', async () => {
    await repo.updateProfile({ ...PROFILE, minSalaryUsd: 9000 });
    const row = await repo.readRow();
    expect(row.profile.minSalaryUsd).toBe(9000);
    expect(row.version).toBe(2);
  });

  it('increments once per update, never skipping', async () => {
    await repo.updateCv('a');
    await repo.updateCv('b');
    await repo.updateProfile(PROFILE);
    expect((await repo.readRow()).version).toBe(4);
  });

  it('advances updatedAt', async () => {
    const before = (await repo.readRow()).updatedAt;
    await repo.updateCv('later');
    expect((await repo.readRow()).updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('SettingsRepository sources', () => {
  it('adds and lists a source', async () => {
    const added = await repo.addSource(sourceInput());
    expect(added.id).toBeTruthy();
    expect(added.enabled).toBe(true);
    expect(added.selectors).toEqual(SELECTORS);
    expect(await repo.listSources()).toHaveLength(1);
  });

  it('does not bump the settings version when sources change', async () => {
    await repo.addSource(sourceInput());
    expect((await repo.readRow()).version).toBe(1);
  });

  it('toggles enabled', async () => {
    const added = await repo.addSource(sourceInput());
    const off = await repo.setSourceEnabled(added.id, false);
    expect(off?.enabled).toBe(false);
  });

  it('returns null when toggling an unknown id', async () => {
    expect(await repo.setSourceEnabled('00000000-0000-0000-0000-000000000000', false)).toBeNull();
  });

  it('deletes a source and reports whether it existed', async () => {
    const added = await repo.addSource(sourceInput());
    expect(await repo.deleteSource(added.id)).toBe(true);
    expect(await repo.deleteSource(added.id)).toBe(false);
  });

  it('surfaces a duplicate url as a 23505 on sources_url_uniq', async () => {
    await repo.addSource(sourceInput());
    await expect(
      repo.addSource(sourceInput({ name: 'Acme mirror' })),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'sources_url_uniq' });
  });

  it('surfaces a duplicate name as a 23505 on sources_name_uniq', async () => {
    await repo.addSource(sourceInput());
    await expect(
      repo.addSource(sourceInput({ url: 'https://acme.example/other' })),
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'sources_name_uniq' });
  });

  it('replaceSource rewrites selectors and leaves enabled untouched', async () => {
    // enabled is owned by PATCH, so a form save on a paused board must not
    // quietly restart it.
    const added = await repo.addSource(sourceInput());
    await repo.setSourceEnabled(added.id, false);

    const next = { item: 'div.vacancy', link: 'a.vt', description: 'div.sh-info' };
    const row = await repo.replaceSource(added.id, sourceInput({
      name: 'Acme renamed', url: 'https://acme.example/jobs', selectors: next,
      blockedTitleWords: ['intern'],
    }));

    expect(row).not.toBeNull();
    expect(row!.selectors).toEqual(next);
    expect(row!.name).toBe('Acme renamed');
    expect(row!.url).toBe('https://acme.example/jobs');
    expect(row!.blockedTitleWords).toEqual(['intern']);
    expect(row!.enabled).toBe(false);
  });

  it('replaceSource returns null for an unknown id', async () => {
    expect(
      await repo.replaceSource('00000000-0000-0000-0000-000000000000', sourceInput()),
    ).toBeNull();
  });
});

describe('SettingsService.load', () => {
  it('composes a snapshot with only the enabled sources', async () => {
    await repo.addSource(sourceInput({ name: 'Live', url: 'https://live.example/jobs' }));
    const paused = await repo.addSource(
      sourceInput({ name: 'Paused', url: 'https://paused.example/jobs' }),
    );
    await repo.setSourceEnabled(paused.id, false);

    const s = await service.load();
    expect(s.cv).toBe('seed cv');
    expect(s.rubric.body).toBe('seed rubric');
    expect(s.rubric.weights).toEqual(WEIGHTS);
    expect(s.rubric.version).toBe('1');
    expect(s.profile.timezone).toBe('Europe/Kyiv');
    expect(s.profile.blockedTitleWords).toEqual([]);
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0]).toMatchObject({
      name: 'Live',
      url: 'https://live.example/jobs',
      selectors: SELECTORS,
      blockedTitleWords: [],
      blockedDescriptionWords: [],
    });
    expect(s.sources[0]!.id).toBeTruthy();
  });

  it('reports the current version as a string after an edit', async () => {
    await repo.updateCv('edited');
    expect((await service.load()).rubric.version).toBe('2');
  });

  it('throws a clear error when the settings row is missing', async () => {
    await sql`DELETE FROM app_settings`;
    await expect(service.load()).rejects.toThrow(/not initialised/i);
  });
});

// The upgrade path from a pre-branch install: the jsonb blob on disk has only
// the four v1 keys. Both read paths must default the two new arrays — they are
// separate parses, and letting only one of them do it blanked the dashboard.
describe('a v1-shaped profile blob', () => {
  const V1_PROFILE = {
    excludedLocations: ['United States'],
    allowedEmploymentTypes: ['full-time'],
    minSalaryUsd: 5000,
    timezone: 'Europe/Kyiv',
  };

  beforeEach(async () => {
    await sql`UPDATE app_settings SET profile = ${JSON.stringify(V1_PROFILE)}::jsonb`;
  });

  it('is stored without the blocked-word keys', async () => {
    const [row] = await sql`SELECT profile FROM app_settings`;
    expect(Object.keys(row!.profile).sort()).toEqual([
      'allowedEmploymentTypes', 'excludedLocations', 'minSalaryUsd', 'timezone',
    ]);
  });

  it('reads back as empty arrays through SettingsService.load()', async () => {
    const s = await service.load();
    expect(s.profile.blockedTitleWords).toEqual([]);
    expect(s.profile.blockedDescriptionWords).toEqual([]);
    expect(s.profile.minSalaryUsd).toBe(5000);
  });

  it('reads back as empty arrays through GET /api/settings', async () => {
    const body = await controller.read();
    expect(body.profile.blockedTitleWords).toEqual([]);
    expect(body.profile.blockedDescriptionWords).toEqual([]);
    expect(body.profile.minSalaryUsd).toBe(5000);
  });
});
