import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { appSettings, sources } from '../../src/db/schema';
import { seed } from '../../src/settings/seed';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST is required for integration tests');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobradar-seed-'));
  writeFileSync(join(dir, 'cv.md'), '# Imported CV\n');
  writeFileSync(join(dir, 'rubric.md'), 'version: 3\n\nScore it.\n');
  writeFileSync(join(dir, 'profile.yaml'),
    'excludedLocations: ["United States"]\nallowedEmploymentTypes: ["full-time"]\nminSalaryUsd: 6000\ntimezone: "Europe/Kyiv"\n');
  writeFileSync(join(dir, 'sources.yaml'),
    'ats:\n  - board: greenhouse\n    slug: acme\ndjinni: ["https://djinni.co/jobs/a/"]\ndou: []\n');
  return dir;
}

beforeEach(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
});

afterAll(async () => {
  await sql`DELETE FROM sources`;
  await sql`DELETE FROM app_settings`;
  await sql.end();
});

describe('seed', () => {
  it('imports from config files when the table is empty', async () => {
    expect(await seed(db, configDir())).toBe('seeded-from-files');

    const [row] = await db.select().from(appSettings);
    expect(row.cv).toBe('# Imported CV\n');
    expect(row.rubricBody).toContain('Score it.');
    expect(row.profile.minSalaryUsd).toBe(6000);
    // Weights were never in rubric.md, so an import keeps v1 behaviour.
    expect(row.rubricWeights).toEqual({
      coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
    });
    expect(row.version).toBe(1);

    const rows = await db.select().from(sources);
    expect(rows).toHaveLength(2);
  });

  it('inserts built-in defaults when no config directory exists', async () => {
    expect(await seed(db, '/nonexistent-config-dir')).toBe('seeded-defaults');

    const [row] = await db.select().from(appSettings);
    expect(row.cv).toContain('Replace this with your CV');
    expect(row.rubricBody).toContain('coreStack');
    expect(await db.select().from(sources)).toHaveLength(0);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seed(db, configDir());
    await db.update(appSettings).set({ cv: 'edited by the user' });

    expect(await seed(db, configDir())).toBe('already-present');
    const [row] = await db.select().from(appSettings);
    expect(row.cv).toBe('edited by the user');
  });

  it('does not duplicate sources on a second run', async () => {
    const dir = configDir();
    await seed(db, dir);
    await sql`DELETE FROM app_settings`;
    await seed(db, dir);
    expect(await db.select().from(sources)).toHaveLength(2);
  });
});
