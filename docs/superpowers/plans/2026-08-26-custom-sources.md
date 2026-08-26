# Custom Sources with Tunable Selectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JobRadar's three hardcoded source adapters with one
selector-driven adapter whose selectors, name, URL and keyword blocklists live in
the `sources` table and are editable from the dashboard.

**Architecture:** A source row becomes `name + url + selectors + two blocklists`.
One adapter (`src/sources/custom.ts`) parses any listing page from those
selectors and fetches each new posting's own page for its description. The
pipeline gains one gate before that fetch (a title blocklist) and one rule after
it (a description blocklist). Nothing else about the pipeline changes.

**Tech Stack:** NestJS 11, drizzle-orm 0.44 + drizzle-kit (Postgres), cheerio,
Zod, Jest (unit, `backend/src/**/*.spec.ts`), Vitest (integration,
`backend/test/integration/**`, and the dashboard, `dashboard/tests/**`),
React 19 + Vite.

**Spec:** `docs/superpowers/specs/2026-08-26-custom-sources-design.md`

## Global Constraints

- Working directory for all backend commands is `backend/`; for dashboard
  commands, `dashboard/`. Docker Compose runs from `backend/` and this machine
  has no compose plugin — use `docker-compose`, not `docker compose`.
- Unit tests are Jest with `rootDir: src`: `npm test`, or
  `npx jest src/path/file.spec.ts` for one file.
- Integration tests are Vitest and self-skip without their env var
  (`DATABASE_URL_TEST` for repository suites, `INTEGRATION=1` for the
  live-network suite). A green run with no env set proves nothing.
- Selector matching is cheerio over static HTML only. No headless browser, no
  pagination, no selector auto-detection. Out of scope, per the spec.
- Blocked-word matching is **whole word, case-insensitive**: `php` must not match
  `phpstorm`, `go` must not match `Google`, and `c++` / `.net` must be treated as
  literals rather than regex syntax.
- The title blocklist screens `posting.title` **only** — not location, not tags.
- `hydrate` runs **after** the `hasScore` gate and **before** the hard filters.
  Before the gate would re-fetch known postings every tick; after the filters
  would make the salary rule read an empty listing snippet.
- Removing a word from a blocklist does **not** un-reject postings already
  rejected by it — they hold a hard-filter score row and the dedup gate skips
  them forever. This must be stated in the dashboard help text.
- A global profile save bumps `app_settings.version`. Editing a source row does
  not. This asymmetry is deliberate.
- Verdict bands (`toVerdict()`, 75/50) are untouched.
- `postings.source` receives the source's `name`. Posting ids are
  `src:<source uuid>:<externalId>`.
- Both `unique(url)` and `unique(name)` on `sources`; violations surface as HTTP
  409 naming which one collided.

---

### Task 1: Blocked-word matching and the two profile fields

Adds the matching primitive and the global lists it reads, wires the description
rule into the existing hard filters, and fixes the raw-jsonb read in
`SettingsService.load()` that would otherwise hand `undefined` to the matcher.
The title check arrives in Task 4, where the pipeline gets its new ordering.

**Files:**
- Modify: `backend/src/filters.ts`
- Modify: `backend/src/settings/schema.ts:4-9` (`profileFields`)
- Modify: `backend/src/settings/settings.service.ts:28`
- Modify: `backend/src/settings/seed.ts:32-37` (`DEFAULT_PROFILE`)
- Modify: `backend/src/pipeline/pipeline.service.ts:106` (the `applyHardFilters` call)
- Test: `backend/src/filters.spec.ts`
- Test: `backend/src/settings/schema.spec.ts`
- Test: `backend/src/pipeline/pipeline.service.spec.ts:49-60` (the `settings` literal)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `matchBlockedWord(text: string, words: string[]): string | null` — returns the
    entry that matched, or `null`.
  - `applyTitleFilter(posting: RawPosting, words: string[]): FilterResult`
  - `applyHardFilters(posting: RawPosting, profile: Profile, descriptionWords: string[]): FilterResult`
    — note the new third parameter, required, not defaulted.
  - `Profile` gains `blockedTitleWords: string[]` and
    `blockedDescriptionWords: string[]`.

- [ ] **Step 1: Write the failing matcher tests**

Add to `backend/src/filters.spec.ts`:

```ts
import { matchBlockedWord, applyTitleFilter } from './filters';

describe('matchBlockedWord', () => {
  it('matches a whole word regardless of case', () => {
    expect(matchBlockedWord('Senior PHP Developer', ['php'])).toBe('php');
  });

  it('does not match a word embedded in a longer word', () => {
    expect(matchBlockedWord('phpstorm plugin author', ['php'])).toBeNull();
    expect(matchBlockedWord('Google Cloud engineer', ['go'])).toBeNull();
  });

  it('matches a multi-word phrase', () => {
    expect(matchBlockedWord('Relocation required to Berlin', ['relocation required']))
      .toBe('relocation required');
  });

  it('treats regex metacharacters in an entry as literals', () => {
    expect(matchBlockedWord('C++ systems role', ['c++'])).toBe('c++');
    expect(matchBlockedWord('c-plus-plus', ['c++'])).toBeNull();
  });

  // An entry that does not start with a letter or digit gets no leading
  // boundary, or `.net` could never match `ASP.NET` — the character before the
  // dot is a letter.
  it('matches an entry that begins with punctuation', () => {
    expect(matchBlockedWord('ASP.NET Core developer', ['.net'])).toBe('.net');
  });

  it('returns the first matching entry and ignores blanks', () => {
    expect(matchBlockedWord('Node and PHP', ['  ', 'php', 'node'])).toBe('php');
  });

  it('returns null for an empty list', () => {
    expect(matchBlockedWord('anything', [])).toBeNull();
  });
});

describe('applyTitleFilter', () => {
  const p = {
    id: 'x', source: 's', externalId: 'x', url: 'https://e.com/x',
    title: 'Senior PHP Developer', company: 'C', location: 'Remote',
    employmentType: 'full-time', description: 'body text', raw: {},
  };

  it('rejects a blocked title and names the word in the rule', () => {
    expect(applyTitleFilter(p, ['php'])).toEqual({ passed: false, rule: 'title-word:php' });
  });

  it('passes a title with no blocked word', () => {
    expect(applyTitleFilter(p, ['ruby'])).toEqual({ passed: true });
  });

  it('ignores words that appear only outside the title', () => {
    expect(applyTitleFilter(p, ['body'])).toEqual({ passed: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest src/filters.spec.ts`
Expected: FAIL — `matchBlockedWord is not a function` / `applyTitleFilter is not a function`.

- [ ] **Step 3: Implement the matcher in `backend/src/filters.ts`**

Add above `applyHardFilters`:

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive, first match wins; returns the entry that
 * matched so the rejection can name it.
 *
 * The boundary is a lookaround over letters/digits rather than `\b`, and it is
 * applied only at the ends of the entry that ARE alphanumeric. `\b` would break
 * both directions: `\bc\+\+\b` never matches "C++ developer" because the
 * trailing `\b` demands a word character after the plus, and a leading boundary
 * on `.net` would never match "ASP.NET" because the preceding character is a
 * letter.
 */
export function matchBlockedWord(text: string, words: string[]): string | null {
  for (const word of words) {
    const entry = word.trim();
    if (entry === '') continue;

    const alnum = '[\\p{L}\\p{N}]';
    const lead = /^[\p{L}\p{N}]/u.test(entry) ? `(?<!${alnum})` : '';
    const tail = /[\p{L}\p{N}]$/u.test(entry) ? `(?!${alnum})` : '';

    if (new RegExp(`${lead}${escapeRegex(entry)}${tail}`, 'iu').test(text)) return word;
  }
  return null;
}

