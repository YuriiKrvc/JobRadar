# Settings in the Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `cv.md`, `profile.yaml`, `rubric.md`, and `sources.yaml` out of `/config` and into Postgres, editable from the dashboard, so tuning the rubric or pausing a source no longer needs an SSH session and a worker restart.

**Architecture:** Two new tables (`app_settings`, a singleton row; `sources`, one row per board) replace four files. `SettingsService.load()` returns an immutable `AppSettings` snapshot that `PipelineService.run()` reads once per 30-minute tick and threads into hard filters, the classifier, and source construction — so `AppConfigService` and the boot-time `SOURCES` provider are deleted rather than reimplemented. Eight new REST endpoints back a second dashboard tab.

**Tech Stack:** NestJS 11 (CommonJS), Drizzle ORM 0.44 + `postgres.js`, Zod 3.25, Postgres 17, Jest + `supertest` for backend units, Vitest for backend integration and the dashboard, React 19 + Vite 7.

**Spec:** `docs/superpowers/specs/2026-08-25-settings-in-db-design.md`

**Baseline:** v1 as implemented at commit `0be74ab`. Every file:line reference below was verified against that commit.

## Global Constraints

- **Backend is CommonJS.** No `"type": "module"` in `backend/package.json`, no `.js` suffixes on relative imports, no top-level `await`, no `import.meta.url`. Use `__dirname`.
- **The dashboard is ESM** (`dashboard/package.json` has `"type": "module"`). The two projects share no source; the REST contract is the only coupling.
- **Working directory:** every `npm`, `npx`, `tsc`, `jest`, and `vitest` command in Tasks 1–8 runs from `backend/`. Tasks 9–13 run from `dashboard/`. Task 14 touches both projects and says which directory each step uses. Task 15 runs from the repository root. `docker compose` and `git` always run from the repository root.
- **`scores` is append-only.** Never `UPDATE` a score row.
- **Secrets stay in `.env`.** `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`, `NOTIFY_THRESHOLD` are never read from or written to the database, and never cross the REST boundary.
- **The settings endpoints are unauthenticated and MUST stay loopback-only.** `docker-compose.yml` binds the API to `127.0.0.1:8080`; never change that binding, add a `0.0.0.0` publish, or place a public proxy in front of it as part of this plan. These endpoints let anyone who can reach them rewrite the CV and rubric. Exposing the API to a network requires authentication first — that is a separate spec, not a step here.
- **Verdict bands stay in code.** `toVerdict()` keeps its hardcoded 75 / 50 cutoffs. Only the weights become editable.
- **Rubric dimension keys are fixed:** `coreStack`, `seniority`, `domain`, `logistics`, `growth`. They are pinned by the classifier's Zod output schema; this plan never adds or removes one.
- **Backend unit tests** are Jest, colocated as `src/**/*.spec.ts`, run with `npm test`. **Backend integration tests** are Vitest at `test/integration/**/*.integration.test.ts`, run with `npm run test:integration` against a live Postgres. **Dashboard tests** are Vitest at `dashboard/tests/**/*.test.{ts,tsx}`, run with `npm test`.
- **`// ...` in a code block is an elision marker**, never a placeholder: it means "the surrounding lines of the existing file stay as they are". Each such block names the file and the anchor to insert at.
- **`SettingsPage` grows across Tasks 10–13.** Its test file is written in Task 10 against the CV section alone, and Tasks 11, 12, and 13 mount three more sections into the same component. The Task 10 queries were chosen to stay unambiguous throughout (`/^cv$/i`, `/save cv/i`). If a later task makes a Testing Library query match multiple elements, tighten that query rather than deleting the assertion.
- **Integration tests need a database, and TWO environment variables.** `drizzle-kit migrate` reads `DATABASE_URL` (see `backend/drizzle.config.ts`), but the integration suite reads **`DATABASE_URL_TEST`** (`backend/test/integration/postings.repository.integration.test.ts:6`). The separate name is deliberate: these tests `DELETE FROM` real tables, so they must never silently run against whatever `DATABASE_URL` happens to point at. Every new integration test in this plan uses `DATABASE_URL_TEST`. Start a database with `docker compose up -d db` and export both:
  ```bash
  export DATABASE_URL=postgres://jobradar:jobradar@localhost:5433/jobradar
  export DATABASE_URL_TEST="$DATABASE_URL"
  ```
  (port **5433** — `docker-compose.yml:10` maps it there to avoid colliding with a host Postgres). Confirm against `.env` before running.

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `backend/src/settings/schema.ts` | Zod schemas and types: `ProfileSchema`, `SourcesSchema`, `RubricWeightsSchema`, `SourceInputSchema`, `AppSettings`, `FileConfig` |
| `backend/src/settings/import.ts` | `loadConfig(dir)` — file reader, used only by the seeder |
| `backend/src/settings/settings.repository.ts` | Drizzle queries; the `version + 1` update; source CRUD |
| `backend/src/settings/settings.service.ts` | `load(): Promise<AppSettings>` — composes the row with enabled sources |
| `backend/src/settings/to-sources-config.ts` | `toSourcesConfig(rows)` — regroups flat rows into `SourcesConfig` |
| `backend/src/settings/settings.controller.ts` | `GET /api/settings`, three document `PUT`s |
| `backend/src/settings/sources.controller.ts` | `GET/POST/PATCH/DELETE /api/sources` |
| `backend/src/settings/settings.module.ts` | Wiring |
| `backend/src/settings/seed.ts` | One-shot seeder entrypoint, run by the `migrate` service |
| `dashboard/src/api/settings.ts` | Settings and sources API client |
| `dashboard/src/components/SettingsPage.tsx` | Settings tab shell |
| `dashboard/src/components/ProfileForm.tsx` | Profile editor |
| `dashboard/src/components/SourcesTable.tsx` | Sources CRUD |
| `dashboard/src/components/RubricEditor.tsx` | Rubric prose + weights |
| `dashboard/src/components/ChipInput.tsx` | Reusable string-list input |

**Modified:**

| Path | Change |
|---|---|
| `backend/src/db/schema.ts` | Add `appSettings`, `sources`, `sourceKindEnum`; rename `rubricVersion` → `settingsVersion` |
| `backend/src/types.ts:42` | `FitVerdict.rubricVersion` → `settingsVersion` |
| `backend/src/classifier/rubric.ts` | `WEIGHTS` → `DEFAULT_WEIGHTS`; `weightedTotal` takes weights |
| `backend/src/classifier/classifier.service.ts` | Drop `AppConfigService`; `classify(posting, settings)` |
| `backend/src/pipeline/pipeline.service.ts` | Load snapshot per run; drop `SOURCES`; incomplete-settings guard |
| `backend/src/sources/sources.module.ts` | Replace the `SOURCES` array with a `BUILD_SOURCES` factory token |
| `backend/src/notify/notify.module.ts` | Gains `NotifyConfig` |
| `backend/src/main.ts`, `worker.main.ts`, `once.ts` | Swap `AppConfigModule` for `SettingsModule` |
| `dashboard/src/api/client.ts` | Read `message`, not `error`; export `getJson`/`sendJson` |
| `dashboard/src/App.tsx` | Two-tab navigation, first-run banner |
| `docker-compose.yml` | Seeder in `migrate`; drop `/config` mount and `CONFIG_DIR` |
| `README.md` | Rewrite "Tuning the rubric" |

**Deleted:** `backend/src/config/` (`config.module.ts`, `app-config.service.ts`, `load.ts`, `schema.ts` — the last two move to `settings/`), and `backend/src/config/load.spec.ts` moves with them.

---

### Task 1: Settings schemas and types

Pure schema work: no database, no DI. Everything later tasks import comes from here.

**Files:**
- Create: `backend/src/settings/schema.ts`
- Create: `backend/src/settings/import.ts`
- Test: `backend/src/settings/schema.spec.ts`
- Delete: `backend/src/config/schema.ts`, `backend/src/config/load.ts`, `backend/src/config/load.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ProfileSchema`, `type Profile` — moved verbatim from `src/config/schema.ts`
  - `SourcesSchema`, `type SourcesConfig` — moved verbatim
  - `RubricWeightsSchema`, `type RubricWeights = Record<'coreStack'|'seniority'|'domain'|'logistics'|'growth', number>`
  - `SourceInputSchema`, `type SourceInput`
  - `interface Rubric { version: string; body: string; weights: RubricWeights }`
  - `interface AppSettings { cv: string; rubric: Rubric; profile: Profile; sources: SourcesConfig }`
  - `interface FileConfig { cv: string; rubric: { version: string; body: string }; profile: Profile; sources: SourcesConfig }`
  - `loadConfig(dir: string): FileConfig`

- [ ] **Step 1: Create the settings directory and move the two config files**

```bash
mkdir -p src/settings
git mv src/config/schema.ts src/settings/schema.ts
git mv src/config/load.ts src/settings/import.ts
git mv src/config/load.spec.ts src/settings/import.spec.ts
```

- [ ] **Step 2: Point the moved importer at its new neighbour**

In `src/settings/import.ts`, the import of `./schema` is already correct after the move, but the return type must change. Replace the `AppConfig` import and the `loadConfig` signature:

```ts
import { ProfileSchema, SourcesSchema, type FileConfig, type Rubric } from './schema';
```

and change the function signature only — the body stays as it is:

```ts
export function loadConfig(dir: string): FileConfig {
```

The local `parseRubric` helper returns `{ version, body }`, which now satisfies `FileConfig['rubric']` rather than `Rubric`. Change its return annotation:

```ts
function parseRubric(text: string): FileConfig['rubric'] {
```

and drop `type Rubric` from the import above, leaving:

```ts
import { ProfileSchema, SourcesSchema, type FileConfig } from './schema';
```

- [ ] **Step 3: Fix the moved test's import path**

In `src/settings/import.spec.ts`, change the import to:

```ts
import { loadConfig } from './import';
```

- [ ] **Step 4: Write the failing schema test**

Create `src/settings/schema.spec.ts`:

```ts
import { RubricWeightsSchema, SourceInputSchema } from './schema';

describe('RubricWeightsSchema', () => {
  const valid = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

  it('accepts the shipped defaults', () => {
    expect(RubricWeightsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts weights that do not sum to 100', () => {
    const w = { ...valid, coreStack: 70 };
    expect(RubricWeightsSchema.parse(w).coreStack).toBe(70);
  });

  it('rejects all-zero weights, which would divide by zero', () => {
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    expect(() => RubricWeightsSchema.parse(zeroed)).toThrow(/above zero/);
  });

  it('rejects a negative weight', () => {
    expect(() => RubricWeightsSchema.parse({ ...valid, growth: -1 })).toThrow();
  });

  it('rejects a missing dimension', () => {
    const { growth, ...missing } = valid;
    expect(() => RubricWeightsSchema.parse(missing)).toThrow();
  });
});

describe('SourceInputSchema', () => {
  it('accepts an ats source with board and slug', () => {
    const input = { kind: 'ats', board: 'greenhouse', slug: 'acme' };
    expect(SourceInputSchema.parse(input)).toEqual(input);
  });

  it('accepts a djinni source with a url', () => {
    const input = { kind: 'djinni', url: 'https://djinni.co/jobs/keyword-node/' };
    expect(SourceInputSchema.parse(input)).toEqual(input);
  });

  it('rejects a djinni source carrying a slug', () => {
    expect(() => SourceInputSchema.parse({
      kind: 'djinni', url: 'https://djinni.co/jobs/', slug: 'acme',
    })).toThrow();
  });

  it('rejects an ats source with no slug', () => {
    expect(() => SourceInputSchema.parse({ kind: 'ats', board: 'greenhouse' })).toThrow();
  });

  it('rejects an unknown board', () => {
    expect(() => SourceInputSchema.parse({
      kind: 'ats', board: 'workday', slug: 'acme',
    })).toThrow();
  });

  it('rejects a url that is not a url', () => {
    expect(() => SourceInputSchema.parse({ kind: 'dou', url: 'not-a-url' })).toThrow();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- src/settings/schema.spec.ts`
Expected: FAIL — `RubricWeightsSchema` and `SourceInputSchema` are not exported from `./schema`.

- [ ] **Step 6: Add the new schemas to `src/settings/schema.ts`**

Keep `ProfileSchema` and `SourcesSchema` exactly as they are. Replace the trailing `Rubric` / `AppConfig` block with:

```ts
export const RubricWeightsSchema = z
  .object({
    coreStack: z.number().int().min(0).max(1000),
    seniority: z.number().int().min(0).max(1000),
    domain: z.number().int().min(0).max(1000),
    logistics: z.number().int().min(0).max(1000),
    growth: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((w) => Object.values(w).some((n) => n > 0), {
    message: 'at least one weight must be above zero',
  });
export type RubricWeights = z.infer<typeof RubricWeightsSchema>;

export const SourceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ats'),
    board: z.enum(['greenhouse', 'lever', 'ashby']),
    slug: z.string().min(1),
  }).strict(),
  z.object({ kind: z.literal('djinni'), url: z.string().url() }).strict(),
  z.object({ kind: z.literal('dou'), url: z.string().url() }).strict(),
]);
export type SourceInput = z.infer<typeof SourceInputSchema>;

/** The runtime snapshot. `version` is String(app_settings.version). */
export interface Rubric {
  version: string;
  body: string;
  weights: RubricWeights;
}

export interface AppSettings {
  cv: string;
  rubric: Rubric;
  profile: Profile;
  sources: SourcesConfig;
}

/**
 * What the one-shot importer reads off disk. Weights were never in rubric.md,
 * so a file import supplies DEFAULT_WEIGHTS separately.
 */
export interface FileConfig {
  cv: string;
  rubric: { version: string; body: string };
  profile: Profile;
  sources: SourcesConfig;
}
```

`.strict()` on the union members is what makes "djinni carrying a slug" fail — without it Zod strips the unknown key and accepts the object.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/settings/schema.spec.ts src/settings/import.spec.ts`
Expected: PASS (12 schema tests + the 3 moved importer tests)

- [ ] **Step 8: Verify nothing else still imports the old paths**

Run: `grep -rn "config/schema\|config/load" src test`
Expected: no output. If `src/config/app-config.service.ts` appears, leave it — Task 5 deletes that file. Update its import to `../settings/schema` and `../settings/import` so the build stays green until then:

```ts
import { loadConfig } from '../settings/import';
import type { FileConfig, Profile, SourcesConfig } from '../settings/schema';
```

and change its private field and getters to use `FileConfig`:

```ts
  private readonly cfg: FileConfig;
  get rubric(): FileConfig['rubric'] { return this.cfg.rubric; }
