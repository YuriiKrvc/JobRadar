import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { appSettings, sources } from '../../src/db/schema';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const PROFILE = {
  excludedLocations: [], allowedEmploymentTypes: [],
  minSalaryUsd: null, timezone: 'Europe/Kyiv',
  blockedTitleWords: [], blockedDescriptionWords: [],
};

const SELECTORS = { item: 'li.job', link: 'a.title' };

beforeAll(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
});

afterAll(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
  await sql.end();
});

describe('app_settings', () => {
  it('stores one row with typed jsonb columns', async () => {
    await db.insert(appSettings).values({
      cv: 'my cv', rubricBody: 'score it', rubricWeights: WEIGHTS, profile: PROFILE,
    });
    const [row] = await db.select().from(appSettings);
    expect(row.rubricWeights.coreStack).toBe(35);
    expect(row.profile.timezone).toBe('Europe/Kyiv');
    expect(row.version).toBe(1);
  });

  it('rejects a second row', async () => {
    await expect(db.insert(appSettings).values({
      cv: 'other', rubricBody: 'x', rubricWeights: WEIGHTS, profile: PROFILE,
    })).rejects.toThrow();
  });

  it('rejects all-zero weights at the database level', async () => {
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    await expect(
      db.update(appSettings).set({ rubricWeights: zeroed }).where(eq(appSettings.id, true)),
    ).rejects.toThrow();
  });
});

describe('sources', () => {
  it('stores rows keyed by name and url, enabled by default', async () => {
    await db.insert(sources).values([
      { name: 'Acme', url: 'https://acme.example/careers', selectors: SELECTORS },
      { name: 'Djinni', url: 'https://djinni.co/jobs/keyword-node/', selectors: SELECTORS },
    ]);
    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.enabled)).toBe(true);
    // The array columns default to empty, not null, so the pipeline never has
    // to null-check a blocklist.
    expect(rows.every((r) => Array.isArray(r.blockedTitleWords))).toBe(true);
    expect(rows.every((r) => Array.isArray(r.blockedDescriptionWords))).toBe(true);
    expect(rows.find((r) => r.name === 'Acme')!.selectors).toEqual(SELECTORS);
  });

  it('rejects a duplicate url with 23505 on sources_url_uniq', async () => {
    // The constraint name is what sources.controller.ts switches on to tell the
    // user WHICH field collided, so assert the property the driver actually
    // sets, not just the code.
    const err = await db.insert(sources).values({
      name: 'Acme mirror', url: 'https://acme.example/careers', selectors: SELECTORS,
    }).then(() => null, (e: any) => e.cause ?? e);
    expect(err).toBeTruthy();
    expect(err.code).toBe('23505');
    expect(err.constraint_name ?? err.constraint).toBe('sources_url_uniq');
  });

  it('rejects a duplicate name with 23505 on sources_name_uniq', async () => {
    const err = await db.insert(sources).values({
      name: 'Acme', url: 'https://acme.example/other', selectors: SELECTORS,
    }).then(() => null, (e: any) => e.cause ?? e);
    expect(err).toBeTruthy();
    expect(err.code).toBe('23505');
    expect(err.constraint_name ?? err.constraint).toBe('sources_name_uniq');
  });

  it('requires selectors', async () => {
    await expect(
      sql`INSERT INTO sources (name, url) VALUES ('No selectors', 'https://x.example/')`,
    ).rejects.toThrow();
  });
});