export function applyTitleFilter(posting: RawPosting, words: string[]): FilterResult {
  const hit = matchBlockedWord(posting.title, words);
  return hit ? { passed: false, rule: `title-word:${hit}` } : { passed: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/filters.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the description rule**

Add to `backend/src/filters.spec.ts`:

```ts
describe('applyHardFilters description words', () => {
  const profile = {
    excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null,
    timezone: 'Europe/Kyiv', blockedTitleWords: [], blockedDescriptionWords: [],
  };
  const p = {
    id: 'x', source: 's', externalId: 'x', url: 'https://e.com/x',
    title: 'Node Developer', company: 'C', location: 'Remote',
    employmentType: 'full-time', description: 'Relocation required to Berlin.', raw: {},
  };

  it('rejects a blocked description word and names it', () => {
    expect(applyHardFilters(p, profile, ['relocation required']))
      .toEqual({ passed: false, rule: 'description-word:relocation required' });
  });

  it('passes when no description word matches', () => {
    expect(applyHardFilters(p, profile, ['php'])).toEqual({ passed: true });
  });

  it('reports the location rule ahead of a description word', () => {
    const onsite = { ...p, location: 'Onsite: USA' };
    const strict = { ...profile, excludedLocations: ['onsite: usa'] };
    expect(applyHardFilters(onsite, strict, ['relocation required']))
      .toEqual({ passed: false, rule: 'location' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx jest src/filters.spec.ts -t "description words"`
Expected: FAIL — `applyHardFilters` currently takes two parameters, so the third
argument is ignored and the first case returns `{ passed: true }`.

- [ ] **Step 7: Add the third parameter and the rule**

In `backend/src/filters.ts`, change the signature and insert the rule after the
employment-type block and before the salary block. Placement is deliberate: a
blocked word is a more specific, more actionable rejection than a salary miss,
and both read `description`.

```ts
export function applyHardFilters(
  posting: RawPosting,
  profile: Profile,
  descriptionWords: string[],
): FilterResult {
  // ... existing location block unchanged ...
  // ... existing employmentType block unchanged ...

  const blocked = matchBlockedWord(posting.description, descriptionWords);
  if (blocked) return { passed: false, rule: `description-word:${blocked}` };

  // ... existing minSalaryUsd block unchanged ...

  return { passed: true };
}
```

- [ ] **Step 8: Add the two profile fields**

In `backend/src/settings/schema.ts`, extend `profileFields` (both `ProfileSchema`
and `ProfileBodySchema` are built from it, so the lenient and strict shapes
cannot drift):

```ts
const profileFields = {
  excludedLocations: z.array(z.string()),
  allowedEmploymentTypes: z.array(z.string()),
  minSalaryUsd: z.number().int().positive().nullable(),
  timezone: z.string(),
  blockedTitleWords: z.array(z.string()),
  blockedDescriptionWords: z.array(z.string()),
};
```

and add the defaults to `ProfileSchema`:

```ts
export const ProfileSchema = z.object({
  excludedLocations: profileFields.excludedLocations.default([]),
  allowedEmploymentTypes: profileFields.allowedEmploymentTypes.default([]),
  minSalaryUsd: profileFields.minSalaryUsd.default(null),
  timezone: profileFields.timezone.default('Europe/Kyiv'),
  blockedTitleWords: profileFields.blockedTitleWords.default([]),
  blockedDescriptionWords: profileFields.blockedDescriptionWords.default([]),
});
```

- [ ] **Step 9: Write the failing test for the jsonb read**

Add to `backend/src/settings/schema.spec.ts`:

```ts
it('defaults the blocked-word lists for a profile written before they existed', () => {
  const parsed = ProfileSchema.parse({
    excludedLocations: [], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
  });
  expect(parsed.blockedTitleWords).toEqual([]);
  expect(parsed.blockedDescriptionWords).toEqual([]);
});

it('requires both blocked-word lists on the wire', () => {
  const body = {
    excludedLocations: [], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
  };
  expect(ProfileBodySchema.safeParse(body).success).toBe(false);
  expect(ProfileBodySchema.safeParse({
    ...body, blockedTitleWords: ['php'], blockedDescriptionWords: [],
  }).success).toBe(true);
});
```

- [ ] **Step 10: Run it**

Run: `cd backend && npx jest src/settings/schema.spec.ts`
Expected: PASS (the schema change from Step 8 already satisfies both).

- [ ] **Step 11: Parse the profile in `SettingsService.load()`**

`backend/src/settings/settings.service.ts` currently returns `row.profile`
straight out of jsonb. An `app_settings` row written before Step 8 has no
blocked-word keys, so the arrays would be `undefined` and `matchBlockedWord`
would throw on `for (const word of undefined)`. Add the import and the parse:

```ts
import { ProfileSchema, type AppSettings } from './schema';

// ...
      profile: ProfileSchema.parse(row.profile),
```

Add a comment explaining why the parse is here — this is the one place a legacy
jsonb shape reaches the runtime, and the lenient schema's defaults exist for it.

- [ ] **Step 12: Update `DEFAULT_PROFILE` in the seeder**

`backend/src/settings/seed.ts`:

```ts
const DEFAULT_PROFILE = {
  excludedLocations: [],
  allowedEmploymentTypes: [],
  minSalaryUsd: null,
  timezone: 'Europe/Kyiv',
  blockedTitleWords: [],
  blockedDescriptionWords: [],
};
```

- [ ] **Step 13: Update the one `applyHardFilters` call site**

In `backend/src/pipeline/pipeline.service.ts`, the call inside `run()`:

```ts
const filter = applyHardFilters(posting, settings.profile, settings.profile.blockedDescriptionWords);
```

This is temporary shape only — Task 4 replaces it with the union of the global
and per-source lists.

- [ ] **Step 14: Fix the pipeline spec's settings fixture**

`backend/src/pipeline/pipeline.service.spec.ts` builds an `AppSettings` literal
whose `profile` now misses two required keys. Add them:

```ts
  profile: {
    excludedLocations: ['onsite: usa'], allowedEmploymentTypes: [],
    minSalaryUsd: null, timezone: 'Europe/Kyiv',
    blockedTitleWords: [], blockedDescriptionWords: [],
  },
```

- [ ] **Step 15: Run the whole unit suite**

Run: `cd backend && npm test`
Expected: PASS. If another spec constructs a `Profile` literal, add the two keys
there too — `npx tsc -p tsconfig.build.json --noEmit` will not catch spec files,
so rely on the Jest run's compile errors.

- [ ] **Step 16: Commit**

```bash
git add backend/src/filters.ts backend/src/filters.spec.ts \
  backend/src/settings/schema.ts backend/src/settings/schema.spec.ts \
  backend/src/settings/settings.service.ts backend/src/settings/seed.ts \
  backend/src/pipeline/pipeline.service.ts backend/src/pipeline/pipeline.service.spec.ts
git commit -m "feat: blocked-word matching and global blocklists in the profile"
```

---

### Task 2: The selector-driven adapter

Builds the new adapter alongside the old three without touching them, so this
task ends green and fully tested before anything is cut over.

**Files:**
- Create: `backend/src/sources/html.ts`
- Create: `backend/src/sources/custom.ts`
- Create: `backend/src/sources/custom.spec.ts`
- Modify: `backend/src/settings/schema.ts` (add `SelectorsSchema`, `SourceSpec`)
- Modify: `backend/src/sources/ats.ts:1-17` (import `htmlToText` instead of defining it)
- Modify: `backend/src/sources/ats.spec.ts` (import `htmlToText` from `./html`)
- Modify: `backend/src/types.ts:38-41` (`JobSource` gains optional `hydrate`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `SelectorsSchema` / `type Selectors` in `settings/schema.ts`
  - `interface SourceSpec { id, name, url, selectors, blockedTitleWords, blockedDescriptionWords }`
  - `htmlToText(html: string): string` in `sources/html.ts`
  - `createCustomSource(spec: SourceSpec, fetchFn?: FetchFn): JobSource`
  - `externalIdFrom(url: string): string`
  - `JobSource.hydrate?(posting: RawPosting): Promise<RawPosting>`

- [ ] **Step 1: Add the selector schema and spec type**

In `backend/src/settings/schema.ts`, above `SourcesSchema`:

```ts
/**
 * How to parse one listing page. `item` and `link` are the minimum needed to
 * produce a posting at all; everything else has a sensible fallback, because a
 * single-company careers page usually offers nothing but titles.
 *
 * Each value is a CSS selector handed to cheerio, so comma-separated
 * alternates work for free — which is how the deleted djinni adapter expressed
 * its markup fallbacks.
 */
export const SelectorsSchema = z.object({
  item: z.string().min(1),
  link: z.string().min(1),
  title: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  employmentType: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  /** Container on the POSTING page holding the description; absent = whole page. */
  detail: z.string().min(1).optional(),
}).strict();
export type Selectors = z.infer<typeof SelectorsSchema>;

/** One enabled source, as the pipeline sees it. */
export interface SourceSpec {
  id: string;
  name: string;
  url: string;
  selectors: Selectors;
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
}
```

- [ ] **Step 2: Write the failing schema tests**

Add to `backend/src/settings/schema.spec.ts`:

```ts
describe('SelectorsSchema', () => {
  it('requires item and link', () => {
    expect(SelectorsSchema.safeParse({ item: 'li' }).success).toBe(false);
    expect(SelectorsSchema.safeParse({ item: 'li', link: 'a' }).success).toBe(true);
  });

  it('rejects empty selector strings', () => {
    expect(SelectorsSchema.safeParse({ item: '', link: 'a' }).success).toBe(false);
  });

  it('rejects unknown keys so a typo is not silently ignored', () => {
    expect(SelectorsSchema.safeParse({ item: 'li', link: 'a', titel: 'h2' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd backend && npx jest src/settings/schema.spec.ts`
Expected: PASS (Step 1 satisfies it). Add the `SelectorsSchema` import to the
spec if it is missing.

- [ ] **Step 4: Move `htmlToText` into its own module**

Create `backend/src/sources/html.ts`:

```ts
import * as cheerio from 'cheerio';

/** Collapse an HTML document to a single line of whitespace-normalised text. */
export function htmlToText(html: string): string {
  return cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
}
```

In `backend/src/sources/ats.ts`, delete the local `htmlToText` and import it:

```ts
import { htmlToText } from './html';
```

In `backend/src/sources/ats.spec.ts`, change the `htmlToText` import to
`from './html'`.

- [ ] **Step 5: Run the moved-function tests**

Run: `cd backend && npx jest src/sources/ats.spec.ts`
Expected: PASS.

- [ ] **Step 6: Add `hydrate` to the `JobSource` contract**

In `backend/src/types.ts`:

```ts
export interface JobSource {
  readonly id: string;
  listPostings(): Promise<RawPosting[]>;
  /**
   * Fetch the posting's own page and fill in its description. Optional because
   * only the selector-driven adapter needs it; the pipeline calls it after the
   * dedup gate, so each posting costs exactly one detail request, once.
   */
  hydrate?(posting: RawPosting): Promise<RawPosting>;
}
```

- [ ] **Step 7: Write the failing adapter tests**

Create `backend/src/sources/custom.spec.ts`:

```ts
import { createCustomSource, externalIdFrom } from './custom';
import type { SourceSpec } from '../settings/schema';

const LISTING = `
<html><body>
  <ul>
    <li class="opening">
      <a class="t" href="/careers/123-senior-node">Senior Node Developer</a>
      <span class="loc">Remote, EU</span>
      <span class="type">Full-time</span>
      <p class="snip">Node, Postgres, $90,000</p>
    </li>
    <li class="opening">
      <a class="t" href="https://acme.com/careers/124-qa">QA Engineer</a>
      <span class="loc">Kyiv</span>
    </li>
    <li class="opening"><span>section header with no link</span></li>
    <li class="opening"><a class="t" href="/careers/125"></a></li>
  </ul>
</body></html>`;

const DETAIL = `
<html><body>
  <nav>site navigation</nav>
  <div class="jd">  We need a  Node engineer.
  Salary $120,000. </div>
</body></html>`;

function spec(over: Partial<SourceSpec> = {}): SourceSpec {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: {
      item: 'li.opening', link: 'a.t', location: 'span.loc',
      employmentType: 'span.type', description: 'p.snip',
    },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    ...over,
  };
}

function fetchOk(body: string) {
  return async () => ({ ok: true, status: 200, text: async () => body } as unknown as Response);
}

describe('createCustomSource.listPostings', () => {
  it('uses the source name as the adapter id, so run_log names the board', () => {
    expect(createCustomSource(spec(), fetchOk(LISTING)).id).toBe('Acme');
  });

  it('extracts one posting per item selector match', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out).toHaveLength(2);
  });

  it('resolves a relative href against the listing URL', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.url).toBe('https://acme.com/careers/123-senior-node');
  });

  it('leaves an absolute href alone', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[1]!.url).toBe('https://acme.com/careers/124-qa');
  });

  it('keys the posting id on the source uuid, not its name', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.id).toBe('src:11111111-1111-1111-1111-111111111111:/careers/123-senior-node');
  });

  it('takes the title from the link text when no title selector is given', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.title).toBe('Senior Node Developer');
  });

  it('falls back to the source name for company', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.company).toBe('Acme');
  });

  it('reads the optional selectors when present and nulls them when absent', async () => {
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out[0]!.location).toBe('Remote, EU');
    expect(out[0]!.employmentType).toBe('Full-time');
    expect(out[0]!.description).toBe('Node, Postgres, $90,000');
    expect(out[1]!.location).toBe('Kyiv');
    expect(out[1]!.employmentType).toBeNull();
    expect(out[1]!.description).toBe('');
  });

  it('skips items with no link and items with an empty title', async () => {
    // The third and fourth <li> match `item` but are not postings. A listing
    // page almost always has one or two of these.
    const out = await createCustomSource(spec(), fetchOk(LISTING)).listPostings();
    expect(out.map((p) => p.title)).toEqual(['Senior Node Developer', 'QA Engineer']);
  });

  it('names the source and URL when the listing request fails', async () => {
    const bad = async () => ({ ok: false, status: 503, text: async () => '' } as unknown as Response);
    await expect(createCustomSource(spec(), bad).listPostings())
      .rejects.toThrow('Acme returned HTTP 503 for https://acme.com/careers');
  });
});

describe('externalIdFrom', () => {
  it('uses the pathname with any trailing slash removed', () => {
    expect(externalIdFrom('https://acme.com/careers/123-node/')).toBe('/careers/123-node');
  });

  it('keeps the query string, because some boards put the id there', () => {
    expect(externalIdFrom('https://acme.com/job?id=42')).toBe('/job?id=42');
  });
});

describe('createCustomSource.hydrate', () => {
  const listed = {
    id: 'src:x:1', source: 'Acme', externalId: '1', url: 'https://acme.com/careers/123',
    title: 'T', company: 'Acme', location: null, employmentType: null,
    description: 'listing snippet', raw: {},
  };

  it('replaces the description with the detail selector text', async () => {
    const s = createCustomSource(spec({ selectors: { ...spec().selectors, detail: 'div.jd' } }), fetchOk(DETAIL));
    const out = await s.hydrate!(listed);
    expect(out.description).toBe('We need a Node engineer. Salary $120,000.');
  });

  it('uses the whole page text when no detail selector is given', async () => {
    const out = await createCustomSource(spec(), fetchOk(DETAIL)).hydrate!(listed);
    expect(out.description).toContain('site navigation');
    expect(out.description).toContain('Node engineer');
  });

  it('keeps the listing snippet when the detail selector matches nothing', async () => {
    const s = createCustomSource(spec({ selectors: { ...spec().selectors, detail: 'div.missing' } }), fetchOk(DETAIL));
    expect((await s.hydrate!(listed)).description).toBe('listing snippet');
  });

  it('leaves every other field untouched', async () => {
    const out = await createCustomSource(spec(), fetchOk(DETAIL)).hydrate!(listed);
    expect({ ...out, description: listed.description }).toEqual(listed);
  });

  it('throws naming the posting URL when the detail request fails', async () => {
    const bad = async () => ({ ok: false, status: 404, text: async () => '' } as unknown as Response);
    await expect(createCustomSource(spec(), bad).hydrate!(listed))
      .rejects.toThrow('Acme detail returned HTTP 404 for https://acme.com/careers/123');
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd backend && npx jest src/sources/custom.spec.ts`
Expected: FAIL — `Cannot find module './custom'`.

- [ ] **Step 9: Implement the adapter**

Create `backend/src/sources/custom.ts`:

```ts
import * as cheerio from 'cheerio';
import { htmlToText } from './html';
import type { FetchFn, JobSource, RawPosting } from '../types';
import type { SourceSpec } from '../settings/schema';

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * A stable per-source identifier for a posting. The pathname alone is not
 * enough: a board that addresses postings as `/job?id=42` would collapse every
 * posting onto one id and the pipeline would score exactly one of them.
 */
export function externalIdFrom(url: string): string {
  const u = new URL(url);
  return `${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

export function createCustomSource(spec: SourceSpec, fetchFn: FetchFn = fetch): JobSource {
  const { selectors } = spec;

  return {
    id: spec.name,

    async listPostings(): Promise<RawPosting[]> {
      const res = await fetchFn(spec.url);
      if (!res.ok) {
        throw new Error(`${spec.name} returned HTTP ${res.status} for ${spec.url}`);
      }
      const $ = cheerio.load(await res.text());
      const out: RawPosting[] = [];

      $(selectors.item).each((_, el) => {
        const node = $(el);

        // An optional selector yields null when unset OR when it matches
        // nothing, so callers get one "absent" case instead of two.
        const pick = (sel?: string): string | null => {
          if (!sel) return null;
          const text = clean(node.find(sel).first().text());
          return text === '' ? null : text;
        };

        const link = node.find(selectors.link).first();
        const href = link.attr('href');
        if (!href) return;

        let url: string;
        try {
          url = new URL(href, spec.url).toString();
        } catch {
          return;
        }

        // Most boards put the title in the link itself; the selector exists for
        // the ones that do not.
        const title = pick(selectors.title) ?? clean(link.text());
        if (title === '') return;

        const externalId = externalIdFrom(url);

        out.push({
          id: `src:${spec.id}:${externalId}`,
          source: spec.name,
          externalId,
          url,
          title,
          // Right for a single-company careers page, which is the common case;
          // the selector is for aggregators.
          company: pick(selectors.company) ?? spec.name,
          location: pick(selectors.location),
          employmentType: pick(selectors.employmentType),
          description: pick(selectors.description) ?? '',
          raw: { html: node.html() },
        });
      });

      return out;
    },

    async hydrate(posting: RawPosting): Promise<RawPosting> {
      const res = await fetchFn(posting.url);
      if (!res.ok) {
        throw new Error(`${spec.name} detail returned HTTP ${res.status} for ${posting.url}`);
      }
      const html = await res.text();

      const description = selectors.detail
        ? clean(cheerio.load(html)(selectors.detail).text())
        : htmlToText(html);

      // A detail selector that matches nothing must not blank out whatever the
      // listing gave us — that would be a silent downgrade.
      return { ...posting, description: description === '' ? posting.description : description };
    },
  };
}
```

- [ ] **Step 10: Run the adapter tests**

Run: `cd backend && npx jest src/sources/custom.spec.ts`
Expected: PASS, all cases.

- [ ] **Step 11: Run the full unit suite and the build**

Run: `cd backend && npm test && npx tsc -p tsconfig.build.json --noEmit`
Expected: both clean. Nothing has been removed yet.

- [ ] **Step 12: Commit**

```bash
git add backend/src/sources/html.ts backend/src/sources/custom.ts \
  backend/src/sources/custom.spec.ts backend/src/sources/ats.ts \
  backend/src/sources/ats.spec.ts backend/src/settings/schema.ts \
  backend/src/settings/schema.spec.ts backend/src/types.ts
git commit -m "feat: selector-driven source adapter with detail-page hydration"
```

---

### Task 3: Data-layer cutover

The one unavoidably wide task: the `sources` table, the migration, and every
module that reads its shape change together, because none of them compiles
against the other's old form. Behaviour changes (the title gate, the hydrate
call) are deliberately held back to Task 4 — this task is the type and storage
cutover, and its gate is that the *existing* tests still pass.

**Files:**
- Modify: `backend/src/db/schema.ts:58` (delete `sourceKindEnum`), `:84-100` (the table)
- Create: `backend/drizzle/0003_<name>.sql` (generated, then hand-edited)
- Modify: `backend/drizzle/meta/_journal.json` (generated)
- Create: `backend/src/settings/to-source-specs.ts`
- Delete: `backend/src/settings/to-sources-config.ts`, `backend/src/settings/to-sources-config.spec.ts`
- Create: `backend/src/settings/to-source-specs.spec.ts`
- Modify: `backend/src/settings/schema.ts` (delete `SourcesSchema`, flatten `SourceInputSchema`, drop `sources` from `FileConfig`, `AppSettings.sources`)
- Modify: `backend/src/settings/settings.repository.ts:66-77` (`addSource`)
- Modify: `backend/src/settings/settings.service.ts`
- Modify: `backend/src/settings/import.ts:29-36`
- Modify: `backend/src/settings/seed.ts:65-74`
- Modify: `backend/src/sources/sources.factory.ts`
- Modify: `backend/src/sources/sources.module.ts`
- Modify: `backend/src/pipeline/pipeline.service.ts:36-40` (`incompleteReason`), `:87-90`
- Test: `backend/src/settings/import.spec.ts`, `backend/src/sources/sources.factory.spec.ts`, `backend/src/pipeline/pipeline.service.spec.ts`

**Interfaces:**
- Consumes: `SourceSpec`, `Selectors`, `SelectorsSchema`, `createCustomSource` (Task 2).
- Produces:
  - `SourceInputSchema` — flat: `{ name, url, selectors, blockedTitleWords, blockedDescriptionWords }`
  - `toSourceSpecs(rows: SourceRow[]): SourceSpec[]`
  - `AppSettings.sources: SourceSpec[]`
  - `BUILD_SOURCE` token, `type BuildSource = (spec: SourceSpec) => JobSource`
  - `SourceRow = typeof sources.$inferSelect` re-exported from `to-source-specs.ts`

- [ ] **Step 1: Rewrite the table in `backend/src/db/schema.ts`**

Delete the `sourceKindEnum` declaration entirely and replace the `sources` table
with:

```ts
export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Also the value written to postings.source and used as JobSource.id, which
  // is what run_log records — hence unique, so a failing board is identifiable.
  name: text('name').notNull(),
  url: text('url').notNull(),
  selectors: jsonb('selectors').$type<Selectors>().notNull(),
  blockedTitleWords: text('blocked_title_words').array().notNull().default(sql`'{}'::text[]`),
  blockedDescriptionWords: text('blocked_description_words').array().notNull().default(sql`'{}'::text[]`),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('sources_url_uniq').on(t.url),
  unique('sources_name_uniq').on(t.name),
]);
```

Update the imports at the top of the file: add
`import type { Selectors } from '../settings/schema';`, drop `pgEnum` and `check`
if the file has no other user of them (it still uses `check` for `app_settings` —
verify before deleting), and keep `sql`.

- [ ] **Step 2: Generate the migration**

Run: `cd backend && npm run generate`
Expected: a new `drizzle/0003_*.sql` plus a `meta/_journal.json` entry. Read the
generated SQL.

- [ ] **Step 3: Hand-edit the generated SQL**

drizzle cannot know that the existing rows must go, and `name`/`selectors` are
`NOT NULL` with nothing to backfill them from. Put this as the **first**
statement of the file:

```sql
DELETE FROM "sources";--> statement-breakpoint
```

Then read the rest and confirm it contains, in this order: the three constraint
drops (`sources_ats_has_board_and_slug`, `sources_url_only_for_non_ats`,
`sources_identity_uniq`), the three column drops (`kind`, `board`, `slug`),
`DROP TYPE "public"."source_kind"`, the four column additions, the
`ALTER COLUMN "url" SET NOT NULL`, and the two unique constraints. Add by hand
anything drizzle omitted — it commonly skips the enum type drop. Use
`DROP CONSTRAINT IF EXISTS` for the three old constraints so the migration is
safe on a database that never had them.

- [ ] **Step 4: Apply the migration against a scratch database**

```bash
cd backend && docker-compose up -d db && docker-compose run --rm migrate
```
Expected: `migrations applied successfully` and the seeder logging
`{"event":"settings.seed","outcome":"already-present"}` or `seeded-defaults`.
Then confirm the shape and that postings survived:

```bash
docker-compose exec db psql -U jobradar -d jobradar -c '\d sources' \
  -c 'select count(*) from postings;'
```
Expected: the new columns, both unique constraints, no `kind`/`board`/`slug`, and
a non-zero posting count if the database had one before.

- [ ] **Step 5: Write the failing `toSourceSpecs` test**

Create `backend/src/settings/to-source-specs.spec.ts`:

```ts
import { toSourceSpecs } from './to-source-specs';
import type { SourceRow } from './to-source-specs';

function row(over: Partial<SourceRow> = {}): SourceRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Acme',
    url: 'https://acme.com/careers',
    selectors: { item: 'li', link: 'a' },
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as SourceRow;
}

describe('toSourceSpecs', () => {
  it('drops disabled rows so callers never have to filter', () => {
    const out = toSourceSpecs([row(), row({ id: 'b', name: 'B', url: 'u', enabled: false })]);
    expect(out.map((s) => s.name)).toEqual(['Acme']);
  });

  it('carries the id, selectors and per-source word lists through', () => {
    const out = toSourceSpecs([row({ blockedTitleWords: ['intern'], blockedDescriptionWords: ['onsite'] })]);
    expect(out[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme',
      url: 'https://acme.com/careers',
      selectors: { item: 'li', link: 'a' },
      blockedTitleWords: ['intern'],
      blockedDescriptionWords: ['onsite'],
    });
  });

  it('returns an empty list for no rows', () => {
    expect(toSourceSpecs([])).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx jest src/settings/to-source-specs.spec.ts`
Expected: FAIL — `Cannot find module './to-source-specs'`.

- [ ] **Step 7: Implement it and delete its predecessor**

Create `backend/src/settings/to-source-specs.ts`:

```ts
import type { sources } from '../db/schema';
import type { SourceSpec } from './schema';

export type SourceRow = typeof sources.$inferSelect;

/**
 * The table is flat because the dashboard needs rows to toggle; the pipeline
 * wants only the enabled ones. This is the seam, and dropping the disabled rows
 * here means no caller has to remember to filter.
 */
export function toSourceSpecs(rows: SourceRow[]): SourceSpec[] {
  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      selectors: r.selectors,
      blockedTitleWords: r.blockedTitleWords,
      blockedDescriptionWords: r.blockedDescriptionWords,
    }));
}
```

```bash
git rm backend/src/settings/to-sources-config.ts backend/src/settings/to-sources-config.spec.ts
```

- [ ] **Step 8: Run it**

Run: `cd backend && npx jest src/settings/to-source-specs.spec.ts`
Expected: PASS.

- [ ] **Step 9: Flatten `SourceInputSchema` and drop `SourcesSchema`**

In `backend/src/settings/schema.ts`: delete `SourcesSchema` and
`type SourcesConfig` outright, and replace the discriminated
`SourceInputSchema` with:

```ts
export const SourceInputSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  selectors: SelectorsSchema,
  blockedTitleWords: z.array(z.string()).default([]),
  blockedDescriptionWords: z.array(z.string()).default([]),
}).strict();
export type SourceInput = z.infer<typeof SourceInputSchema>;
```

Change `AppSettings.sources` to `SourceSpec[]` and remove the `sources` key from
`FileConfig` — a v1 `sources.yaml` has no selectors, so it cannot produce a
usable row. Update `FileConfig`'s doc comment to say so.

- [ ] **Step 10: Update the repository**

In `backend/src/settings/settings.repository.ts`, change the `SourceRow` import
to `from './to-source-specs'` and replace `addSource`:

```ts
  async addSource(input: SourceInput): Promise<SourceRow> {
    try {
      const [row] = await this.db.insert(sources).values(input).returning();
      return row!;
    } catch (err) {
      throw unwrapDriverError(err);
    }
  }