```

- [ ] **Step 9: Run the full unit suite**

Run: `npm test`
Expected: PASS — all existing suites still green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: move config schemas to src/settings and add weights/source schemas"
```

---

### Task 2: Rename `rubric_version` to `settings_version`

A mechanical rename across 8 sites. Done on its own so the diff is reviewable and the suite proves it changed nothing else.

**Files:**
- Modify: `backend/src/types.ts:42`, `backend/src/db/schema.ts:27`, `backend/src/db/postings.repository.ts:55`, `backend/src/classifier/classifier.service.ts:69`, `backend/src/pipeline/pipeline.service.ts:76`
- Test: `backend/src/classifier/classifier.service.spec.ts:50`, `backend/src/pipeline/pipeline.service.spec.ts:64,94`, `backend/test/integration/postings.repository.integration.test.ts:21`

**Interfaces:**
- Consumes: nothing.
- Produces: `FitVerdict.settingsVersion: string` (was `rubricVersion`); `scores.settings_version` column.

- [ ] **Step 1: Rename the TypeScript property everywhere**

```bash
grep -rl "rubricVersion" src test | xargs sed -i '' 's/rubricVersion/settingsVersion/g'
```

- [ ] **Step 2: Rename the database column in the Drizzle schema**

In `src/db/schema.ts`, the line is now `settingsVersion: text('rubric_version').notNull(),`. Change the column name too:

```ts
  settingsVersion: text('settings_version').notNull(),
```

- [ ] **Step 3: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new file in `drizzle/`. Drizzle cannot tell a rename from a drop-and-add, so it will prompt, or emit `DROP COLUMN` + `ADD COLUMN`.

- [ ] **Step 4: Replace the generated SQL with a rename**

`scores` is append-only history — a drop-and-add would discard every existing version tag. Open the generated file and replace its entire contents with:

```sql
ALTER TABLE "scores" RENAME COLUMN "rubric_version" TO "settings_version";
```

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS — same test count as before this task.

- [ ] **Step 6: Apply the migration and run the integration suite**

```bash
docker compose up -d db
export DATABASE_URL=postgres://jobradar:jobradar@localhost:5433/jobradar
export DATABASE_URL_TEST="$DATABASE_URL"
npm run migrate
npm run test:integration
```
Expected: migration applies; integration tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: rename scores.rubric_version to settings_version

The column now tags the whole scoring configuration - CV, profile, and
rubric - not just the rubric, because all three become editable."
```

---

### Task 3: Database tables for settings and sources

**Files:**
- Modify: `backend/src/db/schema.ts`
- Test: `backend/test/integration/settings.schema.integration.test.ts`

**Interfaces:**
- Consumes: `RubricWeights`, `Profile` from Task 1.
- Produces: Drizzle tables `appSettings` and `sources`, and `sourceKindEnum`.
  - `appSettings` columns: `id`, `cv`, `rubricBody`, `rubricWeights`, `profile`, `version`, `updatedAt`
  - `sources` columns: `id`, `kind`, `board`, `slug`, `url`, `enabled`, `createdAt`

- [ ] **Step 1: Write the failing integration test**

Create `backend/test/integration/settings.schema.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose up -d db
export DATABASE_URL=postgres://jobradar:jobradar@localhost:5433/jobradar
export DATABASE_URL_TEST="$DATABASE_URL"
npm run test:integration -- settings.schema
```
Expected: FAIL — `appSettings` and `sources` are not exported from `src/db/schema`.

- [ ] **Step 3: Add the tables to `src/db/schema.ts`**

Extend the import at the top of the file:

```ts
import {
  pgTable, pgEnum, text, integer, timestamp, jsonb, serial, index,
  boolean, uuid, unique, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SubScores } from '../types';
import type { Profile, RubricWeights } from '../settings/schema';
```

Append to the end of the file:

```ts
export const sourceKindEnum = pgEnum('source_kind', ['ats', 'djinni', 'dou']);

export const appSettings = pgTable('app_settings', {
  // A boolean primary key fixed at true is how a single-row table is spelled:
  // any second insert collides on the key.
  id: boolean('id').primaryKey().default(true),
  cv: text('cv').notNull(),
  rubricBody: text('rubric_body').notNull(),
  rubricWeights: jsonb('rubric_weights').$type<RubricWeights>().notNull(),
  profile: jsonb('profile').$type<Profile>().notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('app_settings_singleton', sql`${t.id}`),
  // All-zero weights would divide by zero in weightedTotal and store NaN.
  check('app_settings_weights_nonzero', sql`
    (${t.rubricWeights}->>'coreStack')::int + (${t.rubricWeights}->>'seniority')::int +
    (${t.rubricWeights}->>'domain')::int + (${t.rubricWeights}->>'logistics')::int +
    (${t.rubricWeights}->>'growth')::int > 0`),
]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: sourceKindEnum('kind').notNull(),
  board: text('board'),
  slug: text('slug'),
  url: text('url'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('sources_ats_has_board_and_slug',
    sql`(${t.kind} = 'ats') = (${t.board} IS NOT NULL AND ${t.slug} IS NOT NULL)`),
  check('sources_url_only_for_non_ats',
    sql`(${t.kind} = 'ats') = (${t.url} IS NULL)`),
  // NULLS NOT DISTINCT makes ON CONFLICT DO NOTHING work for rows whose
  // identity columns are null; without it every djinni row is "distinct".
  unique('sources_identity_uniq').on(t.kind, t.board, t.slug, t.url).nullsNotDistinct(),
]);
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/NNNN_*.sql` creating the `source_kind` enum and both tables.

Open it and confirm it contains `CREATE TABLE "app_settings"`, `CREATE TABLE "sources"`, all four `CHECK` clauses, and `UNIQUE NULLS NOT DISTINCT`.

If `nullsNotDistinct()` or `check()` is not available on this drizzle-orm version, drop them from `schema.ts` and append the equivalent SQL to the generated migration by hand — `drizzle-kit` emits reviewable SQL precisely so this is possible:

```sql
ALTER TABLE "sources" ADD CONSTRAINT "sources_identity_uniq"
  UNIQUE NULLS NOT DISTINCT ("kind", "board", "slug", "url");
```

- [ ] **Step 5: Apply and run the test**

```bash
npm run migrate
npm run test:integration -- settings.schema
```
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: app_settings and sources tables"
```

---

### Task 4: Settings repository and service

**Files:**
- Create: `backend/src/settings/to-sources-config.ts`
- Create: `backend/src/settings/settings.repository.ts`
- Create: `backend/src/settings/settings.service.ts`
- Create: `backend/src/settings/settings.module.ts`
- Test: `backend/src/settings/to-sources-config.spec.ts`
- Test: `backend/test/integration/settings.repository.integration.test.ts`

**Interfaces:**
- Consumes: `appSettings`, `sources` tables (Task 3); `AppSettings`, `Profile`, `RubricWeights`, `SourceInput`, `SourcesConfig` (Task 1); `DB` token from `src/db/db.module.ts:5`.
- Produces:
  - `type SourceRow = typeof sources.$inferSelect`
  - `toSourcesConfig(rows: SourceRow[]): SourcesConfig` — filters to `enabled`, then groups
  - `class SettingsRepository` with `readRow()`, `listSources()`, `updateCv(cv)`, `updateRubric(body, weights)`, `updateProfile(profile)`, `addSource(input)`, `setSourceEnabled(id, enabled)`, `deleteSource(id)`
  - `class SettingsService` with `load(): Promise<AppSettings>`
  - `SettingsModule` — `@Global()`, exports both

- [ ] **Step 1: Write the failing regrouping test**

Create `backend/src/settings/to-sources-config.spec.ts`:

```ts
import { toSourcesConfig, type SourceRow } from './to-sources-config';

function row(over: Partial<SourceRow>): SourceRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    kind: 'ats', board: null, slug: null, url: null,
    enabled: true, createdAt: new Date(),
    ...over,
  } as SourceRow;
}

describe('toSourcesConfig', () => {
  it('groups ats rows into board/slug pairs', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'ats', board: 'greenhouse', slug: 'acme' }),
      row({ kind: 'ats', board: 'lever', slug: 'globex' }),
    ]);
    expect(cfg.ats).toEqual([
      { board: 'greenhouse', slug: 'acme' },
      { board: 'lever', slug: 'globex' },
    ]);
    expect(cfg.djinni).toEqual([]);
    expect(cfg.dou).toEqual([]);
  });

  it('collects djinni and dou rows as bare urls', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'djinni', url: 'https://djinni.co/jobs/a/' }),
      row({ kind: 'dou', url: 'https://jobs.dou.ua/vacancies/feeds/?category=Node.js' }),
    ]);
    expect(cfg.djinni).toEqual(['https://djinni.co/jobs/a/']);
    expect(cfg.dou).toEqual(['https://jobs.dou.ua/vacancies/feeds/?category=Node.js']);
  });

  it('drops disabled rows', () => {
    const cfg = toSourcesConfig([
      row({ kind: 'ats', board: 'greenhouse', slug: 'live' }),
      row({ kind: 'ats', board: 'greenhouse', slug: 'paused', enabled: false }),
      row({ kind: 'djinni', url: 'https://djinni.co/jobs/off/', enabled: false }),
    ]);
    expect(cfg.ats).toEqual([{ board: 'greenhouse', slug: 'live' }]);
    expect(cfg.djinni).toEqual([]);
  });

  it('returns empty groups for no rows', () => {
    expect(toSourcesConfig([])).toEqual({ ats: [], djinni: [], dou: [] });
  });

  it('produces a value SourcesSchema accepts', () => {
    const { SourcesSchema } = require('./schema') as typeof import('./schema');
    const cfg = toSourcesConfig([row({ kind: 'ats', board: 'ashby', slug: 'acme' })]);
    expect(() => SourcesSchema.parse(cfg)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/settings/to-sources-config.spec.ts`
Expected: FAIL — cannot resolve `./to-sources-config`.

- [ ] **Step 3: Create `src/settings/to-sources-config.ts`**

```ts
import type { sources } from '../db/schema';
import type { SourcesConfig } from './schema';

export type SourceRow = typeof sources.$inferSelect;

/**
 * The table is flat because the dashboard needs rows to toggle; buildSources()
 * wants the grouped shape v1 parsed out of sources.yaml. This is the seam.
 * Disabled rows are dropped here so callers never have to remember to filter.
 */
export function toSourcesConfig(rows: SourceRow[]): SourcesConfig {
  const cfg: SourcesConfig = { ats: [], djinni: [], dou: [] };

  for (const r of rows) {
    if (!r.enabled) continue;

    if (r.kind === 'ats') {
      // The CHECK constraint guarantees both are present for ats rows.
      cfg.ats.push({ board: r.board as 'greenhouse' | 'lever' | 'ashby', slug: r.slug as string });
    } else {
      cfg[r.kind].push(r.url as string);
    }
  }

  return cfg;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/settings/to-sources-config.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing repository integration test**

Create `backend/test/integration/settings.repository.integration.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:integration -- settings.repository`
Expected: FAIL — cannot resolve `../../src/settings/settings.repository`.

- [ ] **Step 7: Create `src/settings/settings.repository.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { appSettings, sources } from '../db/schema';
import type { Profile, RubricWeights, SourceInput } from './schema';
import type { SourceRow } from './to-sources-config';

export type AppSettingsRow = typeof appSettings.$inferSelect;

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async readRow(): Promise<AppSettingsRow> {
    const [row] = await this.db.select().from(appSettings).limit(1);
    if (!row) {
      throw new Error(
        'Settings are not initialised: app_settings has no row. ' +
        'Run the seeder (docker compose run --rm migrate) before starting the worker.',
      );
    }
    return row;
  }

  async listSources(): Promise<SourceRow[]> {
    return this.db.select().from(sources).orderBy(sources.createdAt);
  }

  private async bump(patch: Partial<AppSettingsRow>): Promise<void> {
    await this.db
      .update(appSettings)
      .set({ ...patch, version: sql`${appSettings.version} + 1`, updatedAt: new Date() })
      .where(eq(appSettings.id, true));
  }

  updateCv(cv: string): Promise<void> {
    return this.bump({ cv });
  }

  updateRubric(rubricBody: string, rubricWeights: RubricWeights): Promise<void> {
    return this.bump({ rubricBody, rubricWeights });
  }

  updateProfile(profile: Profile): Promise<void> {
    return this.bump({ profile });
  }

  async addSource(input: SourceInput): Promise<SourceRow> {
    const values = input.kind === 'ats'
      ? { kind: 'ats' as const, board: input.board, slug: input.slug }
      : { kind: input.kind, url: input.url };

    const [row] = await this.db.insert(sources).values(values).returning();
    return row;
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<SourceRow | null> {
    const [row] = await this.db
      .update(sources).set({ enabled }).where(eq(sources.id, id)).returning();
    return row ?? null;
  }

  async deleteSource(id: string): Promise<boolean> {
    const rows = await this.db.delete(sources).where(eq(sources.id, id)).returning();
    return rows.length > 0;
  }
}
```

`version: sql\`${appSettings.version} + 1\`` is what makes the bump atomic — read-modify-write in JavaScript would lose an increment under concurrent saves.

- [ ] **Step 8: Create `src/settings/settings.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { toSourcesConfig } from './to-sources-config';
import type { AppSettings } from './schema';

@Injectable()
export class SettingsService {
  constructor(private readonly repo: SettingsRepository) {}

  /**
   * One read per pipeline run. Returning a plain snapshot rather than a live
   * service means a run can never observe settings changing under it, and the
   * next tick picks up an edit with no restart.
   */
  async load(): Promise<AppSettings> {
    const [row, sourceRows] = await Promise.all([
      this.repo.readRow(),
      this.repo.listSources(),
    ]);

    return {
      cv: row.cv,
      rubric: {
        version: String(row.version),
        body: row.rubricBody,
        weights: row.rubricWeights,
      },
      profile: row.profile,
      sources: toSourcesConfig(sourceRows),
    };
  }
}
```

- [ ] **Step 9: Create `src/settings/settings.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { SettingsService } from './settings.service';

// Global because the pipeline, the classifier, and the API all need it, and
// this replaces AppConfigModule, which was Global for the same reason.
@Global()
@Module({
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
```

- [ ] **Step 10: Run the integration test to verify it passes**

