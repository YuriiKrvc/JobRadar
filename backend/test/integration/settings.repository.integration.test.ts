import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { appSettings, sources } from '../../src/db/schema';
import { SettingsRepository } from '../../src/settings/settings.repository';
import { SettingsService } from '../../src/settings/settings.service';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);
const repo = new SettingsRepository(db);
const service = new SettingsService(repo);

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const PROFILE = {
  excludedLocations: ['United States'], allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000, timezone: 'Europe/Kyiv',
};

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
    const added = await repo.addSource({ kind: 'ats', board: 'greenhouse', slug: 'acme' });
    expect(added.id).toBeTruthy();
    expect(added.enabled).toBe(true);
    expect(await repo.listSources()).toHaveLength(1);
  });

  it('does not bump the settings version when sources change', async () => {
    await repo.addSource({ kind: 'dou', url: 'https://jobs.dou.ua/a/' });
    expect((await repo.readRow()).version).toBe(1);
  });

  it('toggles enabled', async () => {
    const added = await repo.addSource({ kind: 'djinni', url: 'https://djinni.co/jobs/a/' });
    const off = await repo.setSourceEnabled(added.id, false);
    expect(off?.enabled).toBe(false);
  });

  it('returns null when toggling an unknown id', async () => {
    expect(await repo.setSourceEnabled('00000000-0000-0000-0000-000000000000', false)).toBeNull();
  });

  it('deletes a source and reports whether it existed', async () => {
    const added = await repo.addSource({ kind: 'dou', url: 'https://jobs.dou.ua/b/' });
    expect(await repo.deleteSource(added.id)).toBe(true);
    expect(await repo.deleteSource(added.id)).toBe(false);
  });

  it('surfaces a duplicate as a 23505 error', async () => {
    await repo.addSource({ kind: 'ats', board: 'lever', slug: 'globex' });
    await expect(
      repo.addSource({ kind: 'ats', board: 'lever', slug: 'globex' }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('SettingsService.load', () => {
  it('composes a snapshot with only the enabled sources', async () => {
    await repo.addSource({ kind: 'ats', board: 'greenhouse', slug: 'live' });
    const paused = await repo.addSource({ kind: 'ats', board: 'lever', slug: 'paused' });
    await repo.setSourceEnabled(paused.id, false);

    const s = await service.load();
    expect(s.cv).toBe('seed cv');
    expect(s.rubric.body).toBe('seed rubric');
    expect(s.rubric.weights).toEqual(WEIGHTS);
    expect(s.rubric.version).toBe('1');
    expect(s.profile.timezone).toBe('Europe/Kyiv');
    expect(s.sources.ats).toEqual([{ board: 'greenhouse', slug: 'live' }]);
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