```

`input` is already exactly the column set, both word arrays defaulted by Zod, so
no mapping is needed. Leave `setSourceEnabled` and `deleteSource` alone.

- [ ] **Step 11: Update `SettingsService.load()`**

```ts
import { toSourceSpecs } from './to-source-specs';
// ...
      sources: toSourceSpecs(sourceRows),
```

- [ ] **Step 12: Update the importer and the seeder**

In `backend/src/settings/import.ts`, drop the `sources` key from the returned
object and remove the `SourcesSchema` import, leaving a comment: the v1
`sources.yaml` has no selectors, so an upgrading install re-adds its boards
through the dashboard.

In `backend/src/settings/seed.ts`, delete the `if (file) { ... }` block that
inserted source rows and remove the now-unused `sources` import. The transaction
still wraps the guard and the one insert; keep the comment explaining why.

Update `backend/src/settings/import.spec.ts`: remove assertions about parsed
sources, and add one asserting a `sources.yaml` present on disk is ignored.

- [ ] **Step 13: Retype the factory and its DI token**

Replace `backend/src/sources/sources.factory.ts` with:

```ts
import type { SourceSpec } from '../settings/schema';
import type { JobSource } from '../types';
import { createCustomSource } from './custom';

/**
 * One adapter per spec. Per-spec rather than per-run because the pipeline needs
 * each source's own blocklists alongside its adapter, and zipping two arrays by
 * index to recover that pairing is a bug waiting to happen.
 */