Run: `npm run test:integration -- settings.repository`
Expected: PASS (15 tests)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: settings repository, service, and snapshot composition"
```

---

### Task 5: Seeder and compose wiring

The runtime cannot switch to the database until there is a row to read. This task lands the seeder first so Task 6 has data.

**Files:**
- Create: `backend/src/settings/seed.ts`
- Modify: `backend/src/classifier/rubric.ts` (export `DEFAULT_WEIGHTS`)
- Modify: `docker-compose.yml:18-25` (the `migrate` service)
- Test: `backend/test/integration/seed.integration.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `appSettings`/`sources` tables (Task 3), `createDb`/`closeDb` from `src/db/client.ts`. Deliberately NOT `SettingsRepository` — the seeder runs as a bare script with no Nest container, so it queries Drizzle directly.
- Produces: `DEFAULT_WEIGHTS: RubricWeights`; `seed(db, configDir): Promise<'seeded-from-files' | 'seeded-defaults' | 'already-present'>`.

- [ ] **Step 1: Rename `WEIGHTS` to `DEFAULT_WEIGHTS`**

In `src/classifier/rubric.ts`, rename the exported const and widen its type so it satisfies `RubricWeights` (which is `number`, not a literal union):

```ts
import type { RubricWeights } from '../settings/schema';
import type { SubScores, Verdict } from '../types';

export const DEFAULT_WEIGHTS: RubricWeights = {
  coreStack: 35,
  seniority: 20,
  domain: 15,
  logistics: 20,
  growth: 10,
};
```

Then update the two internal uses in `weightedTotal` from `WEIGHTS` to `DEFAULT_WEIGHTS`, and the import in `src/classifier/rubric.spec.ts`. Task 6 changes the function signature; this step only renames.

- [ ] **Step 2: Run the unit suite**

Run: `npm test -- src/classifier/rubric.spec.ts`
Expected: PASS — unchanged behaviour.

- [ ] **Step 3: Write the failing seeder test**

Create `backend/test/integration/seed.integration.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm run test:integration -- seed`
Expected: FAIL — cannot resolve `../../src/settings/seed`.

- [ ] **Step 5: Create `src/settings/seed.ts`**

```ts
import { existsSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { createDb, closeDb, type Database } from '../db/client';
import { appSettings, sources } from '../db/schema';
import { DEFAULT_WEIGHTS } from '../classifier/rubric';
import { loadConfig } from './import';
import type { FileConfig } from './schema';

export type SeedOutcome = 'seeded-from-files' | 'seeded-defaults' | 'already-present';

const DEFAULT_CV = `# Your Name

Replace this with your CV in prose. Roles, technologies you actually shipped,
and a short note on what you want to do next.
`;

const DEFAULT_RUBRIC = `Score the vacancy against the candidate CV on five dimensions, each 0-100.

- coreStack: overlap between required technologies and what the CV shows was
  actually shipped. 0 = no overlap, 50 = adjacent, 100 = direct match.
- seniority: 0 = clear mismatch either direction, 100 = exactly the right level.
- domain: familiarity with the industry or problem space.
- logistics: remote policy, timezone, location, and employment type against the
  candidate's stated constraints.
- growth: does this move the candidate toward the next step named in the CV.

For each dimension give an integer score and a one-sentence justification.
Do not compute a total. Do not recommend applying or not applying.
`;

const DEFAULT_PROFILE = {
  excludedLocations: [],
  allowedEmploymentTypes: [],
  minSalaryUsd: null,
  timezone: 'Europe/Kyiv',
};

export async function seed(db: Database, configDir: string): Promise<SeedOutcome> {
  const existing = await db.select({ id: appSettings.id }).from(appSettings).limit(1);
  if (existing.length > 0) return 'already-present';

  const file: FileConfig | null = existsSync(configDir) ? loadConfig(configDir) : null;

  await db.insert(appSettings).values({
    cv: file?.cv ?? DEFAULT_CV,
    rubricBody: file?.rubric.body ?? DEFAULT_RUBRIC,
    // Weights never lived in rubric.md, so an upgrading install keeps exactly
    // the scoring behaviour it had.
    rubricWeights: DEFAULT_WEIGHTS,
    profile: file?.profile ?? DEFAULT_PROFILE,
  });

  if (file) {
    const rows = [
      ...file.sources.ats.map((a) => ({ kind: 'ats' as const, board: a.board, slug: a.slug })),
      ...file.sources.djinni.map((url) => ({ kind: 'djinni' as const, url })),
      ...file.sources.dou.map((url) => ({ kind: 'dou' as const, url })),
    ];
    if (rows.length > 0) {
      await db.insert(sources).values(rows).onConflictDoNothing();
    }
  }

  return file ? 'seeded-from-files' : 'seeded-defaults';
}

// Entrypoint for the `migrate` compose service. Guarded so importing this
// module from a test does not connect or exit the process.
if (require.main === module) {
  void (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Missing required environment variable: DATABASE_URL');
    const db = createDb(url);
    try {
      const outcome = await seed(db, process.env.CONFIG_DIR ?? '/config');
      console.log(JSON.stringify({ event: 'settings.seed', outcome }));
    } finally {
      await closeDb(db);
    }
  })();
}
```

- [ ] **Step 6: Run the seeder tests to verify they pass**

Run: `npm run test:integration -- seed`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the seeder in the `migrate` service**

In `docker-compose.yml`, replace the `migrate` service's `command` and add the config mount so an upgrading install can import once. The service already builds from the `dev` stage, which has `tsx` and `drizzle-kit`:

```yaml
  migrate:
    # Built from the dev stage on purpose: drizzle-kit is a devDependency and
    # the runtime stage installs with --omit=dev, so it is absent there.
    build: { context: ., target: dev }
    env_file: [.env]
    environment:
      CONFIG_DIR: /config
    volumes: ["./config:/config:ro"]
    command:
      - sh
      - -c
      - "npx drizzle-kit migrate && npx tsx src/settings/seed.ts"
    depends_on:
      db: { condition: service_healthy }
```

Seeding here rather than at worker or API boot is what keeps it race-free: both services already wait on `migrate: {condition: service_completed_successfully}`, so exactly one process can seed.

- [ ] **Step 8: Verify end to end against a real stack**

```bash
docker compose down -v
docker compose up -d --build db migrate
docker compose logs migrate
```
Expected: the log ends with `{"event":"settings.seed","outcome":"seeded-from-files"}` and the service exits 0.

```bash
docker compose up -d migrate
docker compose logs --tail 5 migrate
```
Expected: `"outcome":"already-present"` on the second run.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: one-shot settings seeder in the migrate service

Imports the existing /config files on first boot, or inserts built-in
defaults for a fresh install. Idempotent, so it is safe on every up."
```

---

### Task 6: Switch the runtime from files to the database

The single task where the application stops reading `/config`. It cannot be split: `AppConfigService` has three consumers, and deleting it requires all three to move together.

**Files:**
- Modify: `backend/src/classifier/rubric.ts`, `backend/src/classifier/rubric.spec.ts`
- Modify: `backend/src/classifier/classifier.service.ts`, `backend/src/classifier/classifier.service.spec.ts`
- Modify: `backend/src/pipeline/pipeline.service.ts`, `backend/src/pipeline/pipeline.service.spec.ts`
- Modify: `backend/src/pipeline/pipeline.module.ts`, `backend/src/sources/sources.module.ts`
- Modify: `backend/src/notify/notify.module.ts`, `backend/src/app.module.ts`, `backend/src/main.ts`
- Create: `backend/src/notify/notify.config.ts`
- Delete: `backend/src/config/config.module.ts`, `backend/src/config/app-config.service.ts`

**Interfaces:**
- Consumes: `SettingsService.load()` (Task 4), `AppSettings`/`RubricWeights` (Task 1), `DEFAULT_WEIGHTS` (Task 5), `buildSources(cfg)` from `src/sources/sources.factory.ts:7`.
- Produces:
  - `weightedTotal(s: SubScores, w: RubricWeights): number`
  - `ClassifierService.classify(posting: RawPosting, settings: AppSettings): Promise<FitVerdict>`
  - `BUILD_SOURCES` DI token — a `(cfg: SourcesConfig) => JobSource[]` function
  - `NotifyConfig.thresholdFor(providerId: string): number`
  - `incompleteReason(s: AppSettings): string | null`

- [ ] **Step 1: Write the failing weights test**

Replace the body of `src/classifier/rubric.spec.ts` describe block by appending these cases (keep the existing ones, updating their calls to pass `DEFAULT_WEIGHTS`):

```ts
import { DEFAULT_WEIGHTS, weightedTotal, toVerdict } from './rubric';

const subs = (n: number) => ({
  coreStack: { score: n, note: '' }, seniority: { score: n, note: '' },
  domain: { score: n, note: '' }, logistics: { score: n, note: '' },
  growth: { score: n, note: '' },
});

