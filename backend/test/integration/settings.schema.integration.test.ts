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
};

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
  it('stores an ats row and a djinni row', async () => {
    await db.insert(sources).values([
      { kind: 'ats', board: 'greenhouse', slug: 'acme' },
      { kind: 'djinni', url: 'https://djinni.co/jobs/keyword-node/' },
    ]);
    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.enabled)).toBe(true);
  });

  it('rejects a duplicate identity', async () => {
    await expect(
      db.insert(sources).values({ kind: 'ats', board: 'greenhouse', slug: 'acme' }),
    ).rejects.toThrow();
  });

  it('treats null columns as equal, so duplicate djinni urls are rejected', async () => {
    await expect(
      db.insert(sources).values({ kind: 'djinni', url: 'https://djinni.co/jobs/keyword-node/' }),
    ).rejects.toThrow();
  });

  it('rejects an ats row with no slug', async () => {
    await expect(
      db.insert(sources).values({ kind: 'ats', board: 'greenhouse' }),
    ).rejects.toThrow();
  });

  it('rejects a djinni row carrying a slug', async () => {
    await expect(
      db.insert(sources).values({ kind: 'djinni', url: 'https://x.co/', slug: 'acme' }),
    ).rejects.toThrow();
  });
});