export function buildSource(spec: SourceSpec): JobSource {
  return createCustomSource(spec);
}
```

And `backend/src/sources/sources.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { buildSource } from './sources.factory';
import type { JobSource } from '../types';
import type { SourceSpec } from '../settings/schema';

export type BuildSource = (spec: SourceSpec) => JobSource;

/**
 * A factory, not a prebuilt array: sources are editable at runtime, so adapters
 * are constructed per run from the current snapshot. Keeping it a DI token
 * rather than a direct import preserves the seam the pipeline tests use to
 * inject fake sources.
 */
export const BUILD_SOURCE = Symbol('BUILD_SOURCE');

@Module({
  providers: [{ provide: BUILD_SOURCE, useValue: buildSource satisfies BuildSource }],
  exports: [BUILD_SOURCE],
})
export class SourcesModule {}
```

Rewrite `backend/src/sources/sources.factory.spec.ts` to assert `buildSource`
returns an adapter whose `id` is the spec's name and which exposes `hydrate`.

- [ ] **Step 14: Retype the pipeline (mechanical only)**

In `backend/src/pipeline/pipeline.service.ts`:

```ts
import { BUILD_SOURCE, type BuildSource } from '../sources/sources.module';
// constructor:
    @Inject(BUILD_SOURCE) private readonly buildSource: BuildSource,