describe('weightedTotal with custom weights', () => {
  it('normalises by the actual sum, not by 100', () => {
    const doubled = {
      coreStack: 70, seniority: 40, domain: 30, logistics: 40, growth: 20,
    };
    const s = {
      coreStack: { score: 90, note: '' }, seniority: { score: 80, note: '' },
      domain: { score: 60, note: '' }, logistics: { score: 100, note: '' },
      growth: { score: 70, note: '' },
    };
    // Proportional weights are the same rubric.
    expect(weightedTotal(s, doubled)).toBe(weightedTotal(s, DEFAULT_WEIGHTS));
  });

  it('honours a reweighting that does not sum to 100', () => {
    const s = {
      coreStack: { score: 100, note: '' }, seniority: { score: 0, note: '' },
      domain: { score: 0, note: '' }, logistics: { score: 0, note: '' },
      growth: { score: 0, note: '' },
    };
    const coreOnly = {
      coreStack: 10, seniority: 0, domain: 0, logistics: 0, growth: 0,
    };
    expect(weightedTotal(s, coreOnly)).toBe(100);
  });

  it('keeps every total inside 0-100 so the verdict bands still apply', () => {
    const lopsided = {
      coreStack: 500, seniority: 1, domain: 1, logistics: 1, growth: 1,
    };
    const t = weightedTotal(subs(100), lopsided);
    expect(t).toBeLessThanOrEqual(100);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(toVerdict(t)).toBe('STRONG');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/classifier/rubric.spec.ts`
Expected: FAIL — `weightedTotal` takes one argument.

- [ ] **Step 3: Make `weightedTotal` take weights**

In `src/classifier/rubric.ts`:

```ts
export function weightedTotal(s: SubScores, w: RubricWeights): number {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const key of Object.keys(w) as (keyof SubScores)[]) {
    acc += s[key].score * w[key];
  }
  // Dividing by the actual sum rather than 100 is what lets a weight be raised
  // without rebalancing the other four. RubricWeightsSchema and a CHECK
  // constraint both guarantee sum > 0.
  return Math.round(acc / sum);
}
```

- [ ] **Step 4: Run the rubric tests**

Run: `npm test -- src/classifier/rubric.spec.ts`
Expected: PASS — including the pre-existing cases now passing `DEFAULT_WEIGHTS`.

- [ ] **Step 5: Update the classifier test to pass a snapshot**

In `src/classifier/classifier.service.spec.ts`, replace the `AppConfigService` import and `configStub` with a plain settings object, and drop the provider:

```ts
import type { AppSettings } from '../settings/schema';

const settings: AppSettings = {
  cv: 'cv',
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
  },
  rubric: {
    version: '1',
    body: 'score five dimensions',
    weights: { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 },
  },
  sources: { ats: [], djinni: [], dou: [] },
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
```

Then change every `svc.classify(posting)` call in the file to `svc.classify(posting, settings)`, and the assertion `expect(v.settingsVersion).toBe('1')` stays as Task 2 left it.

Add one case proving weights now flow from the snapshot:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- src/classifier/classifier.service.spec.ts`
Expected: FAIL — `classify` takes one argument and `ClassifierService` still requires `AppConfigService`.

- [ ] **Step 7: Rewrite `ClassifierService` to take the snapshot**

In `src/classifier/classifier.service.ts`, drop the `AppConfigService` import and constructor parameter, leaving:

```ts
@Injectable()
export class ClassifierService {
  constructor(@Inject(LLM_PROVIDER) private readonly provider: LLMProvider) {}

  async classify(posting: RawPosting, settings: AppSettings): Promise<FitVerdict> {
    const { system, user } = buildPrompt({
      cv: settings.cv,
      profile: settings.profile,
      rubric: settings.rubric,
      posting,
    });
```

The retry block is unchanged. Change the return block to:

```ts
    const total = weightedTotal(parsed.subscores, settings.rubric.weights);
    return {
      total,
      verdict: toVerdict(total),
      subscores: parsed.subscores,
      reasoning: parsed.summary,
      providerId: this.provider.id,
      settingsVersion: settings.rubric.version,
    };
```

and add the type import:

```ts
import type { AppSettings } from '../settings/schema';
```

`buildPrompt` reads only `rubric.body` (`src/classifier/prompt.ts:28`), so the widened `Rubric` needs no change there.

- [ ] **Step 8: Run the classifier tests**

Run: `npm test -- src/classifier/classifier.service.spec.ts`
Expected: PASS

- [ ] **Step 9: Turn `SOURCES` into a factory token**

Replace `src/sources/sources.module.ts` entirely:

```ts
import { Module } from '@nestjs/common';
import { buildSources } from './sources.factory';
import type { JobSource } from '../types';
import type { SourcesConfig } from '../settings/schema';

export type BuildSources = (cfg: SourcesConfig) => JobSource[];

/**
 * A factory, not a prebuilt array: sources are now editable at runtime, so
 * adapters must be constructed per run from the current snapshot. Keeping it a
 * DI token rather than a direct import preserves the seam the pipeline tests
 * use to inject fake sources.
 */
export const BUILD_SOURCES = Symbol('BUILD_SOURCES');

@Module({
  providers: [{ provide: BUILD_SOURCES, useValue: buildSources satisfies BuildSources }],
  exports: [BUILD_SOURCES],
})
export class SourcesModule {}
```

- [ ] **Step 10: Create the notify threshold provider**

Create `src/notify/notify.config.ts`:

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotifyConfig {
  /**
   * Scores from different models are not comparable, so the notify threshold is
   * settable per provider: NOTIFY_THRESHOLD_<SANITISED_PROVIDER_ID> beats the
   * global NOTIFY_THRESHOLD, which defaults to 50. Env only - thresholds are
   * secrets-adjacent deployment config and deliberately did not move to the DB.
   */
  thresholdFor(providerId: string): number {
    const key = `NOTIFY_THRESHOLD_${providerId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
    return Number(process.env[key] ?? process.env.NOTIFY_THRESHOLD ?? 50);
  }
}
```

Add it to `src/notify/notify.module.ts` — keep the existing `NOTIFIER` provider and extend both arrays:

```ts
import { NotifyConfig } from './notify.config';
// ...
  providers: [
    NotifyConfig,
    {
      provide: NOTIFIER,
      useFactory: (): Notifier => new TelegramNotifier({
        botToken: required('TELEGRAM_BOT_TOKEN'),
        chatId: required('TELEGRAM_CHAT_ID'),
      }),
    },
  ],
  exports: [NOTIFIER, NotifyConfig],
```

- [ ] **Step 11: Update the pipeline test harness**

In `src/pipeline/pipeline.service.spec.ts`, replace the `AppConfigService` and `SOURCES` imports and the `configStub`:

```ts
import { BUILD_SOURCES } from '../sources/sources.module';
import { SettingsService } from '../settings/settings.service';
import { NotifyConfig } from '../notify/notify.config';
import type { AppSettings } from '../settings/schema';

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
```

In `build()`, accept a settings override and swap the three providers:

```ts
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
```

The rest of `build()` and every existing case stays as it is.

- [ ] **Step 12: Add the incomplete-settings cases**

Append to `src/pipeline/pipeline.service.spec.ts`:

```ts
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
```

- [ ] **Step 13: Run it to verify it fails**

Run: `npm test -- src/pipeline/pipeline.service.spec.ts`
Expected: FAIL — `PipelineService` still injects `AppConfigService` and `SOURCES`.

- [ ] **Step 14: Rewrite `PipelineService`**

In `src/pipeline/pipeline.service.ts`, replace the imports of `AppConfigService` and `SOURCES`, and add:

```ts
import { BUILD_SOURCES, type BuildSources } from '../sources/sources.module';
import { SettingsService } from '../settings/settings.service';
import { NotifyConfig } from '../notify/notify.config';
import type { AppSettings } from '../settings/schema';
```

Add the guard helper above the class:

```ts
/**
 * A fresh install has a seeded row with an empty CV and no sources. Classifying
 * against an empty CV would burn tokens producing noise, so the run is skipped
 * and the reason written to run_log, where the dashboard health panel shows it.
 */
export function incompleteReason(s: AppSettings): string | null {
  if (s.cv.trim() === '') return 'no CV';
  const enabled = s.sources.ats.length + s.sources.djinni.length + s.sources.dou.length;
  if (enabled === 0) return 'no enabled sources';
  return null;
}
```

Replace the constructor:

```ts
  constructor(
    private readonly repo: PostingsRepository,
    private readonly classifier: ClassifierService,
    private readonly settings: SettingsService,
    private readonly notifyConfig: NotifyConfig,
    @Inject(BUILD_SOURCES) private readonly buildSources: BuildSources,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
  ) {}
```

At the top of `run()`, after `const s: RunSummary = {...}`, insert:

```ts
    // One read per tick: a run can never see settings change under it, and the
    // next tick picks up a dashboard edit with no restart.
    const settings = await this.settings.load();

    const incomplete = incompleteReason(settings);
    if (incomplete) {
      this.log.warn(`settings incomplete: ${incomplete}`);
      await this.repo.logRun('settings', 'error', 0, `settings incomplete: ${incomplete}`);
      return s;
    }

    const sources = this.buildSources(settings.sources);
```

Then change the loop header from `for (const source of this.sources)` to `for (const source of sources)`, and inside it:

- `applyHardFilters(posting, this.config.profile)` → `applyHardFilters(posting, settings.profile)`
- `settingsVersion: this.config.rubric.version` → `settingsVersion: settings.rubric.version`
- `await this.classifier.classify(posting)` → `await this.classifier.classify(posting, settings)`

Finally change `dispatchNotifications` to take no config from `this.config`:

```ts
  private async dispatchNotifications(s: RunSummary): Promise<void> {
    const threshold = this.notifyConfig.thresholdFor(this.provider.id);
```

- [ ] **Step 15: Run the pipeline tests**

Run: `npm test -- src/pipeline/pipeline.service.spec.ts`
Expected: PASS — the existing cases plus 4 new ones.

- [ ] **Step 16: Delete `AppConfigService` and rewire the roots**

```bash
git rm src/config/config.module.ts src/config/app-config.service.ts
rmdir src/config 2>/dev/null || true
```

In `src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SettingsModule } from './settings/settings.module';
import { DatabaseModule } from './db/db.module';
import { PipelineModule } from './pipeline/pipeline.module';

/** Shared by every entrypoint; HTTP and scheduling are layered on top. */
@Module({
  imports: [SettingsModule, DatabaseModule, PipelineModule],
  exports: [PipelineModule],
})
export class AppModule {}
```

In `src/main.ts`, add `SettingsModule` to the `ApiRoot` imports (Task 7's controllers live in it):

```ts
import { SettingsModule } from './settings/settings.module';
// ...
  imports: [
    DatabaseModule,
    SettingsModule,
    ApiModule,
    ...(staticRoot ? [ServeStaticModule.forRoot({ ... })] : []),
  ],
```

`SettingsModule` is DB-backed and touches no filesystem, so unlike `AppConfigModule` it cannot throw at API boot over a missing `/config`.

- [ ] **Step 17: Confirm nothing references the deleted service**

Run: `grep -rn "AppConfigService\|AppConfigModule\|CONFIG_DIR" src`
Expected: no output except `src/settings/seed.ts`, which legitimately reads `CONFIG_DIR` for the one-shot import.

- [ ] **Step 18: Build and run the full unit suite**

Run: `npm run build && npm test`
Expected: `tsc` clean; all suites PASS.

- [ ] **Step 19: Run the integration suite**

```bash
export DATABASE_URL=postgres://jobradar:jobradar@localhost:5433/jobradar
export DATABASE_URL_TEST="$DATABASE_URL"
npm run test:integration
```
Expected: PASS

- [ ] **Step 20: Commit**

```bash
git add -A
git commit -m "refactor: read settings from the database, not /config

PipelineService.run() loads one immutable snapshot per tick and threads
it into hard filters, the classifier, and source construction. SOURCES
becomes a factory token so adapters are built per run. AppConfigService
is deleted; its env-only notify threshold moves to NotifyConfig."
```

---

### Task 7: Settings REST endpoints

**Files:**
- Create: `backend/src/settings/settings.controller.ts`
- Modify: `backend/src/settings/settings.module.ts`
- Test: `backend/src/settings/settings.controller.spec.ts`

**Interfaces:**
- Consumes: `SettingsRepository` (Task 4), `ProfileSchema`/`RubricWeightsSchema` (Task 1), `ZodValidationPipe` from `src/api/zod-validation.pipe.ts`.
- Produces:
  - `GET /api/settings` → `{cv, rubricBody, rubricWeights, profile, version, updatedAt}`
  - `PUT /api/settings/cv` ← `{cv: string}` → `{version}`
  - `PUT /api/settings/rubric` ← `{body: string, weights: RubricWeights}` → `{version}`
  - `PUT /api/settings/profile` ← `Profile` → `{version}`
  - `CvBodySchema`, `RubricBodySchema` exported from `src/settings/schema.ts`

- [ ] **Step 1: Add the two request-body schemas**

Append to `src/settings/schema.ts`:

```ts
export const CvBodySchema = z.object({ cv: z.string() }).strict();

export const RubricBodySchema = z.object({
  body: z.string(),
  weights: RubricWeightsSchema,
}).strict();
```

An empty CV string is deliberately allowed — a fresh install has one, and the pipeline's incomplete-settings guard is what handles it, not a validation error that would make the field unsavable.

- [ ] **Step 2: Write the failing controller test**

Create `backend/src/settings/settings.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { SettingsRepository } from './settings.repository';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const PROFILE = {
  excludedLocations: ['United States'], allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000, timezone: 'Europe/Kyiv',
};

function fakeRepo() {
  return {
    row: {
      id: true, cv: 'my cv', rubricBody: 'score it', rubricWeights: WEIGHTS,
      profile: PROFILE, version: 3, updatedAt: new Date('2026-08-25T10:00:00Z'),
    },
    readRow: jest.fn(async function (this: any) { return this.row; }),
    updateCv: jest.fn(async function (this: any) { this.row.version += 1; }),
    updateRubric: jest.fn(async function (this: any) { this.row.version += 1; }),
    updateProfile: jest.fn(async function (this: any) { this.row.version += 1; }),
  };
}

async function build(repo = fakeRepo()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SettingsController],
    providers: [{ provide: SettingsRepository, useValue: repo }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, repo };
}

describe('GET /api/settings', () => {
  it('returns every document and the current version', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200);

    expect(res.body).toEqual({
      cv: 'my cv',
      rubricBody: 'score it',
      rubricWeights: WEIGHTS,
      profile: PROFILE,
      version: 3,
      updatedAt: '2026-08-25T10:00:00.000Z',
    });
    await app.close();
  });

  it('never leaks the singleton primary key', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200);
    expect(res.body).not.toHaveProperty('id');
    await app.close();
  });
});

describe('PUT /api/settings/cv', () => {
  it('saves and returns the bumped version', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/cv').send({ cv: 'new cv' }).expect(200);

    expect(repo.updateCv).toHaveBeenCalledWith('new cv');
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('accepts an empty cv, which a fresh install has', async () => {
    const { app } = await build();
    await request(app.getHttpServer()).put('/api/settings/cv').send({ cv: '' }).expect(200);
    await app.close();
  });

  it('rejects a missing cv field with a 400 naming it', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/cv').send({}).expect(400);
    expect(res.body.message).toMatch(/cv/);
    await app.close();
  });

  it('rejects an unknown field', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .put('/api/settings/cv').send({ cv: 'x', sneaky: 1 }).expect(400);
    await app.close();
  });
});

describe('PUT /api/settings/rubric', () => {
  it('saves body and weights together', async () => {
    const { app, repo } = await build();
    const weights = { ...WEIGHTS, coreStack: 70 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'new rubric', weights }).expect(200);

    expect(repo.updateRubric).toHaveBeenCalledWith('new rubric', weights);
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('rejects all-zero weights', async () => {
    const { app } = await build();
    const zeroed = { coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'x', weights: zeroed }).expect(400);
    expect(res.body.message).toMatch(/above zero/);
    await app.close();
  });

  it('rejects a missing dimension', async () => {
    const { app } = await build();
    const { growth, ...partial } = WEIGHTS;
    await request(app.getHttpServer())
      .put('/api/settings/rubric').send({ body: 'x', weights: partial }).expect(400);
    await app.close();
  });
});

describe('PUT /api/settings/profile', () => {
  it('saves a valid profile', async () => {
    const { app, repo } = await build();
    const next = { ...PROFILE, minSalaryUsd: 9000 };
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send(next).expect(200);

    expect(repo.updateProfile).toHaveBeenCalledWith(next);
    expect(res.body).toEqual({ version: 4 });
    await app.close();
  });

  it('applies schema defaults for omitted fields', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer())
      .put('/api/settings/profile').send({ timezone: 'Europe/Berlin' }).expect(200);

    expect(repo.updateProfile).toHaveBeenCalledWith({
      excludedLocations: [], allowedEmploymentTypes: [],
      minSalaryUsd: null, timezone: 'Europe/Berlin',
    });
    await app.close();
  });

  it('rejects a negative salary with a message naming the field', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer())
      .put('/api/settings/profile').send({ ...PROFILE, minSalaryUsd: -5 }).expect(400);
    expect(res.body.message).toMatch(/minSalaryUsd/);
    await app.close();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/settings/settings.controller.spec.ts`
Expected: FAIL — cannot resolve `./settings.controller`.

- [ ] **Step 4: Create `src/settings/settings.controller.ts`**

```ts
import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import {
  CvBodySchema, ProfileSchema, RubricBodySchema,
  type Profile, type RubricWeights,
} from './schema';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly repo: SettingsRepository) {}

  @Get()
  async read() {
    const row = await this.repo.readRow();
    // Explicit projection: `id` is the singleton marker and never leaves here.
    return {
      cv: row.cv,
      rubricBody: row.rubricBody,
      rubricWeights: row.rubricWeights,
      profile: row.profile,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Three endpoints rather than one combined PUT: it matches a per-section Save
  // button and makes one version bump per save fall out without diff logic.

  @Put('cv')
  async putCv(@Body(new ZodValidationPipe(CvBodySchema)) body: { cv: string }) {
    await this.repo.updateCv(body.cv);
    return { version: (await this.repo.readRow()).version };
  }

  @Put('rubric')
  async putRubric(
    @Body(new ZodValidationPipe(RubricBodySchema)) body: { body: string; weights: RubricWeights },
  ) {
    await this.repo.updateRubric(body.body, body.weights);
    return { version: (await this.repo.readRow()).version };
  }

  @Put('profile')
  async putProfile(@Body(new ZodValidationPipe(ProfileSchema)) profile: Profile) {
    await this.repo.updateProfile(profile);
    return { version: (await this.repo.readRow()).version };
  }
}
```

- [ ] **Step 5: Register the controller**

In `src/settings/settings.module.ts`, add the `controllers` array:

```ts
import { SettingsController } from './settings.controller';
// ...
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsRepository, SettingsService],
})
export class SettingsModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/settings/settings.controller.spec.ts`
Expected: PASS (12 tests)

- [ ] **Step 7: Verify the endpoints against a real stack**

```bash
docker compose up -d --build db migrate api
curl -s localhost:8080/api/settings | head -c 200
curl -s -X PUT localhost:8080/api/settings/cv \
  -H 'content-type: application/json' -d '{"cv":"curl test"}'
curl -s -X PUT localhost:8080/api/settings/rubric \
  -H 'content-type: application/json' \
  -d '{"body":"x","weights":{"coreStack":0,"seniority":0,"domain":0,"logistics":0,"growth":0}}'
```
Expected: the settings JSON; `{"version":2}`; then a 400 whose `message` contains `above zero`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: settings REST endpoints"
```

---

### Task 8: Sources REST endpoints

**Files:**
- Create: `backend/src/settings/sources.controller.ts`
- Modify: `backend/src/settings/settings.module.ts`
- Test: `backend/src/settings/sources.controller.spec.ts`

**Interfaces:**
- Consumes: `SettingsRepository` (Task 4), `SourceInputSchema` (Task 1).
- Produces:
  - `GET /api/sources` → `{sources: SourceRow[]}` (enabled and disabled)
  - `POST /api/sources` ← `SourceInput` → 201 `{source}`; 409 on duplicate
  - `PATCH /api/sources/:id` ← `{enabled: boolean}` → `{source}`; 404 unknown
  - `DELETE /api/sources/:id` → 204; 404 unknown
  - `EnabledBodySchema` exported from `src/settings/schema.ts`

- [ ] **Step 1: Add the toggle body schema**

Append to `src/settings/schema.ts`:

```ts
export const EnabledBodySchema = z.object({ enabled: z.boolean() }).strict();
```

Only `enabled` is patchable. A source's identity is immutable: `postings.id` for ATS boards is derived from `board:slug`, so editing a slug in place would orphan every posting already stored under the old one. Correcting a typo means delete and re-add.

- [ ] **Step 2: Write the failing controller test**

Create `backend/src/settings/sources.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SourcesController } from './sources.controller';
import { SettingsRepository } from './settings.repository';

const ID = '11111111-1111-1111-1111-111111111111';

function row(over: Record<string, unknown> = {}) {
  return {
    id: ID, kind: 'ats', board: 'greenhouse', slug: 'acme', url: null,
    enabled: true, createdAt: new Date('2026-08-25T10:00:00Z'), ...over,
  };
}

function fakeRepo() {
  return {
    listSources: jest.fn(async () => [row(), row({ id: 'other', enabled: false })]),
    addSource: jest.fn(async () => row()),
    setSourceEnabled: jest.fn(async () => row({ enabled: false })),
    deleteSource: jest.fn(async () => true),
  };
}

async function build(repo: ReturnType<typeof fakeRepo> = fakeRepo()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SourcesController],
    providers: [{ provide: SettingsRepository, useValue: repo }],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  return { app, repo };
}

describe('GET /api/sources', () => {
  it('returns disabled sources too, so they can be re-enabled', async () => {
    const { app } = await build();
    const res = await request(app.getHttpServer()).get('/api/sources').expect(200);
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources.map((s: any) => s.enabled)).toEqual([true, false]);
    await app.close();
  });
});

describe('POST /api/sources', () => {
  it('creates an ats source and returns 201', async () => {
    const { app, repo } = await build();
    const input = { kind: 'ats', board: 'greenhouse', slug: 'acme' };
    const res = await request(app.getHttpServer()).post('/api/sources').send(input).expect(201);

    expect(repo.addSource).toHaveBeenCalledWith(input);
    expect(res.body.source.id).toBe(ID);
    await app.close();
  });

  it('rejects a djinni source carrying a slug', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .post('/api/sources')
      .send({ kind: 'djinni', url: 'https://djinni.co/jobs/a/', slug: 'acme' })
      .expect(400);
    await app.close();
  });

  it('rejects an unknown board', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .post('/api/sources').send({ kind: 'ats', board: 'workday', slug: 'acme' }).expect(400);
    await app.close();
  });

  it('maps a unique violation to 409 rather than letting a 500 escape', async () => {
    const repo = fakeRepo();
    repo.addSource = jest.fn(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const { app } = await build(repo);
    const res = await request(app.getHttpServer())
      .post('/api/sources').send({ kind: 'dou', url: 'https://jobs.dou.ua/a/' }).expect(409);
    expect(res.body.message).toMatch(/already/i);
    await app.close();
  });

  it('does not swallow an unrelated database error', async () => {
    const repo = fakeRepo();
    repo.addSource = jest.fn(async () => {
      throw Object.assign(new Error('connection reset'), { code: '08006' });
    });
    const { app } = await build(repo);
    await request(app.getHttpServer())
      .post('/api/sources').send({ kind: 'dou', url: 'https://jobs.dou.ua/a/' }).expect(500);
    await app.close();
  });
});

describe('PATCH /api/sources/:id', () => {
  it('toggles enabled', async () => {
    const { app, repo } = await build();
    const res = await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: false }).expect(200);

    expect(repo.setSourceEnabled).toHaveBeenCalledWith(ID, false);
    expect(res.body.source.enabled).toBe(false);
    await app.close();
  });

  it('404s an unknown id', async () => {
    const repo = fakeRepo();
    repo.setSourceEnabled = jest.fn(async () => null);
    const { app } = await build(repo);
    await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: true }).expect(404);
    await app.close();
  });

  it('rejects an attempt to edit a source identity', async () => {
    const { app } = await build();
    await request(app.getHttpServer())
      .patch(`/api/sources/${ID}`).send({ enabled: true, slug: 'renamed' }).expect(400);
    await app.close();
  });

  it('400s a non-uuid id before touching the repository', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer())
      .patch('/api/sources/not-a-uuid').send({ enabled: true }).expect(400);
    expect(repo.setSourceEnabled).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('DELETE /api/sources/:id', () => {
  it('returns 204 when the row existed', async () => {
    const { app, repo } = await build();
    await request(app.getHttpServer()).delete(`/api/sources/${ID}`).expect(204);
    expect(repo.deleteSource).toHaveBeenCalledWith(ID);
    await app.close();
  });

  it('404s when it did not', async () => {
    const repo = fakeRepo();
    repo.deleteSource = jest.fn(async () => false);
    const { app } = await build(repo);
    await request(app.getHttpServer()).delete(`/api/sources/${ID}`).expect(404);
    await app.close();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/settings/sources.controller.spec.ts`
Expected: FAIL — cannot resolve `./sources.controller`.

- [ ] **Step 4: Create `src/settings/sources.controller.ts`**

```ts
import {
  Body, ConflictException, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { SettingsRepository } from './settings.repository';
import { ZodValidationPipe } from '../api/zod-validation.pipe';
import { EnabledBodySchema, SourceInputSchema, type SourceInput } from './schema';

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

@Controller('api/sources')
export class SourcesController {
  constructor(private readonly repo: SettingsRepository) {}

  @Get()
  async list() {
    // Disabled rows are included: the dashboard must be able to re-enable them.
    return { sources: await this.repo.listSources() };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput) {
    try {
      return { source: await this.repo.addSource(input) };
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException('That source is already configured');
      }
      throw err;
    }
  }

  @Patch(':id')
  async toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EnabledBodySchema)) body: { enabled: boolean },
  ) {
    const source = await this.repo.setSourceEnabled(id, body.enabled);
    if (!source) throw new NotFoundException('No such source');
    return { source };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    if (!await this.repo.deleteSource(id)) throw new NotFoundException('No such source');
  }
}
```

- [ ] **Step 5: Register the controller**

In `src/settings/settings.module.ts`:

```ts
  controllers: [SettingsController, SourcesController],
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/settings/sources.controller.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 7: Run the whole backend suite**

Run: `npm run build && npm test`
Expected: `tsc` clean; all PASS.

- [ ] **Step 8: Verify against a real stack**

```bash
docker compose up -d --build db migrate api
curl -s -X POST localhost:8080/api/sources -H 'content-type: application/json' \
  -d '{"kind":"ats","board":"greenhouse","slug":"acme"}'
curl -s -X POST localhost:8080/api/sources -H 'content-type: application/json' \
  -d '{"kind":"ats","board":"greenhouse","slug":"acme"}'
curl -s localhost:8080/api/sources
```
Expected: a created source; then a 409 whose `message` is `That source is already configured`; then the list containing one row.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: sources CRUD endpoints with 409 on duplicate identity"
```

---

### Task 9: Dashboard API client for settings

Includes the `body.error` fix. v1's client reads a field NestJS does not send, so today every validation failure renders as the literal string "Bad Request" — which becomes load-bearing now that 400s carry per-field detail.

**Files:**
- Modify: `dashboard/src/api/client.ts:8-9`, `dashboard/src/api/types.ts`
- Create: `dashboard/src/api/settings.ts`
- Test: `dashboard/tests/client.test.ts`, `dashboard/tests/settings-client.test.ts`

**Interfaces:**
- Consumes: the REST contract from Tasks 7 and 8.
- Produces:
  - `getJson<T>(url, fetchFn)` and `sendJson<T>(method, url, body, fetchFn)` exported from `client.ts`
  - `fetchSettings`, `saveCv`, `saveRubric`, `saveProfile`, `fetchSources`, `addSource`, `toggleSource`, `deleteSource` from `settings.ts`
  - types `SettingsResponse`, `RubricWeights`, `ProfileInput`, `SourceRow`, `SourceInput`

- [ ] **Step 1: Write the failing error-body test**

Append to `dashboard/tests/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fetchPostings } from '../src/api/client';

