# Postings Redesign and Dashboard Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard real routes, drive the Postings filters from the URL, and rebuild the Postings page to the Broadsheet design — a ledger feed grouped by day, with an expandable sub-score breakdown.

**Architecture:** `react-router-dom` v7 turns `App` into a layout that owns the three API fetches and hands them down through a context; `/` renders Postings and `/settings` renders the existing Settings page unchanged. All Postings state — filters, sort, "show rejected" — lives in the query string. Presentation moves from one global stylesheet to per-component CSS Modules over a shared token file, and every derived value (day buckets, relative time, near-miss, rejection sentences) is extracted into a pure, clock-injected module that is tested directly.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 3 + jsdom + Testing Library, `react-router-dom` v7, `@fontsource/source-serif-4`, CSS Modules (built into Vite). Backend: NestJS, Drizzle, Zod, Jest.

**Spec:** `docs/superpowers/specs/2026-08-26-postings-redesign-design.md`

## Global Constraints

- **Two test runners, split by intent.** Backend unit tests are Jest, live in `backend/src/**/*.spec.ts`, and run with `cd backend && npx jest`. Backend integration tests are Vitest, live in `backend/test/integration/**/*.integration.test.ts`, and self-skip without `DATABASE_URL_TEST`. Dashboard tests are Vitest + jsdom in `dashboard/tests/**/*.test.{ts,tsx}`. Never add a dashboard test to Jest or a unit test to the integration directory.
- **Response shapes are declared twice on purpose.** `backend/src/api/api.schema.ts` (Zod) and `dashboard/src/api/types.ts` (plain types). Changing one means changing the other in the same commit. Do not introduce a shared package.
- **Light theme only.** No dark-mode media queries, no `color-scheme: light dark`.
- **Colour is never the sole carrier of meaning.** Every state — verdict, near miss, stale, source failure — must also be carried by text, a glyph, or a counted shape.
- **Time is injected, never read from a global.** Every function whose result depends on the current time takes `now: Date` as a parameter. No `Date.now()` inside `src/postings/derive.ts`.
- **Design tokens are global; everything else is a CSS Module.** Only `src/styles/tokens.css` may define `:root` custom properties or style bare element selectors.
- **Exact palette values** (copy verbatim, do not re-derive): paper `#f3f2f2`, surface `#eae9e9`, ink `#201e1d`, accent `#0088b0`, accent-2 `#d6006c`.
- **Sub-score dimensions are on the 0–100 scale**, the same scale as `total` (`weightedTotal` divides by the weight sum, not by 100). A bar's width percentage is the score itself.
- **Commit after every task.** Do not batch tasks into one commit.

---

## File Structure

**Backend (3 files touched):**

| File | Responsibility |
|---|---|
| `backend/src/api/api.schema.ts` | Add `DimensionSchema`, `SubScoresSchema`; extend `PostingRowSchema` |
| `backend/src/api/dashboard.queries.ts` | Select `scores.subscores` in `latestScores` |
| `backend/src/api/api.schema.spec.ts` | New — Jest unit tests for the schema |

**Dashboard — new:**

| File | Responsibility |
|---|---|
| `src/styles/tokens.css` | Broadsheet `:root` tokens, font imports, base element styles |
| `src/postings/derive.ts` | All pure derived values. No React, no clock. |
| `src/api/filters-url.ts` | `UiFilters` ⇄ `URLSearchParams` ⇄ API `PostingFilters` |
| `src/context/DashboardData.tsx` | Context carrying the three `ApiState`s |
| `src/pages/PostingsPage.tsx` | Composes the Postings screen; owns URL filter state |
| `src/pages/SettingsPage.tsx` | Moved from `components/`, otherwise unchanged |
| `src/components/Masthead.tsx` + `.module.css` | Wordmark, tabs, rules, status line |
| `src/components/SetupBanner.tsx` + `.module.css` | The SET UP block |
| `src/components/postings/Filters.tsx` + `.module.css` | Rewritten filter bar |
| `src/components/postings/PostingsFeed.tsx` + `.module.css` | Day dividers, column head, row list |
| `src/components/postings/LedgerRow.tsx` + `.module.css` | One posting row |
| `src/components/postings/ScoreBreakdown.tsx` + `.module.css` | Five bars + notes |
| `src/components/postings/RejectedStrip.tsx` + `.module.css` | Rejected count + expansion |
| `src/components/postings/EmptyState.tsx` + `.module.css` | Fresh-install and no-match states |
| `src/components/SourceHealth.tsx` + `.module.css` | Rewritten as per-source run strips |

**Dashboard — deleted:** `src/styles.css`, `src/components/PostingsTable.tsx`, `src/components/VerdictBadge.tsx`, `src/components/Filters.tsx`, `tests/PostingsTable.test.tsx`.

---

## Task 1: Expose sub-scores on the postings API

**Files:**
- Modify: `backend/src/api/api.schema.ts`
- Modify: `backend/src/api/dashboard.queries.ts:30-45`
- Create: `backend/src/api/api.schema.spec.ts`
- Modify: `backend/test/integration/postings.repository.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PostingRow` gains `subscores: SubScores` where `SubScores` is `{ coreStack, seniority, domain, logistics, growth }`, each `{ score: number; note: string }`. Task 2 mirrors this type in the dashboard; Task 8 renders it.

- [ ] **Step 1: Write the failing test**

Create `backend/src/api/api.schema.spec.ts`:

```ts
import { PostingRowSchema, SubScoresSchema } from './api.schema';

const dimension = { score: 70, note: 'nine years on the stack' };
const subscores = {
  coreStack: dimension, seniority: dimension, domain: dimension,
  logistics: dimension, growth: dimension,
};

const row = {
  postingId: 'djinni:1', title: 'Senior Node Engineer', company: 'Acme',
  url: 'https://e.com/1', source: 'djinni', location: 'Remote',
  total: 82, verdict: 'STRONG', reasoning: 'stack matches',
  providerId: 'anthropic', settingsVersion: '3',
  scoredAt: '2026-08-25T10:00:00.000Z', subscores,
};

describe('PostingRowSchema', () => {
  it('accepts a row carrying all five sub-score dimensions', () => {
    expect(PostingRowSchema.parse(row).subscores.coreStack.score).toBe(70);
  });

  it('rejects a row missing a dimension', () => {
    const { growth, ...four } = subscores;
    expect(() => PostingRowSchema.parse({ ...row, subscores: four })).toThrow();
  });

  it('rejects a dimension without a note', () => {
    const broken = { ...subscores, domain: { score: 40 } };
    expect(() => PostingRowSchema.parse({ ...row, subscores: broken })).toThrow();
  });

  it('accepts the zeroed sub-scores a hard-filtered row carries', () => {
    const zero = { score: 0, note: 'hard filter' };
    const zeroed = {
      coreStack: zero, seniority: zero, domain: zero, logistics: zero, growth: zero,
    };
    expect(SubScoresSchema.parse(zeroed).logistics.note).toBe('hard filter');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/api/api.schema.spec.ts`
Expected: FAIL — `SubScoresSchema` is not exported from `./api.schema`.

- [ ] **Step 3: Add the schemas**

In `backend/src/api/api.schema.ts`, after `VerdictSchema`:

```ts
export const DimensionSchema = z.object({
  score: z.number().int(),
  note: z.string(),
});

export const SubScoresSchema = z.object({
  coreStack: DimensionSchema,
  seniority: DimensionSchema,
  domain: DimensionSchema,
  logistics: DimensionSchema,
  growth: DimensionSchema,
});
```

Then add one line to `PostingRowSchema`, after `scoredAt`:

```ts
  subscores: SubScoresSchema,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/api/api.schema.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Select the column in the query**

In `backend/src/api/dashboard.queries.ts`, inside the `.select({...})` object in `latestScores`, add after `scoredAt: scores.scoredAt,`:

```ts
      subscores: scores.subscores,
```

The `return rows.map(...)` line below it needs no change: it spreads `r` and overrides only `scoredAt`.

- [ ] **Step 6: Extend the integration test**

In `backend/test/integration/postings.repository.integration.test.ts`, add this test inside the outermost `describe`. It follows whatever helper the file already uses to insert a posting and a score — read the file's existing tests and reuse their setup rather than inventing new fixtures.

```ts
  it('returns the stored sub-scores on the dashboard row', async () => {
    const rows = await queries.latestScores({ limit: 500 });
    const row = rows.find((r) => r.postingId === seededPostingId);

    expect(row).toBeDefined();
    expect(Object.keys(row!.subscores).sort()).toEqual(
      ['coreStack', 'domain', 'growth', 'logistics', 'seniority'],
    );
    expect(typeof row!.subscores.coreStack.note).toBe('string');
  });
```

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && npm test`
Expected: PASS, no regressions.

Run: `cd backend && npx vitest run test/integration/postings.repository.integration.test.ts`
Expected: PASS if `DATABASE_URL_TEST` is set, otherwise the suite self-skips — which proves nothing. If it skips, say so rather than reporting a pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src/api backend/test/integration
git commit -m "feat(api): expose sub-scores on the postings response"
```

---

## Task 2: Styling foundation — tokens, font, CSS Module typing

**Files:**
- Create: `dashboard/src/styles/tokens.css`
- Modify: `dashboard/src/main.tsx`
- Modify: `dashboard/tsconfig.json`
- Modify: `dashboard/src/api/types.ts`
- Modify: `dashboard/package.json` (dependency)

**Interfaces:**
- Consumes: the `SubScores` shape from Task 1.
- Produces: the CSS custom properties every later task's module consumes, and the `SubScores` / `Dimension` TypeScript types.

- [ ] **Step 1: Install the font package**

```bash
cd dashboard && npm install @fontsource/source-serif-4
```

This self-hosts the font. Do not add a Google Fonts `<link>` — the API binds `127.0.0.1` and the app must work offline.

- [ ] **Step 2: Create the token file**

Create `dashboard/src/styles/tokens.css`:

```css
/* Broadsheet design tokens. This file is the only place in the dashboard that
   may define :root custom properties or style bare element selectors —
   everything else is a CSS Module. Values are copied verbatim from the design
   system; retune here, never in a component. */

@import '@fontsource/source-serif-4/400.css';
@import '@fontsource/source-serif-4/600.css';
@import '@fontsource/source-serif-4/400-italic.css';