```

`incompleteReason`:

```ts
export function incompleteReason(s: AppSettings): string | null {
  if (s.cv.trim() === '') return 'no CV';
  if (s.sources.length === 0) return 'no enabled sources';
  return null;
}
```

and the loop head — keep the body exactly as it is for now:

```ts
    for (const spec of settings.sources) {
      const source = this.buildSource(spec);
```

Update the spec's `settings` fixture and its `build()` helper: `sources` becomes
a `SourceSpec[]`, and the injected fake resolves a spec to a fake `JobSource`:

```ts
  { provide: BUILD_SOURCE, useValue: (spec: SourceSpec) => byName.get(spec.name)! },
```

where `byName` is a `Map` built from the fake sources the test passes in. Give
each fixture spec a matching `name`.

- [ ] **Step 15: Run the full suite and the build**

Run: `cd backend && npm test && npx tsc -p tsconfig.build.json --noEmit`
Expected: both clean. Every existing behavioural test still passes — this task
changed types and storage, not behaviour.

- [ ] **Step 16: Commit**

```bash
git add -A backend/src backend/drizzle
git commit -m "refactor!: sources are name + url + selectors, with no kind"
```

---

### Task 4: Pipeline gating and hydration

**Files:**
- Modify: `backend/src/pipeline/pipeline.service.ts:100-130` (the per-posting body)
- Test: `backend/src/pipeline/pipeline.service.spec.ts`

**Interfaces:**
- Consumes: `applyTitleFilter`, `applyHardFilters(p, profile, words)` (Task 1);
  `JobSource.hydrate` (Task 2); `SourceSpec`, `BUILD_SOURCE` (Task 3).
- Produces: no new exports; `RunSummary` keeps its existing shape, with a
  title-word rejection counted in `hardFiltered` and a hydrate failure in
  `sourceErrors`.

- [ ] **Step 1: Write the failing pipeline tests**

Add to `backend/src/pipeline/pipeline.service.spec.ts`. These assume the
`build()` helper from Task 3 Step 14; extend it to accept per-spec word lists.

```ts
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
    const classify = jest.fn(async () => ({
      total: 80, verdict: 'STRONG', subscores: {}, reasoning: 'ok',
      providerId: 'fake', settingsVersion: '1',
    }));
    const { service, repo } = await build({ sources: [src], classify });

    await service.run();

    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(repo.upsert).toHaveBeenCalledTimes(2);
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
```

Add the `withProfile` helper next to the existing `settings` fixture:

```ts
function withProfile(over: Partial<AppSettings['profile']>): AppSettings {
  return { ...settings, profile: { ...settings.profile, ...over } };
}
```

and extend `build()` with an optional `specs` override that patches the fixture's
`SourceSpec[]` by name, so a test can give one source its own word lists.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/pipeline/pipeline.service.spec.ts -t "blocklists and hydration"`
Expected: FAIL — hydrate is never called and no title rule exists.

- [ ] **Step 3: Extract the hard-filter score row**

The insert is about to appear twice, so lift it out first. Add a private method
to `PipelineService`:

```ts
  private recordHardFilter(postingId: string, rule: string, settingsVersion: string): Promise<number> {
    return this.repo.insertScore(postingId, {
      total: 0, verdict: 'NO', subscores: ZERO_SUBSCORES,
      reasoning: `hard-filter:${rule}`,
      providerId: 'hard-filter', settingsVersion,
    });
  }
```

and replace the existing inline insert in `run()` with a call to it.

- [ ] **Step 4: Implement the new ordering**

Replace the per-posting body of `run()` with:

```ts
    for (const spec of settings.sources) {
      const source = this.buildSource(spec);

      // A source may add words but never subtract them: the global lists are
      // the floor.
      const titleWords = [...settings.profile.blockedTitleWords, ...spec.blockedTitleWords];
      const descriptionWords = [
        ...settings.profile.blockedDescriptionWords, ...spec.blockedDescriptionWords,
      ];

      let postings: RawPosting[];
      try {
        postings = await source.listPostings();
        await this.repo.logRun(source.id, 'ok', postings.length);
      } catch (err) {
        s.sourceErrors += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`source ${source.id} failed: ${msg}`);
        await this.repo.logRun(source.id, 'error', 0, msg);
        continue;
      }

      for (const listed of postings) {
        s.fetched += 1;

        // Always upsert so last_seen advances, but decide on the score row:
        // a posting whose classification threw has none, and must be retried.
        await this.repo.upsert(listed);
        if (await this.repo.hasScore(listed.id)) { s.skippedDuplicate += 1; continue; }

        // Before the detail fetch on purpose — a title we already reject is not
        // worth a request.
        const byTitle = applyTitleFilter(listed, titleWords);
        if (!byTitle.passed) {
          s.hardFiltered += 1;
          await this.recordHardFilter(listed.id, byTitle.rule, settings.rubric.version);
          continue;
        }

        // After the dedup gate, so a posting's detail page is fetched once ever;
        // before the hard filters, because the salary rule reads `description`
        // and a listing snippet rarely carries one.
        let posting = listed;
        if (source.hydrate) {
          try {
            posting = await source.hydrate(listed);
            await this.repo.upsert(posting);
          } catch (err) {
            s.sourceErrors += 1;
            const msg = err instanceof Error ? err.message : String(err);
            this.log.error(`hydrate failed for ${listed.id}: ${msg}`);
            await this.repo.logRun(source.id, 'error', 0, msg);
            continue;
          }
        }

        const filter = applyHardFilters(posting, settings.profile, descriptionWords);
        if (!filter.passed) {
          s.hardFiltered += 1;
          await this.recordHardFilter(posting.id, filter.rule, settings.rubric.version);
          continue;
        }

        try {
          await this.repo.insertScore(posting.id, await this.classifier.classify(posting, settings));
          s.classified += 1;
        } catch (err) {
          s.classifyErrors += 1;
          this.log.warn(`classify failed for ${posting.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
```

Add `applyTitleFilter` to the `../filters` import.

- [ ] **Step 5: Run the pipeline spec**

Run: `cd backend && npx jest src/pipeline/pipeline.service.spec.ts`
Expected: PASS, new cases and old.

- [ ] **Step 6: Run everything**

Run: `cd backend && npm test && npx tsc -p tsconfig.build.json --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/pipeline/pipeline.service.ts backend/src/pipeline/pipeline.service.spec.ts
git commit -m "feat: title blocklist gate before the detail fetch, description blocklist after"
```

---

### Task 5: `PUT /api/sources/:id`

Editing in place is what makes selectors tunable: a selector that stops matching
is fixed without losing the board's posting history.

**Files:**
- Modify: `backend/src/settings/settings.repository.ts` (add `replaceSource`)
- Modify: `backend/src/settings/sources.controller.ts`
- Test: `backend/src/settings/sources.controller.spec.ts`

**Interfaces:**
- Consumes: `SourceInput`, `SourceInputSchema` (Task 3).
- Produces: `SettingsRepository.replaceSource(id: string, input: SourceInput): Promise<SourceRow | null>`
  — `null` when no row has that id. Does **not** touch `enabled`.

- [ ] **Step 1: Write the failing controller tests**

Add to `backend/src/settings/sources.controller.spec.ts`, following whatever fake
repository the existing cases in that file use:

```ts
const INPUT = {
  name: 'Acme', url: 'https://acme.com/careers',
  selectors: { item: 'li.opening', link: 'a.t' },
  blockedTitleWords: [], blockedDescriptionWords: [],
};

it('replaces a row and returns it', async () => {
  const repo = { replaceSource: jest.fn(async () => ({ id: 'u1', ...INPUT, enabled: true })) };
  const controller = new SourcesController(repo as any);
  await expect(controller.replace('u1', INPUT as any)).resolves.toEqual({
    source: { id: 'u1', ...INPUT, enabled: true },
  });
  expect(repo.replaceSource).toHaveBeenCalledWith('u1', INPUT);
});

it('404s when no row has that id', async () => {
  const repo = { replaceSource: jest.fn(async () => null) };
  const controller = new SourcesController(repo as any);
  await expect(controller.replace('u1', INPUT as any)).rejects.toThrow(NotFoundException);
});

it('409s naming the URL when the url collides', async () => {
  const err = Object.assign(new Error('dup'), { code: '23505', constraint_name: 'sources_url_uniq' });
  const repo = { replaceSource: jest.fn(async () => { throw err; }) };
  const controller = new SourcesController(repo as any);
  await expect(controller.replace('u1', INPUT as any))
    .rejects.toThrow('Another source already uses that URL');
});

it('409s naming the name when the name collides', async () => {
  const err = Object.assign(new Error('dup'), { code: '23505', constraint_name: 'sources_name_uniq' });
  const repo = { addSource: jest.fn(async () => { throw err; }) };
  const controller = new SourcesController(repo as any);
  await expect(controller.create(INPUT as any))
    .rejects.toThrow('Another source already uses that name');
});
```

`postgres` exposes the violated constraint as `constraint_name`; older drivers
and node-postgres use `constraint`. The controller reads both (Step 4), so both
spellings are covered and neither test is driver-specific. Task 6 Step 5 asserts
which one the installed driver actually sets, against a real database.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/settings/sources.controller.spec.ts`
Expected: FAIL — `controller.replace is not a function`.

- [ ] **Step 3: Add `replaceSource` to the repository**

```ts
  /**
   * Replaces the row's whole document, `enabled` excepted — the checkbox owns
   * that through PATCH, so a form save cannot silently re-enable a paused
   * board.
   */
  async replaceSource(id: string, input: SourceInput): Promise<SourceRow | null> {
    try {
      const [row] = await this.db
        .update(sources).set(input).where(eq(sources.id, id)).returning();
      return row ?? null;
    } catch (err) {
      throw unwrapDriverError(err);
    }
  }
```

- [ ] **Step 4: Add the endpoint and share the conflict mapping**

In `backend/src/settings/sources.controller.ts`, replace the inline `catch` in
`create` with a shared helper and add `replace`:

```ts
/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

function conflictOf(err: unknown): ConflictException | null {
  const e = err as { code?: string; constraint_name?: string; constraint?: string };
  if (e.code !== UNIQUE_VIOLATION) return null;
  const constraint = e.constraint_name ?? e.constraint ?? '';
  return new ConflictException(
    constraint.includes('name')
      ? 'Another source already uses that name'
      : 'Another source already uses that URL',
  );
}
```

```ts
  @Post()
  async create(@Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput) {
    try {
      return { source: await this.repo.addSource(input) };
    } catch (err) {
      throw conflictOf(err) ?? err;
    }
  }

  @Put(':id')
  async replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput,
  ) {
    let source;
    try {
      source = await this.repo.replaceSource(id, input);
    } catch (err) {
      throw conflictOf(err) ?? err;
    }
    if (!source) throw new NotFoundException('No such source');
    return { source };
  }
```

Add `Put` to the `@nestjs/common` import list.

- [ ] **Step 5: Run the controller spec**

Run: `cd backend && npx jest src/settings/sources.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Run everything**

Run: `cd backend && npm test && npx tsc -p tsconfig.build.json --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/settings/settings.repository.ts \
  backend/src/settings/sources.controller.ts backend/src/settings/sources.controller.spec.ts
git commit -m "feat: PUT /api/sources/:id replaces a source in place"
```

---

### Task 6: Delete the dead adapters and update the integration suites

**Files:**
- Delete: `backend/src/sources/ats.ts`, `ats.spec.ts`, `djinni.ts`, `djinni.spec.ts`, `dou.ts`, `dou.spec.ts`
- Create: `backend/src/sources/html.spec.ts`
- Modify: `backend/test/integration/sources.integration.test.ts`
- Modify: `backend/test/integration/settings.schema.integration.test.ts`
- Modify: `backend/test/integration/settings.repository.integration.test.ts`
- Modify: `backend/test/integration/seed.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5. Produces nothing new.

- [ ] **Step 1: Rescue the `htmlToText` cases before deleting `ats.spec.ts`**

Create `backend/src/sources/html.spec.ts` and move the `htmlToText` describe
block from `ats.spec.ts` into it verbatim, changing the import to `./html`.

Run: `cd backend && npx jest src/sources/html.spec.ts`
Expected: PASS.

- [ ] **Step 2: Record the Djinni and DOU selectors before deleting them**

Before removing the files, copy their selector constants into a scratch note —
Task 11's feature doc publishes them as the copy-paste reference for re-adding
those two boards. From `djinni.ts`:

```
item:        div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]
link:        a.job_item__header-link, a.job-item__title-link, a.job-list-item__link
title:       h2.job-item__position, .job-item__position
company:     header .text-gray-800, a.js-analytics-event, .job-list-item__company
location:    .location-text
description: div.fw-medium, .job-list-item__job-info, .job-item__description
```

From `dou.ts`:

```
item:        li.l-vacancy
link:        a.vt
company:     a.company
location:    span.cities
description: div.sh-info
```

- [ ] **Step 3: Delete the adapters**

```bash
cd /Users/ykravchenko/www/JobRadar
git rm backend/src/sources/ats.ts backend/src/sources/ats.spec.ts \
  backend/src/sources/djinni.ts backend/src/sources/djinni.spec.ts \
  backend/src/sources/dou.ts backend/src/sources/dou.spec.ts
```

- [ ] **Step 4: Rewrite the live-source integration suite**

`backend/test/integration/sources.integration.test.ts` imports all three deleted
adapters. Its purpose — "do the real selectors still parse?" — no longer belongs
in code, because the selectors are now data. Replace it with a suite that proves
the generic adapter works against a real page, using the recorded Djinni
selectors from Step 2:

```ts
import { describe, it, expect } from 'vitest';
import { createCustomSource } from '../../src/sources/custom';

// Run with: INTEGRATION=1 npm run test:integration
describe.skipIf(!process.env.INTEGRATION)('live sources', () => {
  it('parses a real listing page from stored selectors', async () => {
    const source = createCustomSource({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Djinni',
      url: 'https://djinni.co/jobs/keyword-node/',
      selectors: {
        item: 'div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]',
        link: 'a.job_item__header-link, a.job-item__title-link, a.job-list-item__link',
        title: 'h2.job-item__position, .job-item__position',
        company: 'header .text-gray-800, a.js-analytics-event, .job-list-item__company',
        location: '.location-text',
        description: 'div.fw-medium, .job-list-item__job-info, .job-item__description',
      },
      blockedTitleWords: [],
      blockedDescriptionWords: [],
    });

    const out = await source.listPostings();
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.title.length).toBeGreaterThan(0);
    expect(out[0]!.url).toMatch(/^https:\/\/djinni\.co\//);
    expect(out[0]!.source).toBe('Djinni');
  }, 30_000);

  it('hydrates a real posting page', async () => {
    // Two hops on purpose: hydrate is the step no unit test can prove against
    // a live site.
    const source = createCustomSource({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Djinni',
      url: 'https://djinni.co/jobs/keyword-node/',
      selectors: {
        item: 'div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]',
        link: 'a.job_item__header-link, a.job-item__title-link, a.job-list-item__link',
      },
      blockedTitleWords: [],
      blockedDescriptionWords: [],
    });

    const [first] = await source.listPostings();
    const full = await source.hydrate!(first!);
    expect(full.description.length).toBeGreaterThan(first!.description.length);
  }, 30_000);
});
```

- [ ] **Step 5: Update the three database integration suites**

In each of `settings.schema.integration.test.ts`,
`settings.repository.integration.test.ts` and `seed.integration.test.ts`:

- add `blockedTitleWords: []` and `blockedDescriptionWords: []` to every
  `PROFILE` literal
- replace every `sources` insert with the new column set
  (`{ name, url, selectors }`)
- delete assertions about `kind` / `board` / `slug` and the two dropped check
  constraints
- add a case asserting a duplicate `url` insert raises `23505` with
  `sources_url_uniq`, and the same for `name` / `sources_name_uniq` — note which
  property carries the constraint name, and reconcile Task 5 Step 1's
  `constraint_name ?? constraint` fallback with what you observe
- add a case asserting `replaceSource` rewrites `selectors` and leaves `enabled`
  untouched
- in `seed.integration.test.ts`, replace any "imports sources from files" case
  with one asserting a `/config` directory containing `sources.yaml` seeds
  **no** source rows

- [ ] **Step 6: Run both suites**

```bash
cd backend
npm test
DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar npm run test:integration
INTEGRATION=1 npm run test:integration
```
Expected: unit green; the database suites green against the migrated schema; the
live suite green, or a clearly reported network/selector failure if Djinni's
markup has moved. If the live one fails on markup, that is now a data problem —
record the working selectors and move on; do not add fallbacks to the adapter.

- [ ] **Step 7: Commit**

```bash
git add -A backend/src/sources backend/test/integration
git commit -m "refactor: delete the ats, djinni and dou adapters"
```

---

### Task 7: Dashboard types and API client

**Files:**
- Modify: `dashboard/src/api/types.ts:44-73`
- Modify: `dashboard/src/api/settings.ts`
- Test: `dashboard/tests/settings-client.test.ts`

**Interfaces:**
- Consumes: the wire shapes from Tasks 3 and 5.
- Produces:
  - `interface Selectors`, `interface SourceRow`, `type SourceInput`
  - `ProfileInput` gains both word arrays
  - `updateSource(id: string, input: SourceInput, fetchFn?): Promise<SourceRow>`

- [ ] **Step 1: Rewrite the source types**

In `dashboard/src/api/types.ts`, delete `SourceKind` and replace `SourceRow` and
`SourceInput`. These mirror `backend/src/api/api.schema.ts` and
`backend/src/settings/schema.ts` by hand — a deliberate duplication that keeps
the two projects independent, so changing one means changing the other.

```ts
export interface Selectors {
  item: string;
  link: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  description?: string;
  detail?: string;
}

export interface SourceRow {
  id: string;
  name: string;
  url: string;
  selectors: Selectors;
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
  enabled: boolean;
  createdAt: string;
}

export type SourceInput = Omit<SourceRow, 'id' | 'enabled' | 'createdAt'>;
```

And add to `ProfileInput`:

```ts
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
```

- [ ] **Step 2: Write the failing client test**

Add to `dashboard/tests/settings-client.test.ts`, matching the file's existing
fake-fetch style:

```ts
it('PUTs a replaced source and returns the row', async () => {
  const input = {
    name: 'Acme', url: 'https://acme.com/careers',
    selectors: { item: 'li', link: 'a' },
    blockedTitleWords: [], blockedDescriptionWords: [],
  };
  const fetchFn = vi.fn(async () => new Response(
    JSON.stringify({ source: { id: 'u1', ...input, enabled: true, createdAt: 'now' } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));

  const row = await updateSource('u1', input, fetchFn as unknown as typeof fetch);

  expect(fetchFn).toHaveBeenCalledWith('/api/sources/u1', expect.objectContaining({ method: 'PUT' }));
  expect(row.id).toBe('u1');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd dashboard && npx vitest run tests/settings-client.test.ts`
Expected: FAIL — `updateSource` is not exported.

- [ ] **Step 4: Add `updateSource`**

In `dashboard/src/api/settings.ts`:

```ts
export async function updateSource(
  id: string, input: SourceInput, fetchFn: typeof fetch = fetch,
): Promise<SourceRow> {
  const { source } = await sendJson<{ source: SourceRow }>(
    'PUT', `/api/sources/${id}`, input, fetchFn,
  );
  return source;
}
```

- [ ] **Step 5: Run it**

Run: `cd dashboard && npx vitest run tests/settings-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/api dashboard/tests/settings-client.test.ts
git commit -m "feat(dashboard): source types and the PUT client"
```

---

### Task 8: The source form component

`SourcesTable` would roughly triple if it held eleven fields inline and had to
serve both add and edit. The form comes out into its own file, used twice.

**Files:**
- Create: `dashboard/src/components/SourceForm.tsx`
- Modify: `dashboard/src/components/ChipInput.tsx` (optional `help` prop)
- Modify: `dashboard/src/styles.css`
- Test: `dashboard/tests/SourceForm.test.tsx`
- Test: `dashboard/tests/ChipInput.test.tsx`

**Interfaces:**
- Consumes: `SourceInput`, `Selectors` (Task 7).
- Produces:
  - `<SourceForm initial? submitLabel saving error onSubmit onCancel? />` where
    `onSubmit: (input: SourceInput) => void`
  - `ChipInput` gains `help?: string`

- [ ] **Step 1: Write the failing `ChipInput` help test**

Add to `dashboard/tests/ChipInput.test.tsx`:

```tsx
it('renders help text associated with the input', () => {
  render(<ChipInput id="w" label="Words" value={[]} onChange={() => {}} help="Type a word and press Enter." />);
  expect(screen.getByText('Type a word and press Enter.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it**

Run: `cd dashboard && npx vitest run tests/ChipInput.test.tsx`
Expected: FAIL — the text is not rendered.

- [ ] **Step 3: Add the prop**

In `dashboard/src/components/ChipInput.tsx` add `help?: string` to `Props` and
render it under the label:

```tsx
      <label htmlFor={id}>{label}</label>
      {help && <p className="field-help">{help}</p>}
```

- [ ] **Step 4: Run it**

Run: `cd dashboard && npx vitest run tests/ChipInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing form test**

Create `dashboard/tests/SourceForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceForm } from '../src/components/SourceForm';

const EXISTING = {
  name: 'Acme', url: 'https://acme.com/careers',
  selectors: { item: 'li.opening', link: 'a.t', detail: 'div.jd' },
  blockedTitleWords: ['intern'], blockedDescriptionWords: [],
};

it('submits a minimal source with only the required selectors', async () => {
  const onSubmit = vi.fn();
  render(<SourceForm submitLabel="Add source" saving={false} error={null} onSubmit={onSubmit} />);

  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://acme.com/careers');
  await userEvent.type(screen.getByLabelText('Item (required)'), 'li.opening');
  await userEvent.type(screen.getByLabelText('Link (required)'), 'a.t');
  await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

  expect(onSubmit).toHaveBeenCalledWith({
    name: 'Acme', url: 'https://acme.com/careers',
    selectors: { item: 'li.opening', link: 'a.t' },
    blockedTitleWords: [], blockedDescriptionWords: [],
  });
});

it('omits blank optional selectors rather than sending empty strings', async () => {
  // The backend's SelectorsSchema rejects '' via .min(1), so a blank field must
  // be absent, not empty.
  const onSubmit = vi.fn();
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error={null} onSubmit={onSubmit} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledWith(EXISTING);
});

it('pre-fills every field from initial', () => {
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  expect(screen.getByLabelText('Item (required)')).toHaveValue('li.opening');
  expect(screen.getByLabelText('Description container (posting page)')).toHaveValue('div.jd');
  expect(screen.getByText('intern')).toBeInTheDocument();
});

it('disables the submit button until name, url, item and link are all filled', async () => {
  render(<SourceForm submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  const button = screen.getByRole('button', { name: 'Add source' });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  expect(button).toBeDisabled();
});

it('shows the error and keeps the typed values', () => {
  render(<SourceForm initial={EXISTING} submitLabel="Save" saving={false} error="Another source already uses that name" onSubmit={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Another source already uses that name');
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
});

it('renders a cancel button only when onCancel is given', () => {
  const { rerender } = render(<SourceForm submitLabel="Add" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  rerender(<SourceForm submitLabel="Save" saving={false} error={null} onSubmit={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd dashboard && npx vitest run tests/SourceForm.test.tsx`
Expected: FAIL — cannot resolve `../src/components/SourceForm`.

- [ ] **Step 7: Implement the form**

Create `dashboard/src/components/SourceForm.tsx`:

```tsx
import { useState } from 'react';
import { ChipInput } from './ChipInput';
import type { Selectors, SourceInput } from '../api/types';

interface Props {
  initial?: SourceInput;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (input: SourceInput) => void;
  onCancel?: () => void;
}

const EMPTY: SourceInput = {
  name: '', url: '', selectors: { item: '', link: '' },
  blockedTitleWords: [], blockedDescriptionWords: [],
};

// Labelled and ordered as the user reads the page: the two required structural
// selectors first, then the fields they can leave to the fallbacks.
const SELECTOR_FIELDS: { key: keyof Selectors; label: string; help: string }[] = [
  { key: 'item', label: 'Item (required)', help: 'Each posting block on the listing page, e.g. li.opening' },
  { key: 'link', label: 'Link (required)', help: 'The link inside a block whose address is the posting, e.g. a.job-title' },
  { key: 'title', label: 'Title', help: 'Leave empty to use the link text, which is usually right.' },
  { key: 'company', label: 'Company', help: 'Leave empty to use the source name above.' },
  { key: 'location', label: 'Location', help: 'Optional. Feeds the excluded-locations filter.' },
  { key: 'employmentType', label: 'Employment type', help: 'Optional. Feeds the allowed-employment-types filter.' },
  { key: 'description', label: 'Snippet on the listing page', help: 'Optional. A short summary if the board shows one.' },
  { key: 'detail', label: 'Description container (posting page)', help: 'Optional. Leave empty to use the whole posting page as the description.' },
];

export function SourceForm({ initial, submitLabel, saving, error, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<SourceInput>(initial ?? EMPTY);

  function setSelector(key: keyof Selectors, value: string) {
    setDraft((d) => ({ ...d, selectors: { ...d.selectors, [key]: value } }));
  }

  const complete = draft.name.trim() !== '' && draft.url.trim() !== ''
    && draft.selectors.item.trim() !== '' && draft.selectors.link.trim() !== '';

  function submit() {
    // A blank optional selector must be absent, not '': the backend's
    // SelectorsSchema requires min(1) on every value it receives.
    const selectors = Object.fromEntries(
      Object.entries(draft.selectors).filter(([, v]) => (v ?? '').trim() !== ''),
    ) as Selectors;
    onSubmit({ ...draft, name: draft.name.trim(), url: draft.url.trim(), selectors });
  }

  return (
    <div className="source-form">
      <div className="field">
        <label htmlFor="source-name">Name</label>
        <p className="field-help">
          The company or board. Shown on every posting from this source and in the
          source filter, so make it recognisable. Must be unique.
        </p>
        <input id="source-name" value={draft.name} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      </div>

      <div className="field">
        <label htmlFor="source-url">Listing URL</label>
        <p className="field-help">
          The page that lists the jobs, with any filters you want already applied.
          Fetched every run to spot new postings.
        </p>
        <input id="source-url" value={draft.url} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} />
      </div>

      <fieldset className="selectors">
        <legend>Selectors</legend>
        <p className="field-help">
          CSS selectors read from the listing page's HTML. Only static HTML is
          parsed — a board that renders its jobs with JavaScript will find nothing,
          whatever you put here.
        </p>
        {SELECTOR_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`sel-${f.key}`}>{f.label}</label>
            <p className="field-help">{f.help}</p>
            <input id={`sel-${f.key}`} value={draft.selectors[f.key] ?? ''} disabled={saving}
              onChange={(e) => setSelector(f.key, e.target.value)} />
          </div>
        ))}
      </fieldset>

      <ChipInput
        id="source-title-words" label="Blocked words — titles (this source)"
        help="Extra blocked title words for this board only, added to the global list in Profile. Type a word and press Enter."
        value={draft.blockedTitleWords} disabled={saving}
        onChange={(v) => setDraft((d) => ({ ...d, blockedTitleWords: v }))}
      />

      <ChipInput
        id="source-desc-words" label="Blocked words — descriptions (this source)"
        help="Extra blocked description words for this board only, added to the global list in Profile. Type a word and press Enter."
        value={draft.blockedDescriptionWords} disabled={saving}
        onChange={(v) => setDraft((d) => ({ ...d, blockedDescriptionWords: v }))}
      />

      <div className="settings-actions">
        <button type="button" disabled={!complete || saving} onClick={submit}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
        )}
        {error && <span className="state" role="alert">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the form tests**

Run: `cd dashboard && npx vitest run tests/SourceForm.test.tsx`
Expected: PASS.

- [ ] **Step 9: Add the help-text style**

In `dashboard/src/styles.css`, next to the existing `.field` rule:

```css
.field-help { margin: 0; font-size: 0.8rem; opacity: 0.75; }
.source-form fieldset.selectors { border: 1px solid #ddd; padding: 0.75rem; margin-bottom: 0.75rem; }
```

Match the file's existing colour conventions rather than hardcoding `#ddd` if it
defines a border variable.

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/components/SourceForm.tsx dashboard/src/components/ChipInput.tsx \
  dashboard/src/styles.css dashboard/tests/SourceForm.test.tsx dashboard/tests/ChipInput.test.tsx
git commit -m "feat(dashboard): source form with selector and blocklist fields"
```

---

### Task 9: The sources table

**Files:**
- Modify: `dashboard/src/components/SourcesTable.tsx` (full rewrite)
- Test: `dashboard/tests/SourcesTable.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `SourceForm` (Task 8); `updateSource`, `SourceRow`, `SourceInput` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Rewrite the failing table tests**

Replace `dashboard/tests/SourcesTable.test.tsx`. `json()` below builds the
`Response` objects the client expects; if the existing file already has such a
helper, use that one instead.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourcesTable } from '../src/components/SourcesTable';

const ROW = {
  id: 'u1', name: 'Acme', url: 'https://acme.com/careers',
  selectors: { item: 'li.opening', link: 'a.t' },
  blockedTitleWords: [], blockedDescriptionWords: [],
  enabled: true, createdAt: '2026-01-01T00:00:00Z',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/** Answers GET /api/sources from `rows`; every other call falls to `handler`. */
function mockFetch(rows: unknown[], handler: (url: string, init?: RequestInit) => Response) {
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return json({ sources: rows });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

afterEach(() => vi.unstubAllGlobals());

async function fillRequired() {
  await userEvent.type(screen.getByLabelText('Name'), 'Beta');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://beta.com/jobs');
  await userEvent.type(screen.getByLabelText('Item (required)'), 'li.job');
  await userEvent.type(screen.getByLabelText('Link (required)'), 'a');
}

it('lists a source by name and URL', async () => {
  mockFetch([ROW], () => json({}));
  render(<SourcesTable />);
  expect(await screen.findByText('Acme')).toBeInTheDocument();
  expect(screen.getByText('https://acme.com/careers')).toBeInTheDocument();
});

it('shows the empty state when there are no sources', async () => {
  mockFetch([], () => json({}));
  render(<SourcesTable />);
  expect(await screen.findByText('No sources configured — add one below.')).toBeInTheDocument();
});

it('renders a disabled row with the row-disabled class', async () => {
  mockFetch([{ ...ROW, enabled: false }], () => json({}));
  render(<SourcesTable />);
  const cell = await screen.findByText('Acme');
  expect(cell.closest('tr')).toHaveClass('row-disabled');
});

it('toggles a source and reloads', async () => {
  const fetchFn = mockFetch([ROW], () => json({ source: { ...ROW, enabled: false } }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByLabelText('Enable Acme'));
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
    '/api/sources/u1', expect.objectContaining({ method: 'PATCH' }),
  ));
});

it('deletes a source and reloads', async () => {
  const fetchFn = mockFetch([ROW], () => new Response(null, { status: 204 }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
    '/api/sources/u1', expect.objectContaining({ method: 'DELETE' }),
  ));
});

it('adds a source through the form', async () => {
  const fetchFn = mockFetch([], () => json({ source: ROW }));
  render(<SourcesTable />);
  await screen.findByText('No sources configured — add one below.');
  await fillRequired();
  await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/sources', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      name: 'Beta', url: 'https://beta.com/jobs',
      selectors: { item: 'li.job', link: 'a' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    }),
  })));
});