function failing(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('error detail', () => {
  it('reads NestJS message, not error', async () => {
    const f = failing(400, {
      statusCode: 400, error: 'Bad Request', message: 'profile.minSalaryUsd: must be positive',
    });
    await expect(fetchPostings({}, f)).rejects.toThrow('profile.minSalaryUsd: must be positive');
  });

  it('falls back to error when message is absent', async () => {
    const f = failing(409, { statusCode: 409, error: 'Conflict' });
    await expect(fetchPostings({}, f)).rejects.toThrow('Conflict');
  });

  it('falls back to the status when the body is not JSON', async () => {
    const f = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch;
    await expect(fetchPostings({}, f)).rejects.toThrow('HTTP 502');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- client`
Expected: FAIL — the first case throws `Bad Request`.

- [ ] **Step 3: Fix the error extraction and export the helpers**

In `dashboard/src/api/client.ts`, change `getJson` to read `message` first and export it, then add `sendJson`:

```ts
export async function getJson<T>(url: string, fetchFn: typeof fetch = fetch): Promise<T> {
  return request<T>(url, {}, fetchFn);
}

export async function sendJson<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  return request<T>(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, fetchFn);
}

async function request<T>(url: string, init: RequestInit, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, init);

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      // NestJS sends {statusCode, error, message}; `message` carries the Zod
      // issues, `error` is only the generic status name.
      const body = await res.json() as { message?: string | string[]; error?: string };
      const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
      if (message) detail = message;
      else if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body (proxy error page, etc.) — keep the status text.
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

Then change the two existing callers to use `getJson` — `fetchPostings` and `fetchHealth` keep their signatures.

- [ ] **Step 4: Run the client tests**

Run: `npm test -- client`
Expected: PASS — the three new cases plus the pre-existing ones.

- [ ] **Step 5: Add the settings types**

Append to `dashboard/src/api/types.ts`:

```ts
export interface RubricWeights {
  coreStack: number;
  seniority: number;
  domain: number;
  logistics: number;
  growth: number;
}

export interface ProfileInput {
  excludedLocations: string[];
  allowedEmploymentTypes: string[];
  minSalaryUsd: number | null;
  timezone: string;
}

export interface SettingsResponse {
  cv: string;
  rubricBody: string;
  rubricWeights: RubricWeights;
  profile: ProfileInput;
  version: number;
  updatedAt: string;
}

export type SourceKind = 'ats' | 'djinni' | 'dou';

export interface SourceRow {
  id: string;
  kind: SourceKind;
  board: string | null;
  slug: string | null;
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

export type SourceInput =
  | { kind: 'ats'; board: 'greenhouse' | 'lever' | 'ashby'; slug: string }
  | { kind: 'djinni'; url: string }
  | { kind: 'dou'; url: string };
```

These duplicate the backend's Zod types on purpose — the spec accepts duplication as the price of the two projects staying independent.

- [ ] **Step 6: Write the failing settings-client test**

Create `dashboard/tests/settings-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  addSource, deleteSource, fetchSettings, fetchSources,
  saveCv, saveProfile, saveRubric, toggleSource,
} from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

function ok(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('settings client', () => {
  it('fetches settings', async () => {
    const f = ok({ cv: 'c', rubricBody: 'r', rubricWeights: WEIGHTS, profile: {}, version: 2, updatedAt: 'x' });
    expect((await fetchSettings(f)).version).toBe(2);
    expect(f).toHaveBeenCalledWith('/api/settings', expect.anything());
  });

  it('PUTs the cv and returns the new version', async () => {
    const f = ok({ version: 5 });
    expect(await saveCv('new cv', f)).toBe(5);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/settings/cv');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ cv: 'new cv' });
  });

  it('PUTs rubric body and weights together', async () => {
    const f = ok({ version: 6 });
    expect(await saveRubric('body', WEIGHTS, f)).toBe(6);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ body: 'body', weights: WEIGHTS });
  });

  it('PUTs the profile as the bare object', async () => {
    const f = ok({ version: 7 });
    const profile = {
      excludedLocations: ['US'], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
    };
    expect(await saveProfile(profile, f)).toBe(7);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(profile);
  });

  it('unwraps the sources list', async () => {
    const f = ok({ sources: [{ id: 'a' }, { id: 'b' }] });
    expect(await fetchSources(f)).toHaveLength(2);
  });

  it('POSTs a new source and unwraps it', async () => {
    const f = ok({ source: { id: 'new' } });
    expect((await addSource({ kind: 'dou', url: 'https://x.co/' }, f)).id).toBe('new');
  });

  it('PATCHes the toggle', async () => {
    const f = ok({ source: { id: 'a', enabled: false } });
    expect((await toggleSource('a', false, f)).enabled).toBe(false);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/sources/a');
    expect(init.method).toBe('PATCH');
  });

  it('DELETEs and tolerates a 204 with no body', async () => {
    const f = ok(null, 204);
    await expect(deleteSource('a', f)).resolves.toBeUndefined();
  });

  it('surfaces a 409 message from addSource', async () => {
    const f = (async () => new Response(
      JSON.stringify({ statusCode: 409, message: 'That source is already configured' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
    await expect(addSource({ kind: 'dou', url: 'https://x.co/' }, f))
      .rejects.toThrow('That source is already configured');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -- settings-client`
Expected: FAIL — cannot resolve `../src/api/settings`.

- [ ] **Step 8: Create `dashboard/src/api/settings.ts`**

```ts
import { getJson, sendJson } from './client';
import type {
  ProfileInput, RubricWeights, SettingsResponse, SourceInput, SourceRow,
} from './types';

export function fetchSettings(fetchFn: typeof fetch = fetch): Promise<SettingsResponse> {
  return getJson<SettingsResponse>('/api/settings', fetchFn);
}

export async function saveCv(cv: string, fetchFn: typeof fetch = fetch): Promise<number> {
  const { version } = await sendJson<{ version: number }>('PUT', '/api/settings/cv', { cv }, fetchFn);
  return version;
}

export async function saveRubric(
  body: string, weights: RubricWeights, fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await sendJson<{ version: number }>(
    'PUT', '/api/settings/rubric', { body, weights }, fetchFn,
  );
  return res.version;
}

export async function saveProfile(
  profile: ProfileInput, fetchFn: typeof fetch = fetch,
): Promise<number> {
  const res = await sendJson<{ version: number }>('PUT', '/api/settings/profile', profile, fetchFn);
  return res.version;
}

export async function fetchSources(fetchFn: typeof fetch = fetch): Promise<SourceRow[]> {
  const { sources } = await getJson<{ sources: SourceRow[] }>('/api/sources', fetchFn);
  return sources;
}

export async function addSource(
  input: SourceInput, fetchFn: typeof fetch = fetch,
): Promise<SourceRow> {
  const { source } = await sendJson<{ source: SourceRow }>('POST', '/api/sources', input, fetchFn);
  return source;
}

export async function toggleSource(
  id: string, enabled: boolean, fetchFn: typeof fetch = fetch,
): Promise<SourceRow> {
  const { source } = await sendJson<{ source: SourceRow }>(
    'PATCH', `/api/sources/${id}`, { enabled }, fetchFn,
  );
  return source;
}

export async function deleteSource(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  await sendJson<void>('DELETE', `/api/sources/${id}`, undefined, fetchFn);
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all dashboard suites.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(dashboard): settings API client, and read NestJS message on errors

The client read body.error, which NestJS only ever sets to the generic
status name, so every validation failure rendered as 'Bad Request'."
```

---

### Task 10: Save hook, tab navigation, and the CV editor

The first Settings section. It establishes the dirty-tracking and save pattern the other three reuse.

**Files:**
- Create: `dashboard/src/hooks/useSave.ts`
- Create: `dashboard/src/components/SettingsPage.tsx`
- Create: `dashboard/src/components/DocumentEditor.tsx`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/styles.css`
- Test: `dashboard/tests/useSave.test.tsx`, `dashboard/tests/SettingsPage.test.tsx`, `dashboard/tests/App.test.tsx`

**Interfaces:**
- Consumes: `fetchSettings`, `saveCv` (Task 9); `useApi` from `src/hooks/useApi.ts`.
- Produces:
  - `useSave<T>(save: (value: T) => Promise<unknown>)` → `{run, saving, error, saved}`
  - `<DocumentEditor label value onSave rows />` — textarea + dirty-tracked Save
  - `<SettingsPage />` — the tab body
  - `App` renders a Postings / Settings tab pair

- [ ] **Step 1: Write the failing save-hook test**

Create `dashboard/tests/useSave.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSave } from '../src/hooks/useSave';

describe('useSave', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useSave(async () => {}));
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.saved).toBe(false);
  });

  it('reports saved after a successful run', async () => {
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useSave(save));

    await act(async () => { await result.current.run('value'); });

    expect(save).toHaveBeenCalledWith('value');
    await waitFor(() => expect(result.current.saved).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('captures the error message and stays unsaved', async () => {
    const { result } = renderHook(() => useSave(async () => {
      throw new Error('minSalaryUsd: must be positive');
    }));

    await act(async () => { await result.current.run('value'); });

    expect(result.current.error).toBe('minSalaryUsd: must be positive');
    expect(result.current.saved).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('clears a previous error on the next successful run', async () => {
    let fail = true;
    const { result } = renderHook(() => useSave(async () => {
      if (fail) throw new Error('nope');
    }));

    await act(async () => { await result.current.run('a'); });
    expect(result.current.error).toBe('nope');

    fail = false;
    await act(async () => { await result.current.run('b'); });
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- useSave`
Expected: FAIL — cannot resolve `../src/hooks/useSave`.

- [ ] **Step 3: Create `dashboard/src/hooks/useSave.ts`**

```ts
import { useCallback, useRef, useState } from 'react';

export interface SaveState<T> {
  run: (value: T) => Promise<void>;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

/**
 * No optimistic updates: PUT, then let the caller refetch. On failure the form
 * keeps the user's input and stays dirty, so nothing is silently lost.
 */
export function useSave<T>(save: (value: T) => Promise<unknown>): SaveState<T> {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async (value: T) => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveRef.current(value);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  return { run, saving, error, saved };
}
```

- [ ] **Step 4: Run the hook test**

Run: `npm test -- useSave`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing settings-page test**

Create `dashboard/tests/SettingsPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../src/components/SettingsPage';
import * as api from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };
const SETTINGS = {
  cv: 'existing cv', rubricBody: 'existing rubric', rubricWeights: WEIGHTS,
  profile: {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
  },
  version: 3, updatedAt: '2026-08-25T10:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchSettings').mockResolvedValue({ ...SETTINGS });
  vi.spyOn(api, 'fetchSources').mockResolvedValue([]);
});

describe('SettingsPage CV section', () => {
  it('loads the current cv into the textarea', async () => {
    render(<SettingsPage />);
    expect(await screen.findByDisplayValue('existing cv')).toBeInTheDocument();
  });

  it('disables Save until the value changes', async () => {
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    const save = screen.getByRole('button', { name: /save cv/i });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^cv$/i), '!');
    expect(save).toBeEnabled();
  });

  it('saves the edited cv', async () => {
    const saveCv = vi.spyOn(api, 'saveCv').mockResolvedValue(4);
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' more');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    await waitFor(() => expect(saveCv).toHaveBeenCalledWith('existing cv more'));
  });

  it('shows the server message and keeps the input on failure', async () => {
    vi.spyOn(api, 'saveCv').mockRejectedValue(new Error('cv: Required'));
    render(<SettingsPage />);
    await screen.findByDisplayValue('existing cv');

    await userEvent.type(screen.getByLabelText(/^cv$/i), ' x');
    await userEvent.click(screen.getByRole('button', { name: /save cv/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cv: Required');
    expect(screen.getByLabelText(/^cv$/i)).toHaveValue('existing cv x');
  });

  it('shows the current settings version', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText(/version 3/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.spyOn(api, 'fetchSettings').mockRejectedValue(new Error('db exploded'));
    render(<SettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('db exploded');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- SettingsPage`
Expected: FAIL — cannot resolve `../src/components/SettingsPage`.

- [ ] **Step 7: Create `dashboard/src/components/DocumentEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useSave } from '../hooks/useSave';

interface Props {
  id: string;
  label: string;
  initial: string;
  rows?: number;
  onSave: (value: string) => Promise<unknown>;
  onSaved: () => void;
}

export function DocumentEditor({ id, label, initial, rows = 14, onSave, onSaved }: Props) {
  const [value, setValue] = useState(initial);
  // Re-seed when a refetch brings a newer server value.
  useEffect(() => { setValue(initial); }, [initial]);

  const save = useSave<string>(onSave);
  const dirty = value !== initial;

  return (
    <section className="settings-section">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="settings-actions">
        <button
          type="button"
          disabled={!dirty || save.saving}
          onClick={async () => { await save.run(value); onSaved(); }}
        >
          {save.saving ? 'Saving…' : `Save ${label}`}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Create `dashboard/src/components/SettingsPage.tsx`**

```tsx
import { useApi } from '../hooks/useApi';
import { fetchSettings, saveCv } from '../api/settings';
import { DocumentEditor } from './DocumentEditor';

export function SettingsPage() {
  const settings = useApi(() => fetchSettings());

  if (settings.loading) return <p className="state">Loading…</p>;
  if (settings.error) return <p className="state" role="alert">Error: {settings.error}</p>;
  if (!settings.data) return null;

  const s = settings.data;

  return (
    <div className="settings">
      <p className="settings-version">
        Scoring settings version {s.version} — changes apply on the next run.
      </p>

      <DocumentEditor
        id="cv"
        label="CV"
        initial={s.cv}
        onSave={(v) => saveCv(v)}
        onSaved={settings.reload}
      />
    </div>
  );
}
```

- [ ] **Step 9: Run the settings-page test**

Run: `npm test -- SettingsPage`
Expected: PASS (6 tests)

- [ ] **Step 10: Write the failing tab-navigation test**

Append to `dashboard/tests/App.test.tsx`:

```tsx
describe('tab navigation', () => {
  it('shows postings first', async () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to settings and back', async () => {
    render(<App />);

    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });
});
```

Keep the file's existing `fetch` stub; extend it so `/api/settings` and `/api/sources` also resolve, otherwise the Settings tab renders an error:

```tsx
// in the existing beforeEach fetch stub, add these branches:
if (url.startsWith('/api/settings')) {
  return jsonResponse({
    cv: '', rubricBody: '', rubricWeights: {
      coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
    },
    profile: {
      excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null, timezone: 'Europe/Kyiv',
    },
    version: 1, updatedAt: '2026-08-25T10:00:00.000Z',
  });
}
if (url.startsWith('/api/sources')) return jsonResponse({ sources: [] });
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npm test -- App`
Expected: FAIL — no elements with role `tab`.

- [ ] **Step 12: Add the tabs to `dashboard/src/App.tsx`**

```tsx
import { useState } from 'react';
import { fetchHealth, fetchPostings } from './api/client';
import { useApi } from './hooks/useApi';
import { Filters } from './components/Filters';
import { PostingsTable } from './components/PostingsTable';
import { SourceHealth } from './components/SourceHealth';
import { SettingsPage } from './components/SettingsPage';
import type { PostingFilters } from './api/types';

type Tab = 'postings' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('postings');
  const [filters, setFilters] = useState<PostingFilters>({});

  const postings = useApi(() => fetchPostings(filters), [filters]);
  const health = useApi(() => fetchHealth());

  return (
    <>
      <h1>JobRadar</h1>

      {/* Two screens do not justify a routing dependency. */}
      <nav className="tabs" role="tablist">
        {(['postings', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={tab === t ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t === 'postings' ? 'Postings' : 'Settings'}
          </button>
        ))}
      </nav>

      {tab === 'settings' ? <SettingsPage /> : (
        <>
          <Filters value={filters} onChange={setFilters} rows={postings.data ?? []} />

          {postings.loading && <p className="state">Loading…</p>}
          {postings.error && <p className="state" role="alert">Error: {postings.error}</p>}
          {!postings.loading && !postings.error && <PostingsTable rows={postings.data ?? []} />}

          <SourceHealth rows={health.data ?? []} />
        </>
      )}
    </>
  );
}
```

- [ ] **Step 13: Add the styles**

Append to `dashboard/src/styles.css`:

```css
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tab { padding: 0.4rem 0.9rem; cursor: pointer; }
.tab-active { font-weight: 600; text-decoration: underline; }

.settings { display: flex; flex-direction: column; gap: 2rem; max-width: 60rem; }
.settings-version { opacity: 0.7; font-size: 0.9rem; }
.settings-section { display: flex; flex-direction: column; gap: 0.4rem; }
.settings-section label { font-weight: 600; }
.settings-section textarea { width: 100%; font-family: inherit; }
.settings-actions { display: flex; gap: 0.75rem; align-items: center; }
```

- [ ] **Step 14: Run the whole dashboard suite**

Run: `npm test && npm run build`
Expected: all PASS; `tsc -b && vite build` clean.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(dashboard): settings tab with the CV editor and save hook"
```

---

### Task 11: Profile form

**Files:**
- Create: `dashboard/src/components/ChipInput.tsx`, `dashboard/src/components/ProfileForm.tsx`
- Modify: `dashboard/src/components/SettingsPage.tsx`, `dashboard/src/styles.css`
- Test: `dashboard/tests/ChipInput.test.tsx`, `dashboard/tests/ProfileForm.test.tsx`

**Interfaces:**
- Consumes: `saveProfile` (Task 9), `useSave` (Task 10), `ProfileInput` type (Task 9).
- Produces: `<ChipInput id label value onChange suggestions />`, `<ProfileForm initial onSaved />`.

- [ ] **Step 1: Write the failing chip-input test**

Create `dashboard/tests/ChipInput.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from '../src/components/ChipInput';

describe('ChipInput', () => {
  it('renders one chip per value', () => {
    render(<ChipInput id="x" label="Excluded" value={['US', 'India']} onChange={() => {}} />);
    expect(screen.getByText('US')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument();
  });

  it('adds a value on Enter and clears the field', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={[]} onChange={onChange} />);

    const input = screen.getByLabelText('Excluded');
    await userEvent.type(input, 'Poland{Enter}');

    expect(onChange).toHaveBeenCalledWith(['Poland']);
    expect(input).toHaveValue('');
  });

  it('trims whitespace and ignores an empty entry', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={[]} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Excluded'), '   {Enter}');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Excluded'), '  Berlin  {Enter}');
    expect(onChange).toHaveBeenCalledWith(['Berlin']);
  });

  it('refuses a duplicate', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Excluded'), 'US{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip', async () => {
    const onChange = vi.fn();
    render(<ChipInput id="x" label="Excluded" value={['US', 'India']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /remove us/i }));
    expect(onChange).toHaveBeenCalledWith(['India']);
  });

  it('does not submit a surrounding form on Enter', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ChipInput id="x" label="Excluded" value={[]} onChange={() => {}} />
      </form>,
    );
    await userEvent.type(screen.getByLabelText('Excluded'), 'Kyiv{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- ChipInput`
Expected: FAIL — cannot resolve `../src/components/ChipInput`.

- [ ] **Step 3: Create `dashboard/src/components/ChipInput.tsx`**

```tsx
import { useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}

export function ChipInput({ id, label, value, onChange, suggestions }: Props) {
  const [draft, setDraft] = useState('');

  function commit(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    // Enter in a chip field means "add a chip", never "submit the form".
    e.preventDefault();

    const next = draft.trim();
    setDraft('');
    if (next === '' || value.includes(next)) return;
    onChange([...value, next]);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <ul className="chips">
        {value.map((v) => (
          <li key={v} className="chip">
            {v}
            <button type="button" aria-label={`Remove ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        list={suggestions ? `${id}-suggestions` : undefined}
        value={draft}
        placeholder="Type and press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={commit}
      />
      {suggestions && (
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the chip test**

Run: `npm test -- ChipInput`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing profile-form test**

Create `dashboard/tests/ProfileForm.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from '../src/components/ProfileForm';
import * as api from '../src/api/settings';

const PROFILE = {
  excludedLocations: ['United States'],
  allowedEmploymentTypes: ['full-time'],
  minSalaryUsd: 5000,
  timezone: 'Europe/Kyiv',
};

beforeEach(() => vi.restoreAllMocks());

describe('ProfileForm', () => {
  it('renders the current profile', () => {
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum salary/i)).toHaveValue(5000);
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Europe/Kyiv');
  });

  it('disables Save until something changes', async () => {
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
    const save = screen.getByRole('button', { name: /save profile/i });
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    expect(save).toBeEnabled();
  });

  it('saves the edited profile', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '7000');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, minSalaryUsd: 7000,
    }));
  });

  it('sends null, not zero, when the salary is cleared', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, minSalaryUsd: null,
    }));
  });

  it('adds an excluded location', async () => {
    const saveProfile = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/excluded locations/i), 'Canada{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith({
      ...PROFILE, excludedLocations: ['United States', 'Canada'],
    }));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveProfile').mockRejectedValue(
      new Error('minSalaryUsd: Number must be greater than 0'),
    );
    render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);

    await userEvent.clear(screen.getByLabelText(/minimum salary/i));
    await userEvent.type(screen.getByLabelText(/minimum salary/i), '3');
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('minSalaryUsd');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- ProfileForm`
Expected: FAIL — cannot resolve `../src/components/ProfileForm`.

- [ ] **Step 7: Create `dashboard/src/components/ProfileForm.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { saveProfile } from '../api/settings';
import { useSave } from '../hooks/useSave';
import { ChipInput } from './ChipInput';
import type { ProfileInput } from '../api/types';

// ProfileSchema types these as free strings, not an enum, so these are hints
// rather than a fixed set.
const EMPLOYMENT_SUGGESTIONS = ['full-time', 'part-time', 'contract', 'internship'];

interface Props {
  initial: ProfileInput;
  onSaved: () => void;
}

export function ProfileForm({ initial, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileInput>(initial);
  useEffect(() => { setDraft(initial); }, [initial]);

  const save = useSave<ProfileInput>(saveProfile);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <section className="settings-section">
      <h2>Profile</h2>

      <ChipInput
        id="excluded-locations" label="Excluded locations"
        value={draft.excludedLocations}
        onChange={(v) => set('excludedLocations', v)}
      />

      <ChipInput
        id="employment-types" label="Allowed employment types"
        value={draft.allowedEmploymentTypes}
        onChange={(v) => set('allowedEmploymentTypes', v)}
        suggestions={EMPLOYMENT_SUGGESTIONS}
      />

      <div className="field">
        <label htmlFor="min-salary">Minimum salary (USD)</label>
        <input
          id="min-salary" type="number" min={1}
          value={draft.minSalaryUsd ?? ''}
          // An empty field means "no minimum", which is null — not 0, which
          // ProfileSchema would reject as non-positive.
          onChange={(e) => set('minSalaryUsd', e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label htmlFor="timezone">Timezone</label>
        <input id="timezone" value={draft.timezone}
          onChange={(e) => set('timezone', e.target.value)} />
      </div>

      <div className="settings-actions">
        <button type="button" disabled={!dirty || save.saving}
          onClick={async () => { await save.run(draft); onSaved(); }}>
          {save.saving ? 'Saving…' : 'Save profile'}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Mount it in `SettingsPage`**

Add the import and render it above the CV editor:

```tsx
import { ProfileForm } from './ProfileForm';
// ...
      <ProfileForm initial={s.profile} onSaved={settings.reload} />
```

- [ ] **Step 9: Add the styles**

Append to `dashboard/src/styles.css`:

```css
.field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.75rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; list-style: none; padding: 0; margin: 0; }
.chip { display: inline-flex; align-items: center; gap: 0.3rem;
        border: 1px solid currentColor; border-radius: 999px; padding: 0.1rem 0.6rem; }
.chip button { border: none; background: none; cursor: pointer; font-size: 1rem; padding: 0; }
```

- [ ] **Step 10: Run the dashboard suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(dashboard): profile form with chip inputs"
```

---

### Task 12: Sources table

**Files:**
- Create: `dashboard/src/components/SourcesTable.tsx`
- Modify: `dashboard/src/components/SettingsPage.tsx`, `dashboard/src/styles.css`
- Test: `dashboard/tests/SourcesTable.test.tsx`

**Interfaces:**
- Consumes: `fetchSources`, `addSource`, `toggleSource`, `deleteSource` (Task 9); `SourceRow`, `SourceInput` types.
- Produces: `<SourcesTable />` — self-contained; loads its own rows and refetches after every mutation.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/SourcesTable.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesTable } from '../src/components/SourcesTable';
import * as api from '../src/api/settings';
import type { SourceRow } from '../src/api/types';

const ats: SourceRow = {
  id: 'a1', kind: 'ats', board: 'greenhouse', slug: 'acme',
  url: null, enabled: true, createdAt: '2026-08-25T10:00:00.000Z',
};
const dou: SourceRow = {
  id: 'd1', kind: 'dou', board: null, slug: null,
  url: 'https://jobs.dou.ua/a/', enabled: false, createdAt: '2026-08-25T10:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'fetchSources').mockResolvedValue([ats, dou]);
});

describe('SourcesTable', () => {
  it('lists enabled and disabled sources with their identity', async () => {
    render(<SourcesTable />);
    expect(await screen.findByText('greenhouse:acme')).toBeInTheDocument();
    expect(screen.getByText('https://jobs.dou.ua/a/')).toBeInTheDocument();
  });

  it('reflects enabled state in the toggle', async () => {
    render(<SourcesTable />);
    const toggles = await screen.findAllByRole('checkbox');
    expect(toggles[0]).toBeChecked();
    expect(toggles[1]).not.toBeChecked();
  });

  it('toggles a source and refetches', async () => {
    const toggle = vi.spyOn(api, 'toggleSource').mockResolvedValue({ ...ats, enabled: false });
    render(<SourcesTable />);

    await userEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('a1', false));
    expect(api.fetchSources).toHaveBeenCalledTimes(2);
  });

  it('deletes a source', async () => {
    const del = vi.spyOn(api, 'deleteSource').mockResolvedValue(undefined);
    render(<SourcesTable />);

    await userEvent.click((await screen.findAllByRole('button', { name: /delete/i }))[0]!);
    await waitFor(() => expect(del).toHaveBeenCalledWith('a1'));
  });

  it('shows board and slug fields for ats, url for the others', async () => {
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    // The add form defaults to ats.
    expect(screen.getByLabelText(/board/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^url$/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/kind/i), 'djinni');
    expect(screen.queryByLabelText(/board/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^url$/i)).toBeInTheDocument();
  });

  it('adds an ats source', async () => {
    const add = vi.spyOn(api, 'addSource').mockResolvedValue(ats);
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.selectOptions(screen.getByLabelText(/board/i), 'lever');
    await userEvent.type(screen.getByLabelText(/slug/i), 'globex');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({
      kind: 'ats', board: 'lever', slug: 'globex',
    }));
  });

  it('adds a url source', async () => {
    const add = vi.spyOn(api, 'addSource').mockResolvedValue(dou);
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.selectOptions(screen.getByLabelText(/kind/i), 'dou');
    await userEvent.type(screen.getByLabelText(/^url$/i), 'https://jobs.dou.ua/b/');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({
      kind: 'dou', url: 'https://jobs.dou.ua/b/',
    }));
  });

  it('shows the 409 message and keeps the input', async () => {
    vi.spyOn(api, 'addSource').mockRejectedValue(
      new Error('That source is already configured'),
    );
    render(<SourcesTable />);
    await screen.findByText('greenhouse:acme');

    await userEvent.type(screen.getByLabelText(/slug/i), 'acme');
    await userEvent.click(screen.getByRole('button', { name: /add source/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already configured');
    expect(screen.getByLabelText(/slug/i)).toHaveValue('acme');
  });

  it('says so when there are no sources at all', async () => {
    vi.spyOn(api, 'fetchSources').mockResolvedValue([]);
    render(<SourcesTable />);
    expect(await screen.findByText(/no sources configured/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- SourcesTable`
Expected: FAIL — cannot resolve `../src/components/SourcesTable`.

- [ ] **Step 3: Create `dashboard/src/components/SourcesTable.tsx`**

```tsx
import { useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import type { SourceInput, SourceKind, SourceRow } from '../api/types';

const BOARDS = ['greenhouse', 'lever', 'ashby'] as const;

function identity(r: SourceRow): string {
  return r.kind === 'ats' ? `${r.board}:${r.slug}` : (r.url ?? '');
}

export function SourcesTable() {
  const sources = useApi(() => fetchSources());

  const [kind, setKind] = useState<SourceKind>('ats');
  const [board, setBoard] = useState<(typeof BOARDS)[number]>('greenhouse');
  const [slug, setSlug] = useState('');
  const [url, setUrl] = useState('');

  const add = useSave<SourceInput>(addSource);
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  async function submit() {
    const input: SourceInput = kind === 'ats'
      ? { kind: 'ats', board, slug }
      : { kind, url };

    await add.run(input);
    sources.reload();
  }

  return (
    <section className="settings-section">
      <h2>Sources</h2>

      {sources.error && <p className="state" role="alert">Error: {sources.error}</p>}

      {sources.data?.length === 0
        ? <p className="state">No sources configured — add one below.</p>
        : (
          <table>
            <thead>
              <tr><th>On</th><th>Kind</th><th>Identity</th><th /></tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((r) => (
                <tr key={r.id} className={r.enabled ? undefined : 'row-disabled'}>
                  <td>
                    <input
                      type="checkbox" checked={r.enabled}
                      aria-label={`Enable ${identity(r)}`}
                      onChange={async () => {
                        await mutate.run(() => toggleSource(r.id, !r.enabled));
                        sources.reload();
                      }}
                    />
                  </td>
                  <td>{r.kind}</td>
                  <td>{identity(r)}</td>
                  <td>
                    <button type="button" onClick={async () => {
                      await mutate.run(() => deleteSource(r.id));
                      sources.reload();
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {/* Identity is immutable: postings.id derives from board:slug, so a typo
          is fixed by delete-and-re-add, not by editing in place. */}
      <div className="add-source">
        <div className="field">
          <label htmlFor="source-kind">Kind</label>
          <select id="source-kind" value={kind}
            onChange={(e) => setKind(e.target.value as SourceKind)}>
            <option value="ats">ats</option>
            <option value="djinni">djinni</option>
            <option value="dou">dou</option>
          </select>
        </div>

        {kind === 'ats' ? (
          <>
            <div className="field">
              <label htmlFor="source-board">Board</label>
              <select id="source-board" value={board}
                onChange={(e) => setBoard(e.target.value as (typeof BOARDS)[number])}>
                {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="source-slug">Slug</label>
              <input id="source-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="source-url">URL</label>
            <input id="source-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}

        <div className="settings-actions">
          <button type="button" disabled={add.saving} onClick={submit}>
            {add.saving ? 'Adding…' : 'Add source'}
          </button>
          {add.error && <span className="state" role="alert">{add.error}</span>}
          {mutate.error && <span className="state" role="alert">{mutate.error}</span>}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount it in `SettingsPage`**

```tsx
import { SourcesTable } from './SourcesTable';
// ...render below ProfileForm:
      <SourcesTable />
```

- [ ] **Step 5: Add the styles**

```css
.row-disabled { opacity: 0.5; }
.add-source { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- SourcesTable`
Expected: PASS (10 tests)

- [ ] **Step 7: Run the full dashboard suite and build**

Run: `npm test && npm run build`
Expected: all PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(dashboard): sources table with enable toggle and add form"
```

---

### Task 13: Rubric editor with weights

**Files:**
- Create: `dashboard/src/components/RubricEditor.tsx`
- Modify: `dashboard/src/components/SettingsPage.tsx`, `dashboard/src/styles.css`
- Test: `dashboard/tests/RubricEditor.test.tsx`

**Interfaces:**
- Consumes: `saveRubric` (Task 9), `useSave` (Task 10), `RubricWeights` type.
- Produces: `<RubricEditor initialBody initialWeights onSaved />`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/RubricEditor.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RubricEditor } from '../src/components/RubricEditor';
import * as api from '../src/api/settings';

const WEIGHTS = { coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10 };

beforeEach(() => vi.restoreAllMocks());

function setup() {
  return render(
    <RubricEditor initialBody="score it" initialWeights={WEIGHTS} onSaved={() => {}} />,
  );
}

describe('RubricEditor', () => {
  it('renders the prose and every weight', () => {
    setup();
    expect(screen.getByLabelText(/rubric/i)).toHaveValue('score it');
    expect(screen.getByLabelText(/coreStack/i)).toHaveValue(35);
    expect(screen.getByLabelText(/growth/i)).toHaveValue(10);
  });

  it('shows each weight as a percentage of the total', () => {
    setup();
    // 35 of 100.
    expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
  });

  it('recomputes percentages live as a weight changes', async () => {
    setup();
    const core = screen.getByLabelText(/coreStack/i);

    await userEvent.clear(core);
    await userEvent.type(core, '135');

    // 135 of 200.
    await waitFor(() => expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('68%'));
    expect(screen.getByTestId('pct-growth')).toHaveTextContent('5%');
  });

  it('does not require the weights to sum to 100', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.clear(screen.getByLabelText(/coreStack/i));
    await userEvent.type(screen.getByLabelText(/coreStack/i), '70');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it', { ...WEIGHTS, coreStack: 70 }));
  });

  it('disables Save when every weight is zero', async () => {
    setup();
    for (const key of ['coreStack', 'seniority', 'domain', 'logistics', 'growth']) {
      const input = screen.getByLabelText(new RegExp(key, 'i'));
      await userEvent.clear(input);
      await userEvent.type(input, '0');
    }
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeDisabled();
    expect(screen.getByText(/at least one weight/i)).toBeInTheDocument();
  });

  it('disables Save until something changes', async () => {
    setup();
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/rubric/i), '!');
    expect(screen.getByRole('button', { name: /save rubric/i })).toBeEnabled();
  });

  it('saves prose and weights together', async () => {
    const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
    setup();

    await userEvent.type(screen.getByLabelText(/rubric/i), ' harder');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    await waitFor(() => expect(save).toHaveBeenCalledWith('score it harder', WEIGHTS));
  });

  it('shows the server message on failure', async () => {
    vi.spyOn(api, 'saveRubric').mockRejectedValue(
      new Error('weights: at least one weight must be above zero'),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/rubric/i), '!');
    await userEvent.click(screen.getByRole('button', { name: /save rubric/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('above zero');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- RubricEditor`
Expected: FAIL — cannot resolve `../src/components/RubricEditor`.

- [ ] **Step 3: Create `dashboard/src/components/RubricEditor.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { saveRubric } from '../api/settings';
import { useSave } from '../hooks/useSave';
import type { RubricWeights } from '../api/types';

const DIMENSIONS: (keyof RubricWeights)[] = [
  'coreStack', 'seniority', 'domain', 'logistics', 'growth',
];

interface Props {
  initialBody: string;
  initialWeights: RubricWeights;
  onSaved: () => void;
}

export function RubricEditor({ initialBody, initialWeights, onSaved }: Props) {
  const [body, setBody] = useState(initialBody);
  const [weights, setWeights] = useState<RubricWeights>(initialWeights);

  useEffect(() => { setBody(initialBody); }, [initialBody]);
  useEffect(() => { setWeights(initialWeights); }, [initialWeights]);

  const save = useSave<{ body: string; weights: RubricWeights }>(
    (v) => saveRubric(v.body, v.weights),
  );

  const sum = DIMENSIONS.reduce((a, k) => a + weights[k], 0);
  const allZero = sum === 0;
  const dirty = body !== initialBody
    || JSON.stringify(weights) !== JSON.stringify(initialWeights);

  return (
    <section className="settings-section">
      <h2>Rubric</h2>

      <label htmlFor="rubric">Rubric prose</label>
      <textarea id="rubric" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />

      {/* Weights are normalised by their actual sum, so they need not total
          100 — the percentage beside each is what the score actually uses. */}
      <div className="weights">
        {DIMENSIONS.map((key) => (
          <div className="field weight" key={key}>
            <label htmlFor={`w-${key}`}>{key}</label>
            <input
              id={`w-${key}`} type="number" min={0} max={1000}
              value={weights[key]}
              onChange={(e) => setWeights((w) => ({
                ...w, [key]: e.target.value === '' ? 0 : Number(e.target.value),
              }))}
            />
            <span className="pct" data-testid={`pct-${key}`}>
              {allZero ? '—' : `${Math.round((weights[key] / sum) * 100)}%`}
            </span>
          </div>
        ))}
      </div>

      {allZero && (
        <p className="state">At least one weight must be above zero.</p>
      )}

      <div className="settings-actions">
        <button
          type="button"
          disabled={!dirty || allZero || save.saving}
          onClick={async () => { await save.run({ body, weights }); onSaved(); }}
        >
          {save.saving ? 'Saving…' : 'Save rubric'}
        </button>
        {save.error && <span className="state" role="alert">{save.error}</span>}
        {save.saved && !dirty && <span className="state">Saved</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount it in `SettingsPage`**

Replace nothing; add below the CV editor:

```tsx
import { RubricEditor } from './RubricEditor';
// ...
      <RubricEditor
        initialBody={s.rubricBody}
        initialWeights={s.rubricWeights}
        onSaved={settings.reload}
      />
```

- [ ] **Step 5: Add the styles**

```css
.weights { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.5rem; }
.weight { min-width: 8rem; }
.weight input { width: 5rem; }
.pct { opacity: 0.7; font-size: 0.85rem; }
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- RubricEditor`
Expected: PASS (8 tests)

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(dashboard): rubric editor with normalised weight inputs"
```

---

### Task 14: Stale-score badge and first-run banner

The two touches that make the version counter visible. Both use data already on hand — no new tables, no new queries.

**Files (backend, run from `backend/`):**
- Modify: `backend/src/api/api.schema.ts`, `backend/src/api/dashboard.queries.ts:29-41`
- Test: `backend/src/api/postings.controller.spec.ts`

**Files (dashboard, run from `dashboard/`):**
- Modify: `dashboard/src/api/types.ts`, `dashboard/src/components/PostingsTable.tsx`, `dashboard/src/App.tsx`, `dashboard/src/styles.css`
- Test: `dashboard/tests/PostingsTable.test.tsx`, `dashboard/tests/App.test.tsx`

**Interfaces:**
- Consumes: `scores.settingsVersion` (Task 2), `GET /api/settings` (Task 7), `/api/health` rows carrying `source: 'settings'` (Task 6).
- Produces: `PostingRow.settingsVersion: string` on both sides; `<PostingsTable rows currentVersion />`.

- [ ] **Step 1 (backend): Add `settingsVersion` to the posting row schema**

In `src/api/api.schema.ts`, add to `PostingRowSchema` after `providerId`:

```ts
  settingsVersion: z.string(),
```

- [ ] **Step 2 (backend): Select the column**

In `src/api/dashboard.queries.ts`, add to the `select({...})` in `latestScores`, after `providerId`:

```ts
      settingsVersion: scores.settingsVersion,
```

- [ ] **Step 3 (backend): Assert it in the controller test**

In `src/api/postings.controller.spec.ts`, add `settingsVersion: '3'` to the stub row the fake queries service returns, and assert the field survives the response:

```ts
    expect(res.body.postings[0].settingsVersion).toBe('3');
```

- [ ] **Step 4 (backend): Run the tests**

Run: `npm test -- src/api` then `npm run build`
Expected: PASS; `tsc` clean.

- [ ] **Step 5 (dashboard): Add the field to the client type**

In `dashboard/src/api/types.ts`, add to `PostingRow`:

```ts
  settingsVersion: string;
```

- [ ] **Step 6 (dashboard): Write the failing badge test**

Append to `dashboard/tests/PostingsTable.test.tsx`:

```tsx
describe('stale settings badge', () => {
  const row = (over: Partial<PostingRow> = {}): PostingRow => ({
    postingId: 'a:1', title: 'T', company: 'C', url: 'https://e.com/1',
    source: 'ats', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'ok', providerId: 'fake', scoredAt: '2026-08-25T10:00:00.000Z',
    settingsVersion: '3', ...over,
  });

  it('badges a score from an older settings version', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '2' })]} currentVersion={3} />);
    expect(screen.getByTitle(/scored under settings version 2/i)).toBeInTheDocument();
  });

  it('does not badge a current score', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '3' })]} currentVersion={3} />);
    expect(screen.queryByTitle(/scored under settings/i)).not.toBeInTheDocument();
  });

  it('does not badge when the current version is unknown', () => {
    render(<PostingsTable rows={[row({ settingsVersion: '2' })]} currentVersion={null} />);
    expect(screen.queryByTitle(/scored under settings/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7 (dashboard): Run it to verify it fails**

Run: `npm test -- PostingsTable`
Expected: FAIL — `PostingsTable` takes no `currentVersion` prop and renders no badge.

- [ ] **Step 8 (dashboard): Add the badge**

In `dashboard/src/components/PostingsTable.tsx`, widen the props:

```tsx
interface Props {
  rows: PostingRow[];
  currentVersion: number | null;
}

export function PostingsTable({ rows, currentVersion }: Props) {
```

and inside the row rendering, beside the title cell, add:

```tsx
{currentVersion !== null && Number(r.settingsVersion) !== currentVersion && (
  <span
    className="stale"
    title={`Scored under settings version ${r.settingsVersion}; current is ${currentVersion}`}
  >
    ⚠
  </span>
)}
```

Editing the CV, profile, or rubric does not rescore stored postings, so without this a mixed table looks uniform when it is not.

- [ ] **Step 9 (dashboard): Write the failing first-run banner test**

Append to `dashboard/tests/App.test.tsx`:

```tsx
describe('first-run banner', () => {
  it('prompts setup when health reports incomplete settings', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error',
        ranAt: '2026-08-25T10:00:00.000Z', error: 'settings incomplete: no CV',
      }],
    });
    render(<App />);
    expect(await screen.findByRole('status')).toHaveTextContent(/finish setup/i);
  });

  it('links the banner to the settings tab', async () => {
    stubFetch({
      health: [{
        source: 'settings', status: 'error',
        ranAt: '2026-08-25T10:00:00.000Z', error: 'settings incomplete: no enabled sources',
      }],
    });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: /finish setup/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows no banner when settings are complete', async () => {
    stubFetch({ health: [{ source: 'ats', status: 'ok', ranAt: '2026-08-25T10:00:00.000Z', error: null }] });
    render(<App />);
    await screen.findByRole('tab', { name: /postings/i });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
```

Extract the existing inline `fetch` stub in this file into a `stubFetch({health = [], postings = []})` helper so these cases can vary the health payload; keep its current default branches for `/api/settings` and `/api/sources`.

- [ ] **Step 10 (dashboard): Run it to verify it fails**

Run: `npm test -- App`
Expected: FAIL — no element with role `status`.

- [ ] **Step 11 (dashboard): Add the banner and thread the version**

In `dashboard/src/App.tsx`, load settings alongside health so the badge has a current version, and derive the banner from the health rows:

```tsx
import { fetchSettings } from './api/settings';
// ...
  const settings = useApi(() => fetchSettings());

  const incomplete = (health.data ?? []).some(
    (h) => h.source === 'settings' && (h.error ?? '').includes('settings incomplete'),
  );
```

Render the banner above the tabs:

```tsx
      {incomplete && (
        <p className="banner" role="status">
          JobRadar is not scoring yet — it needs a CV and at least one source.{' '}
          <button type="button" onClick={() => setTab('settings')}>Finish setup</button>
        </p>
      )}
```

and pass the version into the table:

```tsx
<PostingsTable rows={postings.data ?? []} currentVersion={settings.data?.version ?? null} />
```

The banner reads the same `run_log` rows the health panel already shows, so the pipeline's incomplete-settings guard is its only source of truth.

- [ ] **Step 12 (dashboard): Add the styles**

```css
.banner { padding: 0.6rem 0.9rem; border: 1px solid currentColor; border-radius: 4px; }
.stale { margin-left: 0.4rem; cursor: help; }
```

- [ ] **Step 13: Run both suites**

From `dashboard/`: `npm test && npm run build`
From `backend/`: `npm test`
Expected: all PASS.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(dashboard): stale-settings badge and first-run setup banner"
```

---

### Task 15: Drop the config mount and update the docs

The last step of the migration: once settings live in the database, the read-only `/config` mount on `worker` is dead weight. It stays on `migrate` so an upgrading install can still import.

**Files:**
- Modify: `docker-compose.yml`, `README.md`, `.env.example`
- Delete: `config/` (optional — see Step 4)

**Interfaces:**
- Consumes: everything above.
- Produces: a stack where only `migrate` reads `/config`, and only when seeding an empty database.

- [ ] **Step 1: Verify a full stack works end to end before changing anything**

```bash
docker compose down -v
docker compose up -d --build
docker compose logs migrate
curl -s localhost:8080/api/settings | head -c 120
curl -s localhost:8080/api/health
open http://localhost:8080
```
Expected: `"outcome":"seeded-from-files"`; the settings JSON matching your `config/` files; the dashboard's Settings tab showing them.

- [ ] **Step 2: Remove the mount from `worker` and `worker-dev`**

In `docker-compose.yml`, delete these two lines from the `worker` service:

```yaml
    environment:
      CONFIG_DIR: /config
    volumes: ["./config:/config:ro"]
```

(keep `env_file: [.env]`), and delete the equivalent `CONFIG_DIR` environment entry and `./config:/config:ro` volume from `worker-dev`. Leave the `migrate` service exactly as Task 5 left it — it is the only service that still reads `/config`.

- [ ] **Step 3: Verify the worker runs with no config directory**

```bash
docker compose up -d --build worker
docker compose logs --tail 20 worker
```
Expected: `{"event":"worker.started",...}` and a pipeline run that reads settings from the database. No `Missing required config file` error.

- [ ] **Step 4: Note that `config/` is now optional**

Keep the directory as a backup, or remove it:

```bash
git rm -r --cached config && echo "config/" >> .gitignore
```

Do not delete it before confirming Step 1 imported what you expected — the seeder only runs against an empty `app_settings`, so a premature delete means retyping your CV.

- [ ] **Step 5: Rewrite the README's "Tuning the rubric" section**

Replace it with:

```markdown
## Tuning the rubric

Open the dashboard, switch to the **Settings** tab, and edit the rubric prose or
the five dimension weights. Saving bumps the settings version, which is stored
with every score written afterwards, so old scores stay interpretable and the
postings table marks any row scored under an older version.

Weights do not need to sum to 100 — each one is normalised by the actual total,
and the percentage shown beside it is what the score uses. Raising `coreStack`
from 35 to 70 doubles its influence without touching the other four.

Changes take effect on the next scheduled run (every 30 minutes). No restart.

Watch the near-miss band (scores 40–49, shown in red) — a cluster of good
vacancies there means the rubric needs adjustment.
```

- [ ] **Step 6: Update the README's first-run instructions**

Replace the setup section's config-file steps with:

```markdown
## First run

```
cp .env.example .env && $EDITOR .env    # API keys and Telegram credentials
docker compose up -d
open http://localhost:8080
```

The dashboard opens on an empty Postings table with a "finish setup" prompt.
Switch to **Settings**, paste your CV, set your hard constraints, and add at
least one source. The next scheduled run picks them up.

Upgrading from a file-configured install? Leave `config/` in place for the first
`docker compose up` — the `migrate` service imports it into the database once,
and never touches it again.
```

- [ ] **Step 7: Note in `.env.example` what did not move**

Add a comment above the notify threshold entries:

```
# Thresholds and credentials stay here, not in the database: they are
# deployment config, and the API must never return them to a browser.
```

- [ ] **Step 8: Full verification from a clean slate**

```bash
docker compose down -v
docker compose up -d --build
docker compose logs migrate
curl -s localhost:8080/api/settings | head -c 120
curl -s -X POST localhost:8080/api/sources -H 'content-type: application/json' \
  -d '{"kind":"ats","board":"greenhouse","slug":"acme"}'
docker compose restart worker && docker compose logs --tail 30 worker
```
Expected: seeding runs; settings return; the source is created; the worker's next run fetches from the new source with no rebuild and no file edit.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "build: drop the /config mount from worker, update the docs

Only the migrate service still reads /config, and only to seed an empty
database. Settings are edited in the dashboard from here on."
```

---

## Verification

Run all three suites from a clean checkout:

```bash
docker compose up -d db
export DATABASE_URL=postgres://jobradar:jobradar@localhost:5433/jobradar
export DATABASE_URL_TEST="$DATABASE_URL"

cd backend  && npm run build && npm test && npm run migrate && npm run test:integration
cd ../dashboard && npm test && npm run build
cd .. && docker compose down -v && docker compose up -d --build
```

Expected: `tsc` clean in both projects, every suite green, and a stack whose Settings tab round-trips all four documents.