:root {
  --color-bg: #f3f2f2;
  --color-surface: #eae9e9;
  --color-text: #201e1d;
  --color-accent: #0088b0;
  --color-accent-2: #d6006c;
  --color-divider: color-mix(in srgb, #201e1d 16%, transparent);

  /* Tonal ramps generated in OKLCH on one shared lightness scale, so the same
     step of any role matches the others in visual value. */
  --color-neutral-100: #f8f4f4;
  --color-neutral-200: #eae7e7;
  --color-neutral-300: #d7d3d3;
  --color-neutral-400: #bab6b6;
  --color-neutral-500: #9b9797;
  --color-neutral-600: #7d7979;
  --color-neutral-700: #605d5d;
  --color-neutral-800: #444141;
  --color-neutral-900: #2d2b2b;

  --color-accent-100: #e9f8ff;
  --color-accent-700: #006786;
  --color-accent-800: #004961;

  --color-accent-2-100: #fff1f4;
  --color-accent-2-700: #aa0b56;
  --color-accent-2-800: #790e3d;
  --color-accent-2-900: #4b1528;

  /* Ink washes. The design expresses secondary text as a percentage of ink on
     paper rather than as a grey, so these are the real vocabulary of the page. */
  --ink-70: rgba(32, 30, 29, 0.7);
  --ink-62: rgba(32, 30, 29, 0.62);
  --ink-55: rgba(32, 30, 29, 0.55);
  --ink-50: rgba(32, 30, 29, 0.5);
  --ink-35: rgba(32, 30, 29, 0.35);
  --ink-20: rgba(32, 30, 29, 0.2);
  --ink-16: rgba(32, 30, 29, 0.16);
  --ink-12: rgba(32, 30, 29, 0.12);
  --ink-10: rgba(32, 30, 29, 0.1);
  --ink-05: rgba(32, 30, 29, 0.05);
  --ink-035: rgba(32, 30, 29, 0.035);

  --font-heading: 'Source Serif 4', system-ui, serif;
  --font-body: 'Source Serif 4', system-ui, serif;
  --font-mono: ui-monospace, Menlo, monospace;

  --space-1: 5px;
  --space-2: 10px;
  --space-3: 15px;
  --space-4: 20px;
  --space-6: 30px;
  --space-8: 40px;

  --radius-sm: 1px;
  --radius-md: 2px;
  --radius-lg: 4px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
}

a { color: var(--color-accent-700); text-underline-offset: 3px; }

:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Point main.tsx at it**

In `dashboard/src/main.tsx`, replace `import './styles.css';` with:

```ts
import './styles/tokens.css';
```

Leave `src/styles.css` on disk for now — components still reference its classes, and it is deleted in Task 12.

- [ ] **Step 4: Teach TypeScript about CSS Modules**

`dashboard/tsconfig.json` declares an explicit `types` array, which suppresses the ambient `*.module.css` declaration Vite ships. Without this change every `import s from './X.module.css'` is a type error. Change the `types` line to:

```json
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
```

- [ ] **Step 5: Mirror the sub-score types**

In `dashboard/src/api/types.ts`, add above `PostingRow`:

```ts
export interface Dimension {
  score: number;
  note: string;
}

export interface SubScores {
  coreStack: Dimension;
  seniority: Dimension;
  domain: Dimension;
  logistics: Dimension;
  growth: Dimension;
}
```

and add one field to `PostingRow`, after `settingsVersion`:

```ts
  subscores: SubScores;
```

- [ ] **Step 6: Verify the build typechecks**

Run: `cd dashboard && npx tsc -b`
Expected: errors in `tests/*.tsx` only, because the existing fixtures do not yet carry `subscores`. That is expected and is fixed in the next step.

- [ ] **Step 7: Add subscores to the existing test fixtures**

Add this constant near the top of `dashboard/tests/App.test.tsx` and `dashboard/tests/PostingsTable.test.tsx`:

```ts
const DIM = { score: 0, note: 'n' };
const SUBSCORES = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};
```

Then add `subscores: SUBSCORES,` to every posting fixture object in both files. (`PostingsTable.test.tsx` is deleted in Task 9; patching it now keeps the suite green in between.)

- [ ] **Step 8: Verify everything is green**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: typecheck clean, all tests PASS. The page now renders in Source Serif on the paper background, unstyled in every other respect.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src dashboard/tests dashboard/tsconfig.json dashboard/package.json dashboard/package-lock.json
git commit -m "feat(dashboard): add Broadsheet tokens, self-hosted font, sub-score types"
```

---

## Task 3: Pure derived values

**Files:**
- Create: `dashboard/src/postings/derive.ts`
- Create: `dashboard/tests/derive.test.ts`

**Interfaces:**
- Consumes: `PostingRow`, `Verdict` from `src/api/types.ts`.
- Produces, in `src/postings/derive.ts`:
  - `HARD_FILTER_PROVIDER = 'hard-filter'`
  - `isHardFiltered(row: PostingRow): boolean`
  - `ruleOf(row: PostingRow): string | null`
  - `rejectionSentence(rule: string): string`
  - `isNearMiss(row: PostingRow): boolean`
  - `nearMissGap(row: PostingRow): number`
  - `isStale(row: PostingRow, currentVersion: number | null): boolean`
  - `pipCount(verdict: Verdict): number`
  - `bandKey(verdict: Verdict): 'strong' | 'maybe' | 'no'`
  - `relativeTime(iso: string, now: Date): string`
  - `interface DayGroup { key: string; label: string; date: string; rows: PostingRow[] }`
  - `groupByDay(rows: PostingRow[], now: Date, descending: boolean): DayGroup[]`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isHardFiltered, ruleOf, rejectionSentence, isNearMiss, nearMissGap,
  isStale, pipCount, bandKey, relativeTime, groupByDay,
} from '../src/postings/derive';
import type { PostingRow } from '../src/api/types';

const DIM = { score: 0, note: 'n' };
const SUBSCORES = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'T', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'ok', providerId: 'anthropic', settingsVersion: '3',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

describe('hard-filtered rows', () => {
  it('identifies a row scored by the hard filter', () => {
    expect(isHardFiltered(row({ providerId: 'hard-filter' }))).toBe(true);
    expect(isHardFiltered(row())).toBe(false);
  });

  it('reads the rule out of the reasoning string', () => {
    expect(ruleOf(row({ providerId: 'hard-filter', reasoning: 'hard-filter:location' })))
      .toBe('location');
  });

  it('returns null for a normally scored row', () => {
    expect(ruleOf(row())).toBeNull();
  });

  it('turns each known rule into a sentence naming when it fired', () => {
    expect(rejectionSentence('location')).toMatch(/excluded location/i);
    expect(rejectionSentence('employment-type')).toMatch(/employment type/i);
    expect(rejectionSentence('salary')).toMatch(/salary/i);
  });

  it('falls back to a sentence naming an unknown rule verbatim', () => {
    expect(rejectionSentence('title-word:php')).toContain('title-word:php');
  });
});

describe('near miss', () => {
  it.each([
    [39, false], [40, true], [49, true], [50, false],
  ])('total %i is a near miss: %s', (total, expected) => {
    expect(isNearMiss(row({ total, verdict: 'NO' }))).toBe(expected);
  });

  it('is never a near miss when the verdict is not NO', () => {
    expect(isNearMiss(row({ total: 45, verdict: 'MAYBE' }))).toBe(false);
  });

  it('reports how far under the MAYBE band it landed', () => {
    expect(nearMissGap(row({ total: 44, verdict: 'NO' }))).toBe(6);
  });
});

describe('stale scores', () => {
  it('is stale when the score predates the current settings version', () => {
    expect(isStale(row({ settingsVersion: '2' }), 3)).toBe(true);
  });

  it('is not stale at the current version', () => {
    expect(isStale(row({ settingsVersion: '3' }), 3)).toBe(false);
  });

  it('is not stale when the current version is unknown', () => {
    expect(isStale(row({ settingsVersion: '2' }), null)).toBe(false);
  });
});

describe('verdict carriers', () => {
  it('fills three, two and one pip', () => {
    expect(pipCount('STRONG')).toBe(3);
    expect(pipCount('MAYBE')).toBe(2);
    expect(pipCount('NO')).toBe(1);
  });

  it('maps a verdict to its ink-weight class key', () => {
    expect(bandKey('STRONG')).toBe('strong');
    expect(bandKey('NO')).toBe('no');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it.each([
    ['2026-08-26T11:58:00.000Z', 'now'],
    ['2026-08-26T11:00:00.000Z', '1h'],
    ['2026-08-26T06:00:00.000Z', '6h'],
    ['2026-08-23T12:00:00.000Z', '3d'],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});

describe('groupByDay', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('labels the buckets Today, Yesterday and N days ago', () => {
    const groups = groupByDay([
      row({ postingId: 'a', scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'b', scoredAt: '2026-08-25T09:00:00.000Z' }),
      row({ postingId: 'c', scoredAt: '2026-08-22T09:00:00.000Z' }),
    ], now, true);

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', '4 days ago']);
  });

  it('sorts by total inside a day, not across days', () => {
    const groups = groupByDay([
      row({ postingId: 'a', total: 40, scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'b', total: 90, scoredAt: '2026-08-25T09:00:00.000Z' }),
      row({ postingId: 'c', total: 70, scoredAt: '2026-08-26T08:00:00.000Z' }),
    ], now, true);

    expect(groups[0]!.rows.map((r) => r.total)).toEqual([70, 40]);
    expect(groups[1]!.rows.map((r) => r.total)).toEqual([90]);
  });

  it('reverses the within-day order when ascending', () => {
    const groups = groupByDay([
      row({ postingId: 'a', total: 40, scoredAt: '2026-08-26T09:00:00.000Z' }),
      row({ postingId: 'c', total: 70, scoredAt: '2026-08-26T08:00:00.000Z' }),
    ], now, false);

    expect(groups[0]!.rows.map((r) => r.total)).toEqual([40, 70]);
  });

  it('buckets by UTC calendar date, not by elapsed hours', () => {
    // 23:30 yesterday is 1.5 hours before 01:00 today, but a different day.
    const groups = groupByDay([
      row({ postingId: 'a', scoredAt: '2026-08-26T01:00:00.000Z' }),
      row({ postingId: 'b', scoredAt: '2026-08-25T23:30:00.000Z' }),
    ], new Date('2026-08-26T02:00:00.000Z'), true);

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('carries the calendar date on each group', () => {
    const groups = groupByDay([row({ scoredAt: '2026-08-26T09:00:00.000Z' })], now, true);
    expect(groups[0]!.date).toBe('26 August');
  });

  it('returns no groups for no rows', () => {
    expect(groupByDay([], now, true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/derive.test.ts`
Expected: FAIL — cannot resolve `../src/postings/derive`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/src/postings/derive.ts`:

```ts
import type { PostingRow, Verdict } from '../api/types';

/** The provider id the pipeline writes for a posting rejected before the model. */
export const HARD_FILTER_PROVIDER = 'hard-filter';

/** The bottom of the MAYBE band. Mirrors toVerdict() in the backend. */
const MAYBE_FLOOR = 50;
const NEAR_MISS_FLOOR = 40;

export function isHardFiltered(row: PostingRow): boolean {
  return row.providerId === HARD_FILTER_PROVIDER;
}

export function ruleOf(row: PostingRow): string | null {
  if (!isHardFiltered(row)) return null;
  const prefix = `${HARD_FILTER_PROVIDER}:`;
  return row.reasoning.startsWith(prefix) ? row.reasoning.slice(prefix.length) : null;
}

/**
 * Machine rule strings never reach the screen. The three cases are every rule
 * applyHardFilters can currently produce; the fallback exists so a rule added
 * later degrades to a readable sentence instead of leaking `hard-filter:x`.
 */
export function rejectionSentence(rule: string): string {
  switch (rule) {
    case 'location':
      return 'Rejected before scoring: its location matches one of your excluded locations.';
    case 'employment-type':
      return 'Rejected before scoring: its employment type is not one you allow.';
    case 'salary':
      return 'Rejected before scoring: the salary it states is below your minimum.';
    default:
      return `Rejected before scoring by the rule ${rule}.`;
  }
}

export function isNearMiss(row: PostingRow): boolean {
  return row.verdict === 'NO'
    && row.total >= NEAR_MISS_FLOOR
    && row.total < MAYBE_FLOOR;
}

export function nearMissGap(row: PostingRow): number {
  return MAYBE_FLOOR - row.total;
}

export function isStale(row: PostingRow, currentVersion: number | null): boolean {
  if (currentVersion === null) return false;
  return Number(row.settingsVersion) !== currentVersion;
}

export function pipCount(verdict: Verdict): number {
  return verdict === 'STRONG' ? 3 : verdict === 'MAYBE' ? 2 : 1;
}

export function bandKey(verdict: Verdict): 'strong' | 'maybe' | 'no' {
  return verdict === 'STRONG' ? 'strong' : verdict === 'MAYBE' ? 'maybe' : 'no';
}

export function relativeTime(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 5) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface DayGroup {
  /** The UTC calendar date, yyyy-mm-dd. Stable React key. */
  key: string;
  /** Today / Yesterday / N days ago. */
  label: string;
  /** The date spelled out, e.g. "26 August". */
  date: string;
  rows: PostingRow[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** yyyy-mm-dd in UTC. Bucketing on the calendar date, not on elapsed hours, is
 *  what makes "Today" mean today rather than "within 24 hours". */
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayLabel(key: string, now: Date): string {
  const todayKey = utcDateKey(now);
  if (key === todayKey) return 'Today';

  const days = Math.round(
    (Date.parse(`${todayKey}T00:00:00.000Z`) - Date.parse(`${key}T00:00:00.000Z`)) / 86_400_000,
  );
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

function spelledDate(key: string): string {
  const [, month, day] = key.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

export function groupByDay(
  rows: PostingRow[], now: Date, descending: boolean,
): DayGroup[] {
  const buckets = new Map<string, PostingRow[]>();
  for (const row of rows) {
    const key = utcDateKey(new Date(row.scoredAt));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({
      key,
      label: dayLabel(key, now),
      date: spelledDate(key),
      rows: [...buckets.get(key)!].sort(
        (a, b) => (descending ? b.total - a.total : a.total - b.total),
      ),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/derive.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/postings dashboard/tests/derive.test.ts
git commit -m "feat(dashboard): extract pure derived values for the postings feed"
```

---

## Task 4: URL-backed filter state

**Files:**
- Create: `dashboard/src/api/filters-url.ts`
- Create: `dashboard/tests/filters-url.test.ts`

**Interfaces:**
- Consumes: `PostingFilters`, `Verdict` from `src/api/types.ts`.
- Produces, in `src/api/filters-url.ts`:
  - `type SinceWindow = 'any' | '24h' | '7d' | '30d'`
  - `interface UiFilters { verdict: Verdict | 'any'; source: string; provider: string; minTotal: number; since: SinceWindow; sort: 'asc' | 'desc'; showRejected: boolean }`
  - `const DEFAULT_FILTERS: UiFilters`
  - `parseFilters(params: URLSearchParams): UiFilters`
  - `toSearchParams(ui: UiFilters): URLSearchParams`
  - `toApiFilters(ui: UiFilters, now: Date): PostingFilters`

Note for the implementer: the URL stores the **window token** (`since=7d`), never a computed date. A bookmarked URL must stay relative — `since=2026-08-19` would silently freeze as the bookmark ages.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/filters-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS, parseFilters, toSearchParams, toApiFilters,
  type UiFilters,
} from '../src/api/filters-url';

describe('parseFilters', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parseFilters(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS);
  });

  it('reads every supported parameter', () => {
    const ui = parseFilters(new URLSearchParams(
      'verdict=STRONG&source=djinni&provider=anthropic&minTotal=60&since=7d&sort=asc&rejected=1',
    ));

    expect(ui).toEqual({
      verdict: 'STRONG', source: 'djinni', provider: 'anthropic',
      minTotal: 60, since: '7d', sort: 'asc', showRejected: true,
    });
  });

  it('ignores an unknown verdict rather than throwing', () => {
    expect(parseFilters(new URLSearchParams('verdict=BANANA')).verdict).toBe('any');
  });

  it('ignores an unknown since window', () => {
    expect(parseFilters(new URLSearchParams('since=fortnight')).since).toBe('any');
  });

  it('clamps a min score outside 0-100', () => {
    expect(parseFilters(new URLSearchParams('minTotal=999')).minTotal).toBe(100);
    expect(parseFilters(new URLSearchParams('minTotal=-5')).minTotal).toBe(0);
  });

  it('ignores a non-numeric min score', () => {
    expect(parseFilters(new URLSearchParams('minTotal=lots')).minTotal).toBe(0);
  });
});

describe('toSearchParams', () => {
  it('omits every value that is at its default', () => {
    expect(toSearchParams(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('serialises only what differs from the default', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, verdict: 'MAYBE', minTotal: 50 };
    expect(toSearchParams(ui).toString()).toBe('verdict=MAYBE&minTotal=50');
  });

  it('round-trips any filter set', () => {
    const ui: UiFilters = {
      verdict: 'NO', source: 'dou', provider: 'hard-filter',
      minTotal: 25, since: '30d', sort: 'asc', showRejected: true,
    };
    expect(parseFilters(toSearchParams(ui))).toEqual(ui);
  });
});

describe('toApiFilters', () => {
  const now = new Date('2026-08-26T12:00:00.000Z');

  it('drops the UI-only keys and the "any" sentinels', () => {
    expect(toApiFilters(DEFAULT_FILTERS, now)).toEqual({ limit: 500 });
  });

  it('turns a since window into a concrete date', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, since: '7d' };
    expect(toApiFilters(ui, now).since).toBe('2026-08-19');
  });

  it('passes through the real filters', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, verdict: 'STRONG', source: 'djinni', minTotal: 70 };
    expect(toApiFilters(ui, now)).toEqual({
      verdict: 'STRONG', source: 'djinni', minTotal: 70, limit: 500,
    });
  });

  it('never sends sort or rejected to the API', () => {
    const ui: UiFilters = { ...DEFAULT_FILTERS, sort: 'asc', showRejected: true };
    expect(Object.keys(toApiFilters(ui, now))).toEqual(['limit']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/filters-url.test.ts`
Expected: FAIL — cannot resolve `../src/api/filters-url`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/src/api/filters-url.ts`:

```ts
import type { PostingFilters, Verdict } from './types';

export type SinceWindow = 'any' | '24h' | '7d' | '30d';

const VERDICTS: Verdict[] = ['STRONG', 'MAYBE', 'NO'];
const WINDOWS: SinceWindow[] = ['any', '24h', '7d', '30d'];
const WINDOW_DAYS: Record<Exclude<SinceWindow, 'any'>, number> = {
  '24h': 1, '7d': 7, '30d': 30,
};

export interface UiFilters {
  verdict: Verdict | 'any';
  source: string;
  provider: string;
  minTotal: number;
  since: SinceWindow;
  /** UI only — the API always sorts by total descending. */
  sort: 'asc' | 'desc';
  /** UI only — rejected rows are split out client-side. */
  showRejected: boolean;
}

export const DEFAULT_FILTERS: UiFilters = {
  verdict: 'any', source: 'any', provider: 'any',
  minTotal: 0, since: 'any', sort: 'desc', showRejected: false,
};

/**
 * A hand-edited or stale URL degrades to defaults rather than erroring. The
 * backend's PostingFiltersSchema remains the real validator; this only has to
 * avoid putting nonsense on screen.
 */
export function parseFilters(params: URLSearchParams): UiFilters {
  const verdict = params.get('verdict');
  const since = params.get('since');
  const minTotal = Number(params.get('minTotal'));

  return {
    verdict: VERDICTS.includes(verdict as Verdict) ? verdict as Verdict : 'any',
    source: params.get('source') || 'any',
    provider: params.get('provider') || 'any',
    minTotal: Number.isFinite(minTotal) ? Math.min(100, Math.max(0, Math.trunc(minTotal))) : 0,
    since: WINDOWS.includes(since as SinceWindow) ? since as SinceWindow : 'any',
    sort: params.get('sort') === 'asc' ? 'asc' : 'desc',
    showRejected: params.get('rejected') === '1',
  };
}

/** Defaults are omitted, so the resting URL is a bare `/`. */
export function toSearchParams(ui: UiFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (ui.verdict !== 'any') params.set('verdict', ui.verdict);
  if (ui.source !== 'any') params.set('source', ui.source);
  if (ui.provider !== 'any') params.set('provider', ui.provider);
  if (ui.minTotal !== 0) params.set('minTotal', String(ui.minTotal));
  if (ui.since !== 'any') params.set('since', ui.since);
  if (ui.sort !== 'desc') params.set('sort', ui.sort);
  if (ui.showRejected) params.set('rejected', '1');
  return params;
}

/**
 * The URL carries the window token, not a date, so a bookmark stays relative.
 * The date is computed at request time instead.
 */
export function toApiFilters(ui: UiFilters, now: Date): PostingFilters {
  const filters: PostingFilters = { limit: 500 };
  if (ui.verdict !== 'any') filters.verdict = ui.verdict;
  if (ui.source !== 'any') filters.source = ui.source;
  if (ui.provider !== 'any') filters.provider = ui.provider;
  if (ui.minTotal !== 0) filters.minTotal = ui.minTotal;
  if (ui.since !== 'any') {
    const days = WINDOW_DAYS[ui.since];
    filters.since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  }
  return filters;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/filters-url.test.ts`
Expected: PASS.

Note: the `toApiFilters` key-order assertion in the last test depends on insertion order — `limit` is set first, so `Object.keys` yields `['limit']`. Keep `limit` as the first assignment.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/api/filters-url.ts dashboard/tests/filters-url.test.ts
git commit -m "feat(dashboard): serialise postings filters to the query string"
```

---

## Task 5: Routing shell

**Files:**
- Modify: `dashboard/src/main.tsx`
- Rewrite: `dashboard/src/App.tsx`
- Create: `dashboard/src/context/DashboardData.tsx`
- Create: `dashboard/src/pages/PostingsPage.tsx`
- Move: `dashboard/src/components/SettingsPage.tsx` → `dashboard/src/pages/SettingsPage.tsx`
- Modify: `dashboard/tests/App.test.tsx`
- Modify: `dashboard/tests/SettingsPage.test.tsx` (import path only)
- Modify: `dashboard/package.json`

**Interfaces:**
- Consumes: `parseFilters`, `toApiFilters` from Task 4.
- Produces:
  - `src/context/DashboardData.tsx` exports `interface DashboardData { postings: ApiState<PostingRow[]>; health: ApiState<HealthRow[]>; settings: ApiState<SettingsResponse>; ui: UiFilters; setUi: (next: UiFilters) => void }`, `DashboardDataProvider`, and `useDashboardData(): DashboardData`.
  - Tasks 6–11 call `useDashboardData()` rather than taking props for shared state.

This task lands routing with the **existing** Postings components still in place. The screen looks unchanged; only its URL behaviour changes. Later tasks replace the components one at a time.

- [ ] **Step 1: Install the router**

```bash
cd dashboard && npm install react-router-dom
```

- [ ] **Step 2: Write the failing test**

Replace the `describe('tab navigation', ...)` block in `dashboard/tests/App.test.tsx` with the block below, and change every `render(<App />)` in the file to `renderAt('/')`. Add this helper above the first `describe`:

```ts
import { MemoryRouter } from 'react-router-dom';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
```

```ts
describe('routing', () => {
  beforeEach(() => { stubFetch(); });

  it('renders postings at the root path', async () => {
    renderAt('/');
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('renders settings at /settings without a click', async () => {
    renderAt('/settings');
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /save rubric/i })).toBeInTheDocument());
  });

  it('navigates between the two routes', async () => {
    renderAt('/');
    await userEvent.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /postings/i }));
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('redirects an unknown path to postings', async () => {
    renderAt('/nowhere');
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('applies a filter taken from the initial query string', async () => {
    const fetchMock = stubFetch();
    renderAt('/?verdict=MAYBE');

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=MAYBE'))).toBe(true);
    });
  });
});
```

Also update the two banner tests that click "Finish setup": the assertion stays the same, since the banner still lands on the Settings tab.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/App.test.tsx`
Expected: FAIL — `App` renders its own tab state and ignores the route.

- [ ] **Step 4: Create the context**

Create `dashboard/src/context/DashboardData.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiState } from '../hooks/useApi';
import type { HealthRow, PostingRow, SettingsResponse } from '../api/types';
import type { UiFilters } from '../api/filters-url';

export interface DashboardData {
  postings: ApiState<PostingRow[]>;
  health: ApiState<HealthRow[]>;
  settings: ApiState<SettingsResponse>;
  ui: UiFilters;
  setUi: (next: UiFilters) => void;
}

const Context = createContext<DashboardData | null>(null);

export function DashboardDataProvider(
  { value, children }: { value: DashboardData; children: ReactNode },
) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * A context rather than <Outlet context> so a component test can wrap one
 * component in a provider instead of standing up a whole router.
 */
export function useDashboardData(): DashboardData {
  const value = useContext(Context);
  if (!value) throw new Error('useDashboardData used outside DashboardDataProvider');
  return value;
}
```

- [ ] **Step 5: Rewrite App as the layout**

Replace `dashboard/src/App.tsx` entirely:

```tsx
import { useCallback, useMemo } from 'react';
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { fetchHealth, fetchPostings } from './api/client';
import { fetchSettings } from './api/settings';
import { useApi } from './hooks/useApi';
import { DEFAULT_FILTERS, parseFilters, toApiFilters, toSearchParams, type UiFilters } from './api/filters-url';
import { DashboardDataProvider } from './context/DashboardData';
import { PostingsPage } from './pages/PostingsPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [params, setParams] = useSearchParams();

  const ui = useMemo(() => parseFilters(params), [params]);
  const setUi = useCallback(
    (next: UiFilters) => setParams(toSearchParams(next)),
    [setParams],
  );

  // The query string is the single source of truth, so the fetch key is its
  // serialised form — a new object identity each render would otherwise
  // retrigger the effect forever.
  const apiFilters = useMemo(() => toApiFilters(ui, new Date()), [ui]);
  const fetchKey = useMemo(() => JSON.stringify(apiFilters), [apiFilters]);

  const postings = useApi(() => fetchPostings(apiFilters), [fetchKey]);
  const health = useApi(() => fetchHealth());
  // Owned here, not in SettingsPage: the stale-score badge on Postings needs
  // the current version, so a save in Settings has to be visible without a
  // reload. Keeping all three here also means switching routes never refetches.
  const settings = useApi(() => fetchSettings());

  return (
    <DashboardDataProvider value={{ postings, health, settings, ui, setUi }}>
      <h1>JobRadar</h1>

      <nav className="tabs" role="tablist">
        <NavLink to="/" end className="tab" role="tab">
          {({ isActive }) => <span aria-selected={isActive}>Postings</span>}
        </NavLink>
        <NavLink to="/settings" className="tab" role="tab">
          {({ isActive }) => <span aria-selected={isActive}>Settings</span>}
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<PostingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardDataProvider>
  );
}
```

**Correction to the markup above before you write it:** a render-prop `NavLink` puts `aria-selected` on an inner `<span>`, so `getByRole('tab')` finds the link but the attribute sits on its child and the test fails. Write the tabs like this instead:

```tsx
      <nav className="tabs" role="tablist">
        <NavLink to="/" end role="tab" className={({ isActive }) => isActive ? 'tab tab-active' : 'tab'}>
          Postings
        </NavLink>
        <NavLink to="/settings" role="tab" className={({ isActive }) => isActive ? 'tab tab-active' : 'tab'}>
          Settings
        </NavLink>
      </nav>
```

and set `aria-selected` from the route by reading `useLocation()` once in `App`:

```tsx
  const { pathname } = useLocation();
  const onSettings = pathname.startsWith('/settings');
```

then pass `aria-selected={!onSettings}` and `aria-selected={onSettings}` to the two `NavLink`s respectively. Import `useLocation` alongside `NavLink`.

- [ ] **Step 6: Move SettingsPage and drop its prop**

```bash
cd dashboard && git mv src/components/SettingsPage.tsx src/pages/SettingsPage.tsx
```

Change its signature from taking a `settings` prop to reading the context. Replace the `interface Props` block and the function signature with:

```tsx
import { useDashboardData } from '../context/DashboardData';

export function SettingsPage() {
  const { settings } = useDashboardData();
```

Fix the four relative imports it now needs one level up (`../api/settings`, `../api/types`, `../hooks/useApi`) and the four component imports (`../components/DocumentEditor`, etc.). The body — including the `settings.error` / `!settings.data` gates and their comments — is unchanged.

- [ ] **Step 7: Create the Postings page**

Create `dashboard/src/pages/PostingsPage.tsx`. This is the temporary composition using today's components; Tasks 6–11 replace its innards.

```tsx
import { useDashboardData } from '../context/DashboardData';
import { Filters } from '../components/Filters';
import { PostingsTable } from '../components/PostingsTable';
import { SourceHealth } from '../components/SourceHealth';

export function PostingsPage() {
  const { postings, health, settings } = useDashboardData();

  return (
    <>
      <Filters rows={postings.data ?? []} />

      {postings.loading && <p className="state">Loading…</p>}
      {postings.error && <p className="state" role="alert">Error: {postings.error}</p>}
      {!postings.loading && !postings.error && (
        <PostingsTable
          rows={postings.data ?? []}
          currentVersion={settings.data?.version ?? null}
        />
      )}

      <SourceHealth rows={health.data ?? []} />
    </>
  );
}
```

- [ ] **Step 8: Adapt the old Filters component to the context**

`src/components/Filters.tsx` currently takes `value` and `onChange`. Change its props to `{ rows }` only and have it read `const { ui, setUi } = useDashboardData();`. Map its five controls onto `UiFilters` fields: `verdict` uses `'any'` instead of `''`, `since` becomes a `<select>` over `any / 24h / 7d / 30d` with labels "any time", "last 24 hours", "last 7 days", "last 30 days". This component is thrown away in Task 7 — do the minimum that keeps the existing App tests passing.

- [ ] **Step 9: Move the banner into the layout**

Keep the `settingsError` banner in `App`, above `<Routes>`, exactly as it reads today. Replace its `<button onClick={() => setTab('settings')}>` with `useNavigate()`:

```tsx
  const navigate = useNavigate();
  ...
        <button type="button" onClick={() => navigate('/settings')}>Finish setup</button>
```

- [ ] **Step 10: Mount BrowserRouter**

In `dashboard/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles/tokens.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </StrictMode>,
);
```

`App` itself must **not** contain a router — the tests supply `MemoryRouter`.

- [ ] **Step 11: Fix the SettingsPage test import**

In `dashboard/tests/SettingsPage.test.tsx`, change the import to `../src/pages/SettingsPage` and wrap the rendered component in a `DashboardDataProvider` supplying a stub `settings` `ApiState` plus `DEFAULT_FILTERS` and a no-op `setUi`. Read the existing test to see what shape it passed as the `settings` prop and pass the same object through the provider.

- [ ] **Step 12: Run the full dashboard suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS. Routing works, the screen is otherwise unchanged, and `/?verdict=MAYBE` filters on load.

- [ ] **Step 13: Commit**

```bash
git add dashboard/src dashboard/tests dashboard/package.json dashboard/package-lock.json
git commit -m "feat(dashboard): route postings and settings, drive filters from the URL"
```

---

## Task 6: Masthead and setup banner

**Files:**
- Create: `dashboard/src/components/Masthead.tsx`, `Masthead.module.css`
- Create: `dashboard/src/components/SetupBanner.tsx`, `SetupBanner.module.css`
- Modify: `dashboard/src/App.tsx`
- Create: `dashboard/tests/Masthead.test.tsx`

**Interfaces:**
- Consumes: `useDashboardData` (Task 5), `groupByDay` (Task 3).
- Produces: `<Masthead runAt={string | null} newCount={number} scoredCount={number} version={number | null} />` and `<SetupBanner message={string} />`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/Masthead.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Masthead } from '../src/components/Masthead';
import { SetupBanner } from '../src/components/SetupBanner';

function renderMasthead(props: Partial<Parameters<typeof Masthead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <Masthead
        runAt="2026-08-26T06:12:00.000Z" newCount={4} scoredCount={128}
        version={12} {...props}
      />
    </MemoryRouter>,
  );
}

describe('Masthead', () => {
  it('names both sections as tabs', () => {
    renderMasthead();
    expect(screen.getByRole('tab', { name: /postings/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('marks the current route as the selected tab', () => {
    renderMasthead();
    expect(screen.getByRole('tab', { name: /postings/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /settings/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('states the run, the new count and the settings version', () => {
    renderMasthead();
    expect(screen.getByText(/4 new/i)).toBeInTheDocument();
    expect(screen.getByText(/128 scored/i)).toBeInTheDocument();
    expect(screen.getByText(/v12/i)).toBeInTheDocument();
  });

  it('says so when nothing has run yet', () => {
    renderMasthead({ runAt: null });
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });
});

describe('SetupBanner', () => {
  it('is an alert naming the reason and linking to settings', () => {
    render(<MemoryRouter><SetupBanner message="settings incomplete: no CV" /></MemoryRouter>);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/no CV/);
    expect(screen.getByRole('link', { name: /finish setup/i })).toHaveAttribute('href', '/settings');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/Masthead.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write Masthead.module.css**

Create `dashboard/src/components/Masthead.module.css`:

```css
.masthead { padding: 22px 34px 0; }

.top {
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
}

.wordmark {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.02em;
}

.tagline {
  font-size: 11px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-50);
}

.tabs {
  margin-left: auto;
  display: flex;
  gap: 20px;
}

.tab {
  font-size: 15px;
  padding-bottom: 5px;
  border-bottom: 2px solid transparent;
  color: var(--ink-62);
  text-decoration: none;
}

.tabActive {
  border-bottom-color: var(--color-accent);
  color: var(--color-text);
}

.ruleThick { height: 3px; background: var(--color-text); margin-top: 12px; }
.ruleThin { height: 1px; background: var(--color-text); }

.status {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 6px 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-62);
}

@media (max-width: 820px) {
  .masthead { padding: 16px 18px 0; }
  .tagline { display: none; }
}
```

- [ ] **Step 4: Write Masthead.tsx**

```tsx
import { NavLink, useLocation } from 'react-router-dom';
import s from './Masthead.module.css';

interface Props {
  runAt: string | null;
  newCount: number;
  scoredCount: number;
  version: number | null;
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function Masthead({ runAt, newCount, scoredCount, version }: Props) {
  const onSettings = useLocation().pathname.startsWith('/settings');

  return (
    <header className={s.masthead}>
      <div className={s.top}>
        <div className={s.wordmark}>JobRadar</div>
        <div className={s.tagline}>Stop scrolling job boards. Read the shortlist.</div>

        <div className={s.tabs} role="tablist" aria-label="Sections">
          <NavLink
            to="/" end role="tab" aria-selected={!onSettings}
            className={({ isActive }) => isActive ? `${s.tab} ${s.tabActive}` : s.tab}
          >
            Postings
          </NavLink>
          <NavLink
            to="/settings" role="tab" aria-selected={onSettings}
            className={({ isActive }) => isActive ? `${s.tab} ${s.tabActive}` : s.tab}
          >
            Settings
          </NavLink>
        </div>
      </div>

      <div className={s.ruleThick} />
      <div className={s.status}>
        <span>{DATE_FMT.format(new Date())}</span>
        <span>
          {runAt ? `Run ${TIME_FMT.format(new Date(runAt))}` : 'No run yet'}
          {' · '}{newCount} new · {scoredCount} scored
        </span>
        <span>{version === null ? 'Settings unread' : `Scoring settings v${version}`}</span>
      </div>
      <div className={s.ruleThin} />
    </header>
  );
}
```

- [ ] **Step 5: Write SetupBanner.module.css**

```css
.banner {
  margin: 22px 34px 0;
  padding: 16px 18px;
  background: var(--color-accent-2-100);
  display: flex;
  gap: 18px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.label {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.14em;
  color: var(--color-accent-2-800);
  padding-top: 2px;
}

.body { flex: 1; min-width: 220px; }

.headline {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 19px;
  margin-bottom: 4px;
}

.reason {
  font-size: 14px;
  line-height: 1.5;
  max-width: 62ch;
  text-wrap: pretty;
}

.action {
  align-self: center;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 15px;
  color: var(--color-accent-2-800);
}
```

- [ ] **Step 6: Write SetupBanner.tsx**

```tsx
import { Link } from 'react-router-dom';
import s from './SetupBanner.module.css';

export function SetupBanner({ message }: { message: string }) {
  return (
    <div className={s.banner} role="alert">
      <div className={s.label}>SET UP</div>
      <div className={s.body}>
        <div className={s.headline}>The last run could not score anything.</div>
        <p className={s.reason}>
          {message}. Until that is fixed the radar polls nothing and this list stays empty.
        </p>
      </div>
      <Link to="/settings" className={s.action}>Finish setup →</Link>
    </div>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/Masthead.test.tsx`
Expected: PASS.

- [ ] **Step 8: Use them in App**

In `App.tsx`, delete the `<h1>JobRadar</h1>`, the inline `<nav className="tabs">`, and the inline banner JSX. Replace with:

```tsx
      <Masthead
        runAt={health.data?.[0]?.ranAt ?? null}
        newCount={newCount}
        scoredCount={postings.data?.length ?? 0}
        version={settings.data?.version ?? null}
      />

      {settingsError && (
        <SetupBanner message={settingsError.error ?? 'the last run could not read its settings'} />
      )}
```

`newCount` is derived from the **same** day bucket the feed uses, so the two cannot disagree:

```tsx
  const newCount = useMemo(() => {
    const groups = groupByDay(postings.data ?? [], new Date(), true);
    return groups[0]?.label === 'Today' ? groups[0].rows.length : 0;
  }, [postings.data]);
```

`health.data` is ordered newest-first by `sourceHealth()`, so `[0].ranAt` is the last run.

- [ ] **Step 9: Update the App tests for the new banner**

The banner is now `role="alert"` with a link, not `role="status"` with a button. In `tests/App.test.tsx`, change the four assertions that use `findByRole('status')` to `findByRole('alert')`, and change the "links the banner" test to assert the link's `href` rather than clicking a button:

```ts
    expect(await screen.findByRole('link', { name: /finish setup/i }))
      .toHaveAttribute('href', '/settings');
```

Note the postings-error path also renders `role="alert"`; those tests stub a successful postings fetch, so there is exactly one alert.

- [ ] **Step 10: Run the full suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src dashboard/tests
git commit -m "feat(dashboard): masthead and setup banner in the Broadsheet style"
```

---

## Task 7: The filter bar

**Files:**
- Create: `dashboard/src/components/postings/Filters.tsx`, `Filters.module.css`
- Delete: `dashboard/src/components/Filters.tsx`
- Modify: `dashboard/src/pages/PostingsPage.tsx`
- Create: `dashboard/tests/Filters.test.tsx`

**Interfaces:**
- Consumes: `useDashboardData`, `UiFilters`, `SinceWindow`.
- Produces: `<Filters rows={PostingRow[]} resultCount={number} />` — `rows` supplies the source and provider option lists.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/Filters.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Filters } from '../src/components/postings/Filters';
import { DashboardDataProvider, type DashboardData } from '../src/context/DashboardData';
import { DEFAULT_FILTERS, type UiFilters } from '../src/api/filters-url';
import type { PostingRow } from '../src/api/types';

const DIM = { score: 0, note: 'n' };
const SUBSCORES = { coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM };

const rows: PostingRow[] = [
  {
    postingId: 'x:1', title: 'A', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: null, total: 80, verdict: 'STRONG',
    reasoning: 'r', providerId: 'anthropic', settingsVersion: '1',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES,
  },
  {
    postingId: 'x:2', title: 'B', company: 'D', url: 'https://e.com/2',
    source: 'dou', location: null, total: 40, verdict: 'NO',
    reasoning: 'r', providerId: 'openai', settingsVersion: '1',
    scoredAt: '2026-08-26T10:00:00.000Z', subscores: SUBSCORES,
  },
];

const emptyState = { data: null, error: null, loading: false, reload: () => {} };

function renderFilters(ui: UiFilters = DEFAULT_FILTERS) {
  const setUi = vi.fn();
  const value = {
    postings: emptyState, health: emptyState, settings: emptyState, ui, setUi,
  } as unknown as DashboardData;

  render(
    <DashboardDataProvider value={value}>
      <Filters rows={rows} resultCount={2} />
    </DashboardDataProvider>,
  );
  return setUi;
}

describe('Filters', () => {
  it('offers Any plus the three verdicts as pressable buttons', () => {
    renderFilters();
    for (const name of ['any', 'strong', 'maybe', 'no']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the active verdict as pressed', () => {
    renderFilters({ ...DEFAULT_FILTERS, verdict: 'MAYBE' });
    expect(screen.getByRole('button', { name: /^maybe$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^any$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('publishes a verdict choice', async () => {
    const setUi = renderFilters();
    await userEvent.click(screen.getByRole('button', { name: /^strong$/i }));
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, verdict: 'STRONG' });
  });

  it('lists the sources present in the rows', () => {
    renderFilters();
    const select = screen.getByLabelText(/source/i);
    expect(within(select).getByRole('option', { name: 'djinni' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'dou' })).toBeInTheDocument();
  });

  it('publishes a source choice', async () => {
    const setUi = renderFilters();
    await userEvent.selectOptions(screen.getByLabelText(/source/i), 'dou');
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, source: 'dou' });
  });

  it('does not publish while the score slider is being dragged', async () => {
    const setUi = renderFilters();
    const slider = screen.getByLabelText(/minimum score/i);

    fireEvent.input(slider, { target: { value: '40' } });
    expect(setUi).not.toHaveBeenCalled();

    fireEvent.blur(slider);
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, minTotal: 40 });
  });

  it('shows the live slider value while dragging', async () => {
    renderFilters();
    fireEvent.input(screen.getByLabelText(/minimum score/i), { target: { value: '65' } });
    expect(screen.getByText(/min score 65/i)).toBeInTheDocument();
  });

  it('reports the result count and toggles the sort', async () => {
    const setUi = renderFilters();
    expect(screen.getByText(/2 postings/i)).toBeInTheDocument();

    const sort = screen.getByRole('button', { name: /score/i });
    expect(sort).toHaveAttribute('aria-sort', 'descending');
    await userEvent.click(sort);
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, sort: 'asc' });
  });
});
```

Add `fireEvent` and `within` to the Testing Library import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/Filters.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write Filters.module.css**

```css
.bar {
  display: flex;
  align-items: flex-end;
  gap: 26px;
  padding: 18px 0 14px;
  flex-wrap: wrap;
}

.group { display: flex; flex-direction: column; }

.label {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-50);
  margin-bottom: 6px;
}

.segmented {
  display: flex;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.segment {
  appearance: none;
  background: none;
  border: 0;
  border-left: 1px solid var(--color-divider);
  padding: 6px 13px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-70);
  cursor: pointer;
}

.segment:first-child { border-left: 0; }
.segmentOn { background: var(--color-text); color: var(--color-bg); }

.select {
  min-height: 31px;
  padding: 4px 8px;
  font: inherit;
  font-size: 13px;
  background: var(--color-bg);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
}

.slider { width: 150px; height: 31px; accent-color: var(--color-accent); }

.tail {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.count { font-size: 12.5px; color: var(--ink-55); }

.sort {
  appearance: none;
  background: none;
  border: 0;
  padding: 0 0 1px;
  font: inherit;
  font-size: 13px;
  color: var(--color-accent-700);
  border-bottom: 1px solid currentColor;
  cursor: pointer;
}

.rule { height: 1px; background: var(--ink-35); }

@media (max-width: 820px) {
  .bar { gap: 16px; }
  .tail { margin-left: 0; }
}
```

- [ ] **Step 4: Write Filters.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useDashboardData } from '../../context/DashboardData';
import type { SinceWindow } from '../../api/filters-url';
import type { PostingRow, Verdict } from '../../api/types';
import s from './Filters.module.css';

const VERDICT_OPTIONS: Array<{ value: Verdict | 'any'; label: string }> = [
  { value: 'any', label: 'Any' },
  { value: 'STRONG', label: 'Strong' },
  { value: 'MAYBE', label: 'Maybe' },
  { value: 'NO', label: 'No' },
];

const SINCE_OPTIONS: Array<{ value: SinceWindow; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export function Filters({ rows, resultCount }: { rows: PostingRow[]; resultCount: number }) {
  const { ui, setUi } = useDashboardData();

  // The slider commits on release, not on every input event: a range input
  // fires per pixel of drag, and each commit would push a history entry.
  const [draftScore, setDraftScore] = useState(ui.minTotal);
  useEffect(() => { setDraftScore(ui.minTotal); }, [ui.minTotal]);

  const sources = [...new Set(rows.map((r) => r.source))].sort();
  const providers = [...new Set(rows.map((r) => r.providerId))].sort();

  return (
    <>
      <div className={s.bar}>
        <div className={s.group}>
          <div className={s.label}>Verdict</div>
          <div className={s.segmented}>
            {VERDICT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={ui.verdict === o.value}
                className={ui.verdict === o.value ? `${s.segment} ${s.segmentOn}` : s.segment}
                onClick={() => setUi({ ...ui, verdict: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-source">Source</label>
          <select
            id="filter-source" className={s.select} value={ui.source}
            onChange={(e) => setUi({ ...ui, source: e.target.value })}
          >
            <option value="any">Any source</option>
            {sources.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-provider">Provider</label>
          <select
            id="filter-provider" className={s.select} value={ui.provider}
            onChange={(e) => setUi({ ...ui, provider: e.target.value })}
          >
            <option value="any">Any provider</option>
            {providers.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-score">Min score {draftScore}</label>
          <input
            id="filter-score" className={s.slider} type="range"
            min={0} max={100} step={5} value={draftScore}
            aria-label="Minimum score"
            onChange={(e) => setDraftScore(Number(e.target.value))}
            onBlur={() => setUi({ ...ui, minTotal: draftScore })}
            onPointerUp={() => setUi({ ...ui, minTotal: draftScore })}
            onKeyUp={() => setUi({ ...ui, minTotal: draftScore })}
          />
        </div>

        <div className={s.group}>
          <label className={s.label} htmlFor="filter-since">Scored since</label>
          <select
            id="filter-since" className={s.select} value={ui.since}
            onChange={(e) => setUi({ ...ui, since: e.target.value as SinceWindow })}
          >
            {SINCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className={s.tail}>
          <div className={s.count}>{resultCount} postings</div>
          <button
            type="button" className={s.sort}
            aria-sort={ui.sort === 'desc' ? 'descending' : 'ascending'}
            onClick={() => setUi({ ...ui, sort: ui.sort === 'desc' ? 'asc' : 'desc' })}
          >
            Score {ui.sort === 'desc' ? '▼' : '▲'}
          </button>
        </div>
      </div>

      <div className={s.rule} />
    </>
  );
}
```

The `<label className={s.label} htmlFor=...>` pairs are what make `getByLabelText(/source/i)` work; do not replace them with plain `<div>`s.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/Filters.test.tsx`
Expected: PASS.

- [ ] **Step 6: Swap it into the page and delete the old one**

In `PostingsPage.tsx`, change the import to `../components/postings/Filters` and pass `resultCount={postings.data?.length ?? 0}`. Then:

```bash
cd dashboard && git rm src/components/Filters.tsx
```

The old App test "refetches with a verdict filter in the query string" used `selectOptions` on a `<select>`; change it to click the Strong button and assert the URL query:

```ts
    await userEvent.click(screen.getByRole('button', { name: /^strong$/i }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('verdict=STRONG'))).toBe(true);
    });
```

- [ ] **Step 7: Run the full suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src dashboard/tests
git commit -m "feat(dashboard): rebuild the postings filter bar"
```

---

## Task 8: The ledger row and its breakdown

**Files:**
- Create: `dashboard/src/components/postings/ScoreBreakdown.tsx`, `ScoreBreakdown.module.css`
- Create: `dashboard/src/components/postings/LedgerRow.tsx`, `LedgerRow.module.css`
- Create: `dashboard/tests/LedgerRow.test.tsx`

**Interfaces:**
- Consumes: everything from `derive.ts` (Task 3), `SubScores` and `RubricWeights` types.
- Produces:
  - `<ScoreBreakdown subscores={SubScores} weights={RubricWeights} total={number} stale={boolean} />`
  - `<LedgerRow row={PostingRow} currentVersion={number | null} weights={RubricWeights | null} now={Date} />`

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/LedgerRow.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LedgerRow } from '../src/components/postings/LedgerRow';
import type { PostingRow, RubricWeights, SubScores } from '../src/api/types';

const WEIGHTS: RubricWeights = {
  coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
};

const SUBSCORES: SubScores = {
  coreStack: { score: 90, note: 'Nine years on this exact stack.' },
  seniority: { score: 80, note: 'Staff-level scope.' },
  domain: { score: 60, note: 'Fintech adjacent.' },
  logistics: { score: 75, note: 'Hybrid in your city.' },
  growth: { score: 70, note: 'Platform team, room to grow.' },
};

const NOW = new Date('2026-08-26T12:00:00.000Z');

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'Senior Platform Engineer', company: 'Monobank',
    url: 'https://e.com/1', source: 'djinni', location: 'Kyiv, hybrid',
    total: 82, verdict: 'STRONG', reasoning: 'Nine years on the exact stack you list.',
    providerId: 'claude-opus-5', settingsVersion: '3',
    scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

function renderRow(over: Partial<PostingRow> = {}, currentVersion: number | null = 3) {
  return render(
    <MemoryRouter>
      <LedgerRow row={row(over)} currentVersion={currentVersion} weights={WEIGHTS} now={NOW} />
    </MemoryRouter>,
  );
}

describe('LedgerRow', () => {
  it('shows the score, the verdict word and a link to the vacancy', () => {
    renderRow();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('STRONG')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Senior Platform Engineer/ }))
      .toHaveAttribute('href', 'https://e.com/1');
  });

  it('opens the vacancy in a new tab safely', () => {
    renderRow();
    const link = screen.getByRole('link', { name: /Senior Platform Engineer/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('speaks the pip row as a counted verdict', () => {
    renderRow();
    expect(screen.getByRole('img', { name: /3 of 3/i })).toBeInTheDocument();
  });

  it('speaks one pip for a NO', () => {
    renderRow({ verdict: 'NO', total: 20 });
    expect(screen.getByRole('img', { name: /1 of 3/i })).toBeInTheDocument();
  });

  it('says the location is not stated when it is null', () => {
    renderRow({ location: null });
    expect(screen.getByText(/location not stated/i)).toBeInTheDocument();
  });

  it('shows the relative scoring time', () => {
    renderRow();
    expect(screen.getByText('6h')).toBeInTheDocument();
  });

  it('tags a near miss with the numeric gap', () => {
    renderRow({ verdict: 'NO', total: 44 });
    expect(screen.getByText(/near miss/i)).toBeInTheDocument();
    expect(screen.getByText(/6 under/i)).toBeInTheDocument();
  });

  it('tags a stale score with its version and a spoken label', () => {
    renderRow({ settingsVersion: '2' }, 3);
    expect(screen.getByRole('img', { name: /settings version 2/i })).toBeInTheDocument();
  });

  it('does not tag a current score as stale', () => {
    renderRow({ settingsVersion: '3' }, 3);
    expect(screen.queryByRole('img', { name: /settings version/i })).not.toBeInTheDocument();
  });
});

describe('LedgerRow breakdown', () => {
  it('is collapsed until asked for', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /breakdown/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/nine years on this exact stack/i)).not.toBeInTheDocument();
  });

  it('expands to the five dimensions with their notes and weight shares', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    expect(screen.getByText(/nine years on this exact stack/i)).toBeInTheDocument();
    expect(screen.getByText(/fintech adjacent/i)).toBeInTheDocument();
    // 35 of a 100-point weight sum.
    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('speaks every bar value in one label', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    const chart = screen.getByRole('img', { name: /core stack 90/i });
    expect(chart).toHaveAccessibleName(expect.stringContaining('domain 60'));
  });

  it('draws a stale row’s bars in neutral ink', async () => {
    renderRow({ settingsVersion: '2' }, 3);
    await userEvent.click(screen.getByRole('button', { name: /breakdown/i }));

    const chart = screen.getByRole('img', { name: /core stack 90/i });
    expect(chart.className).toMatch(/stale/);
  });
});

describe('LedgerRow for a rejected posting', () => {
  const rejected = {
    providerId: 'hard-filter', reasoning: 'hard-filter:location',
    total: 0, verdict: 'NO' as const,
  };

  it('reads the rejection as a sentence, never as the machine string', () => {
    renderRow(rejected);
    expect(screen.getByText(/excluded location/i)).toBeInTheDocument();
    expect(screen.queryByText(/hard-filter:location/)).not.toBeInTheDocument();
  });

  it('tags the rule and links to the rule that rejected it', () => {
    renderRow(rejected);
    expect(screen.getByText(/filtered · location/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit the rule/i })).toHaveAttribute('href', '/settings');
  });

  it('offers no breakdown, because there is nothing to break down', () => {
    renderRow(rejected);
    expect(screen.queryByRole('button', { name: /breakdown/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/LedgerRow.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write ScoreBreakdown.module.css**

```css
.panel {
  margin-top: 11px;
  padding: 12px 14px;
  background: var(--ink-05);
}

.dim {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 7px;
}

.dimLabel { width: 78px; flex: none; font-size: 12px; }

.track {
  flex: 1;
  min-width: 50px;
  height: 8px;
  background: var(--ink-10);
}

.fill { height: 8px; background: var(--color-accent); }
.stale .fill { background: var(--color-neutral-500); }

.value {
  width: 26px;
  flex: none;
  text-align: right;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 12.5px;
}

.share { width: 34px; flex: none; font-size: 11px; color: var(--ink-50); }

.note {
  flex: 1.4;
  min-width: 120px;
  font-size: 11.5px;
  color: var(--ink-62);
  line-height: 1.35;
}
```

- [ ] **Step 4: Write ScoreBreakdown.tsx**

```tsx
import type { RubricWeights, SubScores } from '../../api/types';
import s from './ScoreBreakdown.module.css';

const DIMENSIONS: Array<{ key: keyof SubScores; label: string }> = [
  { key: 'coreStack', label: 'Core stack' },
  { key: 'seniority', label: 'Seniority' },
  { key: 'domain', label: 'Domain' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'growth', label: 'Growth' },
];

interface Props {
  subscores: SubScores;
  weights: RubricWeights;
  stale: boolean;
}

export function ScoreBreakdown({ subscores, weights, stale }: Props) {
  // Weights are normalised by their actual sum, never by 100 — the backend
  // does the same, so a rubric of 70/40/30/40/20 shows the same shares as
  // 35/20/15/20/10.
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);

  const spoken = DIMENSIONS
    .map((d) => `${d.label.toLowerCase()} ${subscores[d.key].score}`)
    .join(', ');

  return (
    <div
      className={stale ? `${s.panel} ${s.stale}` : s.panel}
      role="img"
      aria-label={`Sub-scores out of 100: ${spoken}.`}
    >
      {DIMENSIONS.map((d) => {
        const value = subscores[d.key].score;
        return (
          <div className={s.dim} key={d.key}>
            <div className={s.dimLabel}>{d.label}</div>
            <div className={s.track}>
              {/* Dimensions share the 0-100 scale of `total`, so the score is
                  the percentage directly. */}
              <div className={s.fill} style={{ width: `${value}%` }} />
            </div>
            <div className={s.value}>{value}</div>
            <div className={s.share}>{Math.round((weights[d.key] / sum) * 100)}%</div>
            <div className={s.note}>{subscores[d.key].note}</div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Write LedgerRow.module.css**

```css
.row {
  display: flex;
  align-items: flex-start;
  padding: 11px 0;
  border-bottom: 1px solid var(--ink-12);
}

.row:hover { background: var(--ink-035); }
.nearMissRow { background: var(--color-accent-2-100); }

.score {
  width: 66px;
  flex: none;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 31px;
  line-height: 0.92;
  letter-spacing: -0.03em;
}

/* Ink weight is the third, non-hue carrier of the verdict band. */
.strong { color: var(--color-text); }
.maybe { color: var(--color-neutral-700); }
.no { color: var(--color-neutral-500); }

.verdictCell { width: 112px; flex: none; padding-top: 3px; }

.verdictWord {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 10.5px;
  letter-spacing: 0.11em;
}

.pips { display: flex; gap: 2px; margin-top: 5px; }

.pip {
  width: 8px;
  height: 8px;
  border: 1px solid var(--color-neutral-500);
}

.pipOn { background: var(--color-text); }

.tag {
  display: inline-flex;
  margin-top: 6px;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 6px;
}

.tagNear { background: var(--color-accent-2-100); color: var(--color-accent-2-800); }
.tagStale { border: 1px solid var(--color-neutral-500); color: var(--color-neutral-800); }
.tagFiltered { background: var(--color-neutral-200); color: var(--color-neutral-800); }

.roleCell { flex: 1.3; min-width: 0; padding-right: 14px; }

.title {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 15.5px;
  line-height: 1.25;
  color: inherit;
  text-decoration: none;
}

.title:hover { color: var(--color-accent-700); text-decoration: underline; }

.company { font-size: 12.5px; color: var(--ink-62); margin-top: 2px; }
.sourceCell { width: 146px; flex: none; font-size: 12px; color: var(--ink-62); padding-top: 2px; }
.whyCell { flex: 1.5; min-width: 0; padding-right: 14px; }
.why { font-size: 13.5px; line-height: 1.45; text-wrap: pretty; }
.whyMuted { color: var(--ink-62); }

.toggle {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin-top: 5px;
  font: inherit;
  font-size: 11.5px;
  color: var(--color-accent-700);
  border-bottom: 1px solid currentColor;
  cursor: pointer;
}

.whenCell {
  width: 74px;
  flex: none;
  text-align: right;
  font-size: 12px;
  color: var(--ink-55);
  padding-top: 2px;
}

@media (max-width: 820px) {
  .sourceCell { display: none; }
}
```

- [ ] **Step 6: Write LedgerRow.tsx**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostingRow, RubricWeights } from '../../api/types';
import {
  bandKey, isHardFiltered, isNearMiss, isStale, nearMissGap,
  pipCount, rejectionSentence, relativeTime, ruleOf,
} from '../../postings/derive';
import { ScoreBreakdown } from './ScoreBreakdown';
import s from './LedgerRow.module.css';

interface Props {
  row: PostingRow;
  currentVersion: number | null;
  weights: RubricWeights | null;
  now: Date;
}

export function LedgerRow({ row, currentVersion, weights, now }: Props) {
  const [expanded, setExpanded] = useState(false);

  const band = bandKey(row.verdict);
  const filtered = isHardFiltered(row);
  const rule = ruleOf(row);
  const near = isNearMiss(row);
  const stale = isStale(row, currentVersion);
  const pips = pipCount(row.verdict);

  return (
    <article className={near ? `${s.row} ${s.nearMissRow}` : s.row}>
      <div className={`${s.score} ${s[band]}`}>{row.total}</div>

      <div className={s.verdictCell}>
        <div className={s.verdictWord}>{row.verdict}</div>
        <div className={s.pips} role="img" aria-label={`Verdict ${row.verdict}, ${pips} of 3`}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= pips ? `${s.pip} ${s.pipOn}` : s.pip} />
          ))}
        </div>

        {near && (
          <div className={`${s.tag} ${s.tagNear}`}>
            Near miss · {nearMissGap(row)} under
          </div>
        )}
        {stale && (
          <div
            className={`${s.tag} ${s.tagStale}`}
            role="img"
            aria-label={`Stale score, computed under settings version ${row.settingsVersion}`}
          >
            ⚠ v{row.settingsVersion}
          </div>
        )}
        {filtered && rule && (
          <div className={`${s.tag} ${s.tagFiltered}`}>Filtered · {rule}</div>
        )}
      </div>

      <div className={s.roleCell}>
        <a className={s.title} href={row.url} target="_blank" rel="noreferrer">{row.title}</a>
        <div className={s.company}>
          {row.company} · {row.location ?? 'Location not stated'}
        </div>
      </div>

      <div className={s.sourceCell}>{row.source}</div>

      <div className={s.whyCell}>
        {/* Machine strings never surface: a rejected row reads as a sentence. */}
        <div className={filtered ? `${s.why} ${s.whyMuted}` : s.why}>
          {filtered && rule ? rejectionSentence(rule) : row.reasoning}
        </div>

        {!filtered && weights && (
          <button
            type="button" className={s.toggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? 'Hide breakdown' : 'Breakdown'}
          </button>
        )}

        {filtered && (
          <div>
            <Link to="/settings" className={s.toggle}>Edit the rule that rejected this</Link>
          </div>
        )}

        {expanded && weights && (
          <ScoreBreakdown subscores={row.subscores} weights={weights} stale={stale} />
        )}
      </div>

      <div className={s.whenCell}>{relativeTime(row.scoredAt, now)}</div>
    </article>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/LedgerRow.test.tsx`
Expected: PASS. If the "speaks every bar value" test fails on label wording, adjust the `aria-label` template — not the test's intent, which is that every value is spoken in one string.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/postings dashboard/tests/LedgerRow.test.tsx
git commit -m "feat(dashboard): ledger row with an expandable sub-score breakdown"
```

---

## Task 9: The feed — day dividers and empty states

**Files:**
- Create: `dashboard/src/components/postings/PostingsFeed.tsx`, `PostingsFeed.module.css`
- Create: `dashboard/src/components/postings/EmptyState.tsx`, `EmptyState.module.css`
- Modify: `dashboard/src/pages/PostingsPage.tsx`
- Delete: `dashboard/src/components/PostingsTable.tsx`, `dashboard/src/components/VerdictBadge.tsx`, `dashboard/tests/PostingsTable.test.tsx`
- Create: `dashboard/tests/PostingsFeed.test.tsx`

**Interfaces:**
- Consumes: `groupByDay`, `isHardFiltered` (Task 3); `LedgerRow` (Task 8).
- Produces: `<PostingsFeed rows={PostingRow[]} currentVersion={number|null} weights={RubricWeights|null} now={Date} />` — renders scored rows only; rejected rows are handed to Task 10's strip.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/PostingsFeed.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PostingsFeed } from '../src/components/postings/PostingsFeed';
import { EmptyState } from '../src/components/postings/EmptyState';
import type { PostingRow, RubricWeights, SubScores } from '../src/api/types';

const WEIGHTS: RubricWeights = {
  coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
};
const DIM = { score: 50, note: 'n' };
const SUBSCORES: SubScores = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};
const NOW = new Date('2026-08-26T12:00:00.000Z');

function row(over: Partial<PostingRow> = {}): PostingRow {
  return {
    postingId: 'x:1', title: 'A Role', company: 'C', url: 'https://e.com/1',
    source: 'djinni', location: 'Remote', total: 80, verdict: 'STRONG',
    reasoning: 'r', providerId: 'anthropic', settingsVersion: '3',
    scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES, ...over,
  };
}

function renderFeed(rows: PostingRow[]) {
  return render(
    <MemoryRouter>
      <PostingsFeed rows={rows} currentVersion={3} weights={WEIGHTS} now={NOW} descending />
    </MemoryRouter>,
  );
}

describe('PostingsFeed', () => {
  it('groups rows under day dividers carrying a date and a count', () => {
    renderFeed([
      row({ postingId: 'a', title: 'Today role' }),
      row({ postingId: 'b', title: 'Old role', scoredAt: '2026-08-25T06:00:00.000Z' }),
    ]);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText(/26 August · 1 new/)).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('renders the column heads once, not per group', () => {
    renderFeed([row({ postingId: 'a' }), row({ postingId: 'b', scoredAt: '2026-08-25T06:00:00.000Z' })]);
    expect(screen.getAllByText(/role \/ company/i)).toHaveLength(1);
  });

  it('renders one row per posting', () => {
    renderFeed([row({ postingId: 'a', title: 'One' }), row({ postingId: 'b', title: 'Two' })]);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('leaves hard-filtered rows out of the feed entirely', () => {
    renderFeed([
      row({ postingId: 'a', title: 'Scored' }),
      row({
        postingId: 'b', title: 'Rejected',
        providerId: 'hard-filter', reasoning: 'hard-filter:location',
      }),
    ]);

    expect(screen.getByText('Scored')).toBeInTheDocument();
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('explains the pipeline on a fresh install', () => {
    render(<MemoryRouter><EmptyState kind="fresh" onClearFilters={() => {}} /></MemoryRouter>);

    expect(screen.getByText(/nothing on the radar yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /paste your cv/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /add a job board/i })).toHaveAttribute('href', '/settings');
  });

  it('offers to clear the filters when they hide everything', async () => {
    let cleared = false;
    render(
      <MemoryRouter>
        <EmptyState kind="filtered" onClearFilters={() => { cleared = true; }} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/no posting matches these filters/i)).toBeInTheDocument();
    screen.getByRole('button', { name: /clear filters/i }).click();
    expect(cleared).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/PostingsFeed.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write PostingsFeed.module.css**

```css
.head {
  display: flex;
  gap: 0;
  padding: 9px 0 7px;
  font-size: 10px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--ink-55);
  border-bottom: 1px solid var(--ink-20);
}

.hScore { width: 66px; }
.hVerdict { width: 112px; }
.hRole { flex: 1.3; min-width: 0; }
.hSource { width: 146px; }
.hWhy { flex: 1.5; min-width: 0; }
.hWhen { width: 74px; text-align: right; }

.divider {
  display: flex;
  align-items: baseline;
  gap: 11px;
  padding: 18px 0 7px;
}

.dividerLabel {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.dividerSub { font-size: 11.5px; color: var(--ink-50); }
.dividerRule { flex: 1; height: 1px; background: var(--ink-16); }

@media (max-width: 820px) {
  .hSource { display: none; }
}
```

- [ ] **Step 4: Write PostingsFeed.tsx**

```tsx
import type { PostingRow, RubricWeights } from '../../api/types';
import { groupByDay, isHardFiltered } from '../../postings/derive';
import { LedgerRow } from './LedgerRow';
import s from './PostingsFeed.module.css';

interface Props {
  rows: PostingRow[];
  currentVersion: number | null;
  weights: RubricWeights | null;
  now: Date;
  descending: boolean;
}

export function PostingsFeed({ rows, currentVersion, weights, now, descending }: Props) {
  // Rejected postings are recorded, not dropped — they are rendered by
  // RejectedStrip behind a count, so they never crowd the daily scan.
  const scored = rows.filter((r) => !isHardFiltered(r));
  const groups = groupByDay(scored, now, descending);

  return (
    <>
      <div className={s.head}>
        <div className={s.hScore}>Score</div>
        <div className={s.hVerdict}>Verdict</div>
        <div className={s.hRole}>Role / company</div>
        <div className={s.hSource}>Source</div>
        <div className={s.hWhy}>Why</div>
        <div className={s.hWhen}>Scored</div>
      </div>

      {groups.map((g) => (
        <section key={g.key}>
          <div className={s.divider}>
            <div className={s.dividerLabel}>{g.label}</div>
            <div className={s.dividerSub}>{g.date} · {g.rows.length} new</div>
            <div className={s.dividerRule} />
          </div>

          {g.rows.map((row) => (
            <LedgerRow
              key={row.postingId} row={row} currentVersion={currentVersion}
              weights={weights} now={now}
            />
          ))}
        </section>
      ))}
    </>
  );
}
```

- [ ] **Step 5: Write EmptyState.module.css**

```css
.fresh { padding: 64px 0 40px; max-width: 60ch; }

.headline {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 34px;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.lede { margin-top: 14px; font-size: 15.5px; line-height: 1.6; text-wrap: pretty; }

.actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }

.action {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 14px;
  padding: 8px 16px;
  background: var(--color-text);
  color: var(--color-bg);
  text-decoration: none;
}

.actionSecondary {
  background: none;
  color: var(--color-text);
  border: 1px solid var(--color-text);
}

.steps { margin-top: 34px; display: flex; flex-direction: column; gap: 9px; font-size: 13.5px; }
.step { display: flex; gap: 11px; align-items: baseline; }

.stepNumber {
  width: 16px;
  color: var(--color-accent-700);
  font-family: var(--font-heading);
  font-weight: 600;
}

.filtered { padding: 52px 0 34px; max-width: 52ch; }
.filteredHeadline { font-family: var(--font-heading); font-weight: 600; font-size: 24px; }

.clear {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin-top: 12px;
  font: inherit;
  font-size: 14px;
  color: var(--color-accent-700);
  border-bottom: 1px solid currentColor;
  cursor: pointer;
}
```

- [ ] **Step 6: Write EmptyState.tsx**

```tsx
import { Link } from 'react-router-dom';
import s from './EmptyState.module.css';

const STEPS = [
  'Fetch each enabled source’s listing page — that is what detects new postings.',
  'Reject anything with a blocked word in its title, before downloading it.',
  'Download each surviving posting’s own page — once, ever.',
  'Drop anything failing your hard filters — with the reason kept on the row.',
  'Score the rest against your CV and rubric; anything over the threshold pings you.',
];

interface Props {
  kind: 'fresh' | 'filtered';
  onClearFilters: () => void;
}

export function EmptyState({ kind, onClearFilters }: Props) {
  if (kind === 'filtered') {
    return (
      <div className={s.filtered}>
        <div className={s.filteredHeadline}>No posting matches these filters.</div>
        <button type="button" className={s.clear} onClick={onClearFilters}>Clear filters</button>
      </div>
    );
  }

  return (
    <div className={s.fresh}>
      <div className={s.headline}>Nothing on the radar yet.</div>
      <p className={s.lede}>
        The worker polls every 30 minutes. Once your CV and at least one source are
        saved, the first shortlist lands within the half hour — and Telegram pings
        you before you think to look.
      </p>

      <div className={s.actions}>
        <Link to="/settings" className={s.action}>Paste your CV</Link>
        <Link to="/settings" className={`${s.action} ${s.actionSecondary}`}>Add a job board</Link>
      </div>

      <div className={s.steps}>
        {STEPS.map((text, i) => (
          <div className={s.step} key={text}>
            <span className={s.stepNumber}>{i + 1}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/PostingsFeed.test.tsx`
Expected: PASS.

- [ ] **Step 8: Wire the page and delete the old table**

Rewrite `dashboard/src/pages/PostingsPage.tsx`:

```tsx
import { useMemo } from 'react';
import { useDashboardData } from '../context/DashboardData';
import { DEFAULT_FILTERS } from '../api/filters-url';
import { isHardFiltered } from '../postings/derive';
import { Filters } from '../components/postings/Filters';
import { PostingsFeed } from '../components/postings/PostingsFeed';
import { EmptyState } from '../components/postings/EmptyState';
import { SourceHealth } from '../components/SourceHealth';
import s from './PostingsPage.module.css';

export function PostingsPage() {
  const { postings, health, settings, ui, setUi } = useDashboardData();

  const rows = useMemo(() => postings.data ?? [], [postings.data]);
  const scoredCount = rows.filter((r) => !isHardFiltered(r)).length;
  const now = new Date();

  return (
    <section className={s.page}>
      <Filters rows={rows} resultCount={scoredCount} />

      {postings.loading && <p className={s.state}>Loading…</p>}
      {postings.error && <p className={s.state} role="alert">Error: {postings.error}</p>}

      {!postings.loading && !postings.error && scoredCount === 0 && (
        <EmptyState
          kind={rows.length === 0 && ui === DEFAULT_FILTERS ? 'fresh' : 'filtered'}
          onClearFilters={() => setUi(DEFAULT_FILTERS)}
        />
      )}

      {!postings.loading && !postings.error && scoredCount > 0 && (
        <PostingsFeed
          rows={rows}
          currentVersion={settings.data?.version ?? null}
          weights={settings.data?.rubricWeights ?? null}
          now={now}
          descending={ui.sort === 'desc'}
        />
      )}

      <SourceHealth rows={health.data ?? []} />
    </section>
  );
}
```

**Correction before you write it:** `ui === DEFAULT_FILTERS` compares object identity and is always false — `parseFilters` returns a fresh object. Use a value comparison instead:

```tsx
  const filtersAreDefault = useMemo(
    () => JSON.stringify(ui) === JSON.stringify(DEFAULT_FILTERS), [ui],
  );
```

and pass `kind={rows.length === 0 && filtersAreDefault ? 'fresh' : 'filtered'}`.

Create `dashboard/src/pages/PostingsPage.module.css`:

```css
.page { padding: 0 34px 60px; }
.state { padding: 32px 0; color: var(--ink-55); font-size: 14px; }

@media (max-width: 820px) {
  .page { padding: 0 18px 40px; }
}
```

Then delete the superseded components:

```bash
cd dashboard && git rm src/components/PostingsTable.tsx src/components/VerdictBadge.tsx tests/PostingsTable.test.tsx
```

- [ ] **Step 9: Update the App test that asserted the old table**

In `tests/App.test.tsx`, the stale-badge test clicked into Settings and back and asserted `getByRole('img', {name: /stale/i})`. The label now reads "Stale score, computed under settings version 1", so the regex still matches. The `posting` fixture's `scoredAt` is `2026-08-25`, which will render under a "N days ago" divider — that is fine; the assertions are on text, not position.

Run the suite and fix any fixture that assumed the table markup.

- [ ] **Step 10: Run the full suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add -A dashboard
git commit -m "feat(dashboard): day-grouped ledger feed replaces the postings table"
```

---

## Task 10: Rejected postings behind a count

**Files:**
- Create: `dashboard/src/components/postings/RejectedStrip.tsx`, `RejectedStrip.module.css`
- Modify: `dashboard/src/pages/PostingsPage.tsx`
- Create: `dashboard/tests/RejectedStrip.test.tsx`

**Interfaces:**
- Consumes: `isHardFiltered`, `ruleOf` (Task 3); `LedgerRow` (Task 8); `useDashboardData` for `ui.showRejected` / `setUi`.
- Produces: `<RejectedStrip rows={PostingRow[]} currentVersion={number|null} now={Date} />` — `rows` is the **already-filtered** list of hard-filtered postings.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/RejectedStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RejectedStrip } from '../src/components/postings/RejectedStrip';
import { DashboardDataProvider, type DashboardData } from '../src/context/DashboardData';
import { DEFAULT_FILTERS } from '../src/api/filters-url';
import type { PostingRow, SubScores } from '../src/api/types';

const DIM = { score: 0, note: 'hard filter' };
const SUBSCORES: SubScores = {
  coreStack: DIM, seniority: DIM, domain: DIM, logistics: DIM, growth: DIM,
};
const NOW = new Date('2026-08-26T12:00:00.000Z');
const emptyState = { data: null, error: null, loading: false, reload: () => {} };

function rejected(id: string, rule: string): PostingRow {
  return {
    postingId: id, title: `Role ${id}`, company: 'C', url: `https://e.com/${id}`,
    source: 'djinni', location: 'Moscow', total: 0, verdict: 'NO',
    reasoning: `hard-filter:${rule}`, providerId: 'hard-filter',
    settingsVersion: '3', scoredAt: '2026-08-26T06:00:00.000Z', subscores: SUBSCORES,
  };
}

function renderStrip(showRejected: boolean, rows: PostingRow[]) {
  const setUi = vi.fn();
  const value = {
    postings: emptyState, health: emptyState, settings: emptyState,
    ui: { ...DEFAULT_FILTERS, showRejected }, setUi,
  } as unknown as DashboardData;

  render(
    <MemoryRouter>
      <DashboardDataProvider value={value}>
        <RejectedStrip rows={rows} currentVersion={3} now={NOW} />
      </DashboardDataProvider>
    </MemoryRouter>,
  );
  return setUi;
}

describe('RejectedStrip', () => {
  const rows = [
    rejected('a', 'location'), rejected('b', 'location'), rejected('c', 'salary'),
  ];

  it('renders nothing when nothing was rejected', () => {
    const { container } = render(
      <MemoryRouter>
        <DashboardDataProvider value={{
          postings: emptyState, health: emptyState, settings: emptyState,
          ui: DEFAULT_FILTERS, setUi: () => {},
        } as unknown as DashboardData}>
          <RejectedStrip rows={[]} currentVersion={3} now={NOW} />
        </DashboardDataProvider>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the rejections and breaks them down by rule', () => {
    renderStrip(false, rows);
    expect(screen.getByText(/3 postings never reached the model/i)).toBeInTheDocument();
    expect(screen.getByText(/2 location/i)).toBeInTheDocument();
    expect(screen.getByText(/1 salary/i)).toBeInTheDocument();
  });

  it('keeps the rows out of sight until asked', () => {
    renderStrip(false, rows);
    expect(screen.queryByText('Role a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show them/i })).toBeInTheDocument();
  });

  it('publishes the request to show them', async () => {
    const setUi = renderStrip(false, rows);
    await userEvent.click(screen.getByRole('button', { name: /show them/i }));
    expect(setUi).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, showRejected: true });
  });

  it('renders the rows and offers to hide them again when expanded', () => {
    renderStrip(true, rows);
    expect(screen.getByText('Role a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide them/i })).toBeInTheDocument();
  });

  it('uses the singular for one rejection', () => {
    renderStrip(false, [rejected('a', 'salary')]);
    expect(screen.getByText(/1 posting never reached the model/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/RejectedStrip.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write RejectedStrip.module.css**

```css
.strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 0;
  font-size: 13.5px;
  color: var(--ink-62);
  border-bottom: 1px solid var(--ink-10);
  flex-wrap: wrap;
}

.toggle {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 13px;
  color: var(--color-accent-700);
  border-bottom: 1px solid currentColor;
  cursor: pointer;
}

.rows { margin-top: 4px; }
```

- [ ] **Step 4: Write RejectedStrip.tsx**

```tsx
import { useDashboardData } from '../../context/DashboardData';
import type { PostingRow } from '../../api/types';
import { ruleOf } from '../../postings/derive';
import { LedgerRow } from './LedgerRow';
import s from './RejectedStrip.module.css';

interface Props {
  rows: PostingRow[];
  currentVersion: number | null;
  now: Date;
}

/**
 * Rejected postings stay recorded but out of the daily scan. This is a
 * deliberate departure from the original brief's "keep them visible", made to
 * protect the five-second read — and it reverts by rendering `rows` inline.
 */
export function RejectedStrip({ rows, currentVersion, now }: Props) {
  const { ui, setUi } = useDashboardData();
  if (rows.length === 0) return null;

  const byRule = new Map<string, number>();
  for (const row of rows) {
    const rule = ruleOf(row) ?? 'unknown';
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  }

  const breakdown = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rule, count]) => `${count} ${rule}`)
    .join(', ');

  return (
    <>
      <div className={s.strip}>
        <span>
          {rows.length} {rows.length === 1 ? 'posting' : 'postings'} never
          reached the model — {breakdown}.
        </span>
        <button
          type="button" className={s.toggle}
          aria-expanded={ui.showRejected}
          onClick={() => setUi({ ...ui, showRejected: !ui.showRejected })}
        >
          {ui.showRejected ? 'Hide them' : 'Show them'}
        </button>
      </div>

      {ui.showRejected && (
        <div className={s.rows}>
          {rows.map((row) => (
            <LedgerRow
              key={row.postingId} row={row} currentVersion={currentVersion}
              weights={null} now={now}
            />
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/RejectedStrip.test.tsx`
Expected: PASS.

- [ ] **Step 6: Mount it in the page**

In `PostingsPage.tsx`, add above `<SourceHealth>`:

```tsx
      <RejectedStrip
        rows={rows.filter(isHardFiltered)}
        currentVersion={settings.data?.version ?? null}
        now={now}
      />
```

- [ ] **Step 7: Run the full suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src dashboard/tests
git commit -m "feat(dashboard): rejected postings behind a count with rule sentences"
```

---

## Task 11: Source health as run strips

**Files:**
- Rewrite: `dashboard/src/components/SourceHealth.tsx`
- Create: `dashboard/src/components/SourceHealth.module.css`
- Create: `dashboard/tests/SourceHealth.test.tsx`

**Interfaces:**
- Consumes: `HealthRow` from `src/api/types.ts`.
- Produces: `<SourceHealth rows={HealthRow[]} />` — same signature as today, new rendering. Also exports `groupRuns(rows: HealthRow[]): SourceRuns[]` where `interface SourceRuns { source: string; status: string; error: string | null; runs: HealthRow[] }`.

`sourceHealth()` returns the newest 20 rows across all sources, ordered newest-first. Grouping by source and taking the first ten of each is all that is needed.

- [ ] **Step 1: Write the failing test**

Create `dashboard/tests/SourceHealth.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SourceHealth, groupRuns } from '../src/components/SourceHealth';
import type { HealthRow } from '../src/api/types';

function run(source: string, status: string, minutesAgo: number, error: string | null = null): HealthRow {
  return {
    source, status, error,
    ranAt: new Date(Date.parse('2026-08-26T12:00:00.000Z') - minutesAgo * 60_000).toISOString(),
  };
}

describe('groupRuns', () => {
  it('groups the run log by source, newest first', () => {
    const groups = groupRuns([
      run('djinni', 'ok', 0), run('dou', 'error', 5, 'selector miss'),
      run('djinni', 'ok', 30),
    ]);

    expect(groups.map((g) => g.source)).toEqual(['djinni', 'dou']);
    expect(groups[0]!.runs).toHaveLength(2);
  });

  it('takes the status and error from the newest run of each source', () => {
    const groups = groupRuns([run('dou', 'error', 1, 'selector miss'), run('dou', 'ok', 60)]);
    expect(groups[0]!.status).toBe('error');
    expect(groups[0]!.error).toBe('selector miss');
  });

  it('keeps at most ten runs per source', () => {
    const rows = Array.from({ length: 14 }, (_, i) => run('djinni', 'ok', i));
    expect(groupRuns(rows)[0]!.runs).toHaveLength(10);
  });
});

describe('SourceHealth', () => {
  it('renders nothing when the run log is empty', () => {
    const { container } = render(<MemoryRouter><SourceHealth rows={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one panel per source with a spoken run strip', () => {
    render(<MemoryRouter><SourceHealth rows={[run('djinni', 'ok', 0), run('dou', 'ok', 1)]} /></MemoryRouter>);

    expect(screen.getByText('djinni')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /last 2 runs.*djinni/i })).toBeInTheDocument();
  });

  it('raises an alert naming how many boards are failing', () => {
    render(
      <MemoryRouter>
        <SourceHealth rows={[run('djinni', 'ok', 0), run('dou', 'error', 1, 'selector miss')]} />
      </MemoryRouter>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/1 source failing/i);
    expect(alert).toHaveTextContent(/may be incomplete/i);
  });

  it('shows the error text and a repair link for a failing board', () => {
    render(<MemoryRouter><SourceHealth rows={[run('dou', 'error', 1, 'selector miss')]} /></MemoryRouter>);

    expect(screen.getByText(/selector miss/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /repair this source/i }))
      .toHaveAttribute('href', '/settings');
  });

  it('raises no alert when every board is ok', () => {
    render(<MemoryRouter><SourceHealth rows={[run('djinni', 'ok', 0)]} /></MemoryRouter>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd dashboard && npx vitest run tests/SourceHealth.test.tsx`
Expected: FAIL — `groupRuns` is not exported.

- [ ] **Step 3: Write SourceHealth.module.css**

```css
.section { padding: 34px 0 0; }

.head {
  display: flex;
  align-items: baseline;
  gap: 13px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.title {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.sub { font-size: 11.5px; color: var(--ink-50); }

.alert {
  margin-left: auto;
  font-size: 13px;
  padding: 4px 11px;
  background: var(--color-accent-2-100);
  color: var(--color-accent-2-800);
}

.panels { display: flex; gap: 12px; flex-wrap: wrap; }

.panel {
  flex: 1;
  min-width: 216px;
  padding: 11px 13px;
  background: var(--ink-035);
}

.panelBroken { background: var(--color-accent-2-100); }

.panelHead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 13.5px;
}

.status {
  font-size: 11px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ink-55);
}

.statusBroken { color: var(--color-accent-2-800); }

.strip { display: flex; gap: 2px; margin-top: 8px; }

.tick { width: 6px; height: 15px; background: var(--color-text); }
.tickError { background: var(--color-accent-2); }
.tickOther { background: var(--color-neutral-400); }

.note { font-size: 11.5px; line-height: 1.4; margin-top: 7px; color: var(--ink-55); }
.noteBroken { color: var(--color-accent-2-900); }

.repair {
  display: inline-block;
  margin-top: 7px;
  font-size: 12px;
  color: var(--color-accent-700);
}

@media (max-width: 820px) {
  .panel { min-width: 100%; }
}
```

- [ ] **Step 4: Write SourceHealth.tsx**

```tsx
import { Link } from 'react-router-dom';
import type { HealthRow } from '../api/types';
import s from './SourceHealth.module.css';

export interface SourceRuns {
  source: string;
  status: string;
  error: string | null;
  /** Newest first, at most ten. */
  runs: HealthRow[];
}

/**
 * `sourceHealth()` returns the newest rows across every source in one list,
 * ordered newest-first, so first-seen is newest-per-source.
 */
export function groupRuns(rows: HealthRow[]): SourceRuns[] {
  const bySource = new Map<string, HealthRow[]>();
  for (const row of rows) {
    const runs = bySource.get(row.source);
    if (runs) runs.push(row);
    else bySource.set(row.source, [row]);
  }

  return [...bySource.entries()].map(([source, runs]) => ({
    source,
    status: runs[0]!.status,
    error: runs[0]!.error,
    runs: runs.slice(0, 10),
  }));
}

function tickClass(status: string): string {
  if (status === 'error') return `${s.tick} ${s.tickError}`;
  if (status === 'ok') return s.tick;
  return `${s.tick} ${s.tickOther}`;
}

export function SourceHealth({ rows }: { rows: HealthRow[] }) {
  if (rows.length === 0) return null;

  const groups = groupRuns(rows);
  const failing = groups.filter((g) => g.status === 'error');

  return (
    <div className={s.section}>
      <div className={s.head}>
        <div className={s.title}>Source health</div>
        <div className={s.sub}>last 10 runs · newest left</div>

        {failing.length > 0 && (
          <div className={s.alert} role="alert">
            ▲ {failing.length} {failing.length === 1 ? 'source' : 'sources'} failing —
            your shortlist may be incomplete
          </div>
        )}
      </div>

      <div className={s.panels}>
        {groups.map((g) => {
          const broken = g.status === 'error';
          const spoken = `Last ${g.runs.length} runs of ${g.source}: `
            + g.runs.map((r) => r.status).join(', ');

          return (
            <div className={broken ? `${s.panel} ${s.panelBroken}` : s.panel} key={g.source}>
              <div className={s.panelHead}>
                <span>{g.source}</span>
                <span className={broken ? `${s.status} ${s.statusBroken}` : s.status}>
                  {g.status}
                </span>
              </div>

              <div className={s.strip} role="img" aria-label={spoken}>
                {g.runs.map((r, i) => (
                  <span key={`${r.ranAt}-${i}`} className={tickClass(r.status)} />
                ))}
              </div>

              <div className={broken ? `${s.note} ${s.noteBroken}` : s.note}>
                {g.error ?? `Last run ${new Date(g.runs[0]!.ranAt).toLocaleString()}`}
              </div>

              {broken && (
                <Link to="/settings" className={s.repair}>
                  Repair this source&rsquo;s selectors
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

The repair link points at `/settings` rather than a per-source form: the custom-sources feature that would give each source its own anchor is specced but not built.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd dashboard && npx vitest run tests/SourceHealth.test.tsx`
Expected: PASS.

- [ ] **Step 6: Fix the App test that asserted the old health markup**

`tests/App.test.tsx` has "renders the source health panel", asserting `getByText(/selector miss/)`. That still holds. But the health-error alert and the postings-error alert are both `role="alert"` — check no test now finds two alerts where it expected one, and scope with `within` if so.

- [ ] **Step 7: Run the full suite**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src dashboard/tests
git commit -m "feat(dashboard): source health as per-source run strips"
```

---

## Task 12: Retire the global stylesheet

**Files:**
- Delete: `dashboard/src/styles.css`
- Create: one `.module.css` beside each of `DocumentEditor`, `ProfileForm`, `RubricEditor`, `SourcesTable`, `ChipInput`, `SettingsPage`
- Modify: those six components, `dashboard/src/main.tsx`

**Interfaces:**
- Consumes: the tokens from Task 2.
- Produces: nothing new. This is the cleanup that makes the "only tokens.css is global" constraint true.

Settings is **not** being re-laid-out — page 2 of the design doc is a separate task. This moves its existing rules into modules and nothing more. Where a rule used a hard-coded colour, swap in the nearest token: `#ddd` → `var(--color-neutral-300)`, `#555` → `var(--ink-62)`, `#666` → `var(--ink-55)`, `#b00` → `var(--color-accent-2-700)`. Leave the `.row-STRONG` / `.row-MAYBE` / `.badge` rules behind entirely — those belonged to the deleted `PostingsTable`.

- [ ] **Step 1: Confirm no test depends on a global class**

Run: `cd dashboard && grep -rn "toHaveClass\|querySelector\|className=" tests/`
Expected: no matches on global class names. If a match appears, note it before continuing.

- [ ] **Step 2: Move each component's rules into its own module**

Work one component at a time. For `SettingsPage`, create `src/pages/SettingsPage.module.css` holding the `.settings`, `.settings-version`, `.settings-section`, `.settings-actions` and `.state` rules renamed to camelCase (`.settingsVersion` etc.), then import it and replace the string class names. Repeat for the other five, taking each component's own rules from `styles.css`:

| Component | Rules to take |
|---|---|
| `DocumentEditor` | `.settings-section`, its `label` and `textarea` rules, `.settings-actions` |
| `ProfileForm` | `.field`, `.settings-actions` |
| `RubricEditor` | `.weights`, `.weight`, `.pct`, `.settings-actions` |
| `SourcesTable` | `table`, `th`, `td`, `.row-disabled`, `.add-source` |
| `ChipInput` | `.chips`, `.chip` |

`SourcesTable` used the bare `table`/`th`/`td` element selectors from the global sheet. Scope them inside its module as `.table`, `.table th`, `.table td` and add `className={s.table}` to its `<table>` — bare element selectors are no longer allowed outside `tokens.css`.

- [ ] **Step 3: Run the suite after each component**

Run: `cd dashboard && npm test`
Expected: PASS after each move. Commit is at the end, but do not move on from a component whose tests fail.

- [ ] **Step 4: Delete the global sheet**

```bash
cd dashboard && git rm src/styles.css
```

and remove `import './styles.css';` from `src/main.tsx`, leaving only `import './styles/tokens.css';`.

- [ ] **Step 5: Verify nothing still references it**

Run: `cd dashboard && grep -rn "styles.css" src/ index.html`
Expected: exactly one match — `src/main.tsx` importing `./styles/tokens.css`.

- [ ] **Step 6: Run the full suite and build**

Run: `cd dashboard && npx tsc -b && npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 7: Look at it in a browser**

Run: `cd dashboard && npm run dev` and open `http://localhost:5173`. Check: the feed renders in Source Serif on the paper ground; day dividers appear; expanding a breakdown shows five bars; `/settings` loads directly on a hard refresh; the browser Back button steps through filter changes.

- [ ] **Step 8: Commit**

```bash
git add -A dashboard
git commit -m "refactor(dashboard): retire the global stylesheet for CSS Modules"
```

---

## Task 13: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Create: `docs/features/postings-redesign.md`

**Interfaces:**
- Consumes: everything built above.
- Produces: nothing executable.

- [ ] **Step 1: Find every place the old behaviour is described**

Run: `grep -rn "two-tab\|no router\|routing dependency\|styles.css\|PostingsTable\|useState toggle" CLAUDE.md README.md docs/`
Expected: several hits in CLAUDE.md's dashboard section. Fix all of them.

- [ ] **Step 2: Rewrite the CLAUDE.md dashboard section**

The paragraph beginning "Plain React 19, no router, no state library" is now false in its first clause. Rewrite it to say: React 19 with `react-router-dom`; two routes, `/` and `/settings`; `App` is a layout that owns all three fetches and publishes them through `DashboardDataContext`; Postings filter state lives entirely in the query string, so filters are linkable and the Back button steps through them; presentation is CSS Modules over one global token file, and only `src/styles/tokens.css` may define `:root` properties or style bare elements.

Keep the two invariants the existing text records — App owning the settings fetch for the stale badge, and `SettingsPage` gating on `data` rather than `loading` — because both are still true and still load-bearing.

Add to the API-contract note that `PostingRow` now carries `subscores`, and that the double declaration still applies.

Add one line under the Docker section: the SPA needs a history fallback on its production host now that routes are real paths.

- [ ] **Step 3: Update README.md**

In the REST API table's `GET /api/postings` row, note the response rows now include `subscores` — the five dimensions each with a `score` and a `note`.

Add a short deployment note where the dashboard's production deployment is described: the static host must rewrite unknown paths to `/index.html`, or a hard refresh on `/settings` returns 404.

- [ ] **Step 4: Write the feature doc**

Create `docs/features/postings-redesign.md` covering: the problem (no addressable state, `scoredAt` and `subscores` fetched-or-stored but never shown); the design decisions and what was rejected (CSS Modules over styled-components and vanilla-extract; real paths over hash routing; window tokens in the URL over computed dates; rejected postings behind a count rather than inline); the files it touches; and how to verify it — the four commands below plus the browser checks from Task 12 Step 7.

Record the two places the mock outran the code, so the next reader does not think they were forgotten: blocked-word rules do not exist (`applyHardFilters` has three rules), and the per-source repair deep link waits on custom-sources.

- [ ] **Step 5: Verify every claim in the docs**

Run: `cd backend && npm test && cd ../dashboard && npx tsc -b && npm test && npm run build`
Expected: all PASS. Do not write "verified" in the feature doc for anything you did not actually run — the integration suite self-skips without `DATABASE_URL_TEST`, and a skip is not a pass.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/features/postings-redesign.md
git commit -m "docs: record the postings redesign and dashboard routing"
```

---

## Verification

After Task 13, the whole change is verified by:

```bash
cd backend && npm test
cd backend && npx vitest run test/integration/postings.repository.integration.test.ts   # needs DATABASE_URL_TEST
cd dashboard && npx tsc -b && npm test && npm run build
```

Plus the manual browser pass from Task 12 Step 7: a hard refresh on `/settings`, the Back button stepping through filter changes, and a breakdown expanding to five bars.