it('opens an edit form pre-filled from the row and saves it with PUT', async () => {
  const fetchFn = mockFetch([ROW], () => json({ source: ROW }));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
  const item = screen.getByLabelText('Item (required)');
  expect(item).toHaveValue('li.opening');
  await userEvent.clear(item);
  await userEvent.type(item, 'div.card');
  await userEvent.click(screen.getByRole('button', { name: 'Save source' }));

  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/sources/u1', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({
      name: 'Acme', url: 'https://acme.com/careers',
      selectors: { item: 'div.card', link: 'a.t' },
      blockedTitleWords: [], blockedDescriptionWords: [],
    }),
  })));
});

it('closes the edit form on cancel without saving', async () => {
  const fetchFn = mockFetch([ROW], () => json({}));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('button', { name: 'Save source' })).toBeNull();
  expect(fetchFn.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});

it('keeps the edit form open and dirty when the save fails', async () => {
  mockFetch([ROW], () => json({ message: 'Another source already uses that name' }, 409));
  render(<SourcesTable />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  const name = screen.getByLabelText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Beta');
  await userEvent.click(screen.getByRole('button', { name: 'Save source' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Another source already uses that name');
  expect(screen.getByLabelText('Name')).toHaveValue('Beta');
});
```

Two of these encode decisions rather than mechanics, so do not weaken them: the
add-form assertion proves blank optional selectors are omitted rather than sent
as `''` (which `SelectorsSchema.min(1)` rejects), and the failed-save assertion
proves a 409 leaves the form open with the user's typing intact.

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run tests/SourcesTable.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the component**

Replace `dashboard/src/components/SourcesTable.tsx`:

```tsx
import { useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import { SourceForm } from './SourceForm';
import type { SourceInput, SourceRow } from '../api/types';

function toInput(r: SourceRow): SourceInput {
  return {
    name: r.name, url: r.url, selectors: r.selectors,
    blockedTitleWords: r.blockedTitleWords,
    blockedDescriptionWords: r.blockedDescriptionWords,
  };
}

export function SourcesTable() {
  const sources = useApi(() => fetchSources());
  const [editing, setEditing] = useState<string | null>(null);

  const add = useSave<SourceInput>(addSource);
  const edit = useSave<{ id: string; input: SourceInput }>(({ id, input }) => updateSource(id, input));
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  return (
    <section className="settings-section">
      <h2>Sources</h2>

      {sources.error && <p className="state" role="alert">Error: {sources.error}</p>}

      {sources.data?.length === 0
        ? <p className="state">No sources configured — add one below.</p>
        : (
          <table>
            <thead>
              <tr><th>On</th><th>Name</th><th>URL</th><th /><th /></tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((r) => (
                <>
                  <tr key={r.id} className={r.enabled ? undefined : 'row-disabled'}>
                    <td>
                      <input
                        type="checkbox" checked={r.enabled}
                        aria-label={`Enable ${r.name}`}
                        onChange={async () => {
                          if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                        }}
                      />
                    </td>
                    <td>{r.name}</td>
                    <td>{r.url}</td>
                    <td>
                      <button type="button" onClick={() => setEditing(editing === r.id ? null : r.id)}>
                        Edit
                      </button>
                    </td>
                    <td>
                      <button type="button" onClick={async () => {
                        if (await mutate.run(() => deleteSource(r.id))) sources.reload();
                      }}>Delete</button>
                    </td>
                  </tr>
                  {editing === r.id && (
                    <tr key={`${r.id}-edit`}>
                      <td colSpan={5}>
                        <SourceForm
                          // Remount on identity change so the draft is re-seeded
                          // from the row the user actually clicked.
                          key={r.id}
                          initial={toInput(r)}
                          submitLabel="Save source"
                          saving={edit.saving}
                          error={edit.error}
                          onCancel={() => setEditing(null)}
                          onSubmit={async (input) => {
                            // Close only on success: a rejected save must keep
                            // the form and the user's typing.
                            if (await edit.run({ id: r.id, input })) {
                              setEditing(null);
                              sources.reload();
                            }
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}

      <h3>Add a source</h3>
      <SourceForm
        submitLabel="Add source"
        saving={add.saving}
        error={add.error}
        onSubmit={async (input) => { if (await add.run(input)) sources.reload(); }}
      />
      {mutate.error && <p className="state" role="alert">{mutate.error}</p>}
    </section>
  );
}
```

Note the `<>` fragment inside `map` needs the `key` on the fragment, not the
`<tr>` — use `<Fragment key={r.id}>` from `react` instead of the shorthand, or
React will warn.

- [ ] **Step 4: Run the table tests**

Run: `cd dashboard && npx vitest run tests/SourcesTable.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole dashboard suite**

Run: `cd dashboard && npx vitest run && npx tsc --noEmit`
Expected: clean. `SettingsPage.test.tsx` and `App.test.tsx` may assert on the old
source fixture shape — update their fixtures to the new `SourceRow`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/SourcesTable.tsx dashboard/tests
git commit -m "feat(dashboard): edit sources in place"
```

---

### Task 10: Global blocked-word lists in the profile form

**Files:**
- Modify: `dashboard/src/components/ProfileForm.tsx`
- Test: `dashboard/tests/ProfileForm.test.tsx`

**Interfaces:**
- Consumes: `ProfileInput` (Task 7), `ChipInput`'s `help` prop (Task 8).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/ProfileForm.test.tsx`:

```tsx
const PROFILE = {
  excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null,
  timezone: 'Europe/Kyiv', blockedTitleWords: ['intern'], blockedDescriptionWords: [],
};

it('renders both blocked-word lists with their help text', () => {
  render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
  expect(screen.getByText('intern')).toBeInTheDocument();
  expect(screen.getByText(/Checked before the job page is downloaded/)).toBeInTheDocument();
  expect(screen.getByText(/Checked after the job page is downloaded/)).toBeInTheDocument();
});

it('warns that removing a word does not restore rejected postings', () => {
  render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
  expect(screen.getByText(/does not bring back postings it already rejected/)).toBeInTheDocument();
});

it('saves an added description word', async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ version: 2 }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchFn);

  render(<ProfileForm initial={PROFILE} onSaved={() => {}} />);
  await userEvent.type(
    screen.getByLabelText('Blocked words — descriptions'),
    'relocation required{Enter}',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));

  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
    '/api/settings/profile',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ ...PROFILE, blockedDescriptionWords: ['relocation required'] }),
    }),
  ));
  vi.unstubAllGlobals();
});
```

If the existing cases in that file mock `fetch` a different way, follow theirs
rather than introducing a second pattern.

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run tests/ProfileForm.test.tsx`
Expected: FAIL — the fields do not exist.

- [ ] **Step 3: Add the two fields**

In `dashboard/src/components/ProfileForm.tsx`, after the employment-types
`ChipInput`:

```tsx
      <ChipInput
        id="blocked-title-words" label="Blocked words — titles"
        help="Reject a posting outright if its title contains one of these words. Checked before the job page is downloaded, so it also saves a request. Whole words only, case-insensitive — php will not match phpstorm."
        value={draft.blockedTitleWords}
        onChange={(v) => set('blockedTitleWords', v)}
        disabled={save.saving}
      />

      <ChipInput
        id="blocked-description-words" label="Blocked words — descriptions"
        help="Reject a posting if its full description contains one of these words. Checked after the job page is downloaded. Use it for deal-breakers in the body text, like “relocation required”. Whole words and phrases, case-insensitive."
        value={draft.blockedDescriptionWords}
        onChange={(v) => set('blockedDescriptionWords', v)}
        disabled={save.saving}
      />

      <p className="field-help">
        Removing a word does not bring back postings it already rejected — those
        keep their score row and stay filtered. Rejected postings stay listed on
        the Postings tab with the word that rejected them, so you can see when a
        list is too aggressive.
      </p>
```

- [ ] **Step 4: Run the tests**

Run: `cd dashboard && npx vitest run tests/ProfileForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole dashboard suite**

Run: `cd dashboard && npx vitest run && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/ProfileForm.tsx dashboard/tests/ProfileForm.test.tsx
git commit -m "feat(dashboard): global blocked-word lists in the profile form"
```

---

### Task 11: Verify end to end and document

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Create: `docs/features/custom-sources.md`
- Modify: `docs/superpowers/plans/2026-08-26-custom-sources.md` (tick the boxes)

**Interfaces:**
- Consumes: everything. Produces documentation only.

- [ ] **Step 1: Run the stack and add a real source**

```bash
cd backend
docker-compose build
docker-compose up -d
docker-compose logs -f worker
```

In the dashboard, add a source pointing at a real careers page, save it, and
watch the worker log its listing count. Confirm in the dashboard that the
postings carry the name you gave the source and that at least one has a
description longer than the listing snippet.

- [ ] **Step 2: Verify a blocklist end to end**

Add a word matching one of those postings to the global title list, delete that
posting's score row so it is re-considered
(`docker-compose exec db psql -U jobradar -d jobradar -c "delete from scores where posting_id = '<id>'"`),
and confirm the next run records `hard-filter:title-word:<word>` rather than
fetching the detail page.

- [ ] **Step 3: Update `CLAUDE.md`**

Grep for the old behaviour rather than guessing which paragraphs are stale:

```bash
grep -n "ats\|djinni\|dou\|slug\|BUILD_SOURCES\|SourcesSchema\|toSourcesConfig" CLAUDE.md
```

Rewrite: the `BUILD_SOURCES` bullet in the swappable-seams list (now
`BUILD_SOURCE`, one adapter, per-spec); the "Settings live in Postgres" section's
description of the `sources` table; the `PipelineService.run()` walkthrough,
which must show the new ordering and say why hydrate sits between the gate and
the filters; the note that `import.ts`/`seed.ts` no longer seed sources; and the
`config/` paragraph, since `sources.yaml` is no longer imported.

- [ ] **Step 4: Update `README.md`**

Add `PUT /api/sources/:id` to the REST API table. Check the quick-start and
rubric-tuning sections for anything describing `sources.yaml` or a board/slug
source and rewrite it around name + URL + selectors.

- [ ] **Step 5: Write `docs/features/custom-sources.md`**

Cover, per this repo's convention: the problem (three adapters, none of them the
boards actually worth watching); the design decision and the alternatives
rejected (LLM extraction, a heuristic scraper, LLM-assisted selector detection,
keeping the ATS kind, hostname auto-detection of a parser); the files it touches;
how to verify it works, reusing Steps 1 and 2; the known limitation that
JavaScript-rendered boards cannot work; the note that blocklists are not
retroactive; and the Djinni and DOU selector sets recorded in Task 6 Step 2, as a
copy-paste block for re-adding those boards.

- [ ] **Step 6: Run every suite one last time**

```bash
cd backend && npm test && npx tsc -p tsconfig.build.json --noEmit
DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar npm run test:integration
cd ../dashboard && npx vitest run && npx tsc --noEmit
```
Expected: all green. Report the actual output; do not claim green without it.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md docs/features/custom-sources.md docs/superpowers/plans/2026-08-26-custom-sources.md
git commit -m "docs: custom sources with tunable selectors"
```
