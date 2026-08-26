# JobRadar — Custom Sources with Tunable Selectors

**Date:** 2026-08-26
**Status:** Approved, ready for implementation planning
**Supersedes:** the "Sources" seam as described in
`2026-08-25-jobradar-design.md` and the `sources` table as specified in
`2026-08-25-settings-in-db-design.md`
**Depends on:** settings-in-db, implemented as of `08b1141`

File and line references below were verified against that commit.

## Problem

v1 ships three source adapters, each with a different shape of configuration.
`ats` takes a vendor enum plus a company slug and calls a JSON API; `djinni` and
`dou` take a listing URL and scrape it with CSS selectors hardcoded in
`src/sources/djinni.ts` and `src/sources/dou.ts`. Adding a board that is not one
of those three means writing a new adapter, a new `SourcesSchema` entry, a new
branch in `buildSources`, and a new arm of the dashboard's add-source form.

The boards worth watching are mostly companies running their own careers page.
None of them is a Greenhouse/Lever/Ashby tenant, so the `ats` kind is dead
weight, and none of them can be reached without per-site selectors. The
selectors are the only thing that actually varies between these sources, so they
belong in the database next to the URL rather than in a file that needs a
release.

## Scope

**In scope:** the `sources` table becomes uniform — every row is a name, a
listing URL, and the CSS selectors needed to parse it. One adapter replaces
three. Postings get their descriptions from their own detail pages. Two
keyword blocklists reject unwanted postings, one before the detail fetch and one
after.

**Explicitly not in scope:**

- **JavaScript-rendered boards.** Parsing stays cheerio over static HTML. A
  careers page that renders its listings client-side yields zero postings and no
  selector can fix that. Headless-browser fetching is a separate project with
  its own memory and image-size cost.
- **Pagination.** One listing URL, one page. A board whose first page holds the
  newest postings is served fine by a 30-minute tick; one that does not can be
  added as a second row with a `?page=2` URL.
- **Selector auto-detection.** No heuristic guesser and no LLM-assisted
  "detect selectors" button. The user writes selectors from the page's DOM.
  Both were considered and rejected in favour of an explicit, debuggable field.
- **Re-scoring after a blocklist edit.** See *Blocklists are not retroactive*.
- **Migrating existing source rows.** The migration deletes them. See
  *Migration*.
- **Authentication.** Unchanged from settings-in-db: the API binds `127.0.0.1`
  and publishing port 8080 still requires authentication first.

## The source model

A source is one row, with no discriminating kind:

```
sources
  id                        uuid primary key default gen_random_uuid()
  name                      text not null
  url                       text not null
  selectors                 jsonb not null
  blocked_title_words       text[] not null default '{}'
  blocked_description_words text[] not null default '{}'
  enabled                   boolean not null default true
  created_at                timestamptz not null default now()
  unique(url)
  unique(name)
```

Dropped from the v1 table: the `kind` column, the `board` and `slug` columns, the
`source_kind` enum type, both ATS check constraints, and the
`sources_identity_uniq` constraint that existed only to make a four-column
nullable identity work. `url` is the identity now, and it is `NOT NULL`, so
`nullsNotDistinct` is no longer needed.

`name` is unique as well, which the v1 table had no equivalent of. It is not the
row's identity — `url` is — but it is the value written to `postings.source` and
used as the `JobSource.id` that `run_log` records, so two sources sharing a name
would make the dashboard's source filter and health panel ambiguous with no way
to tell which board a failure came from.

`name` is a display label and the company. It is what lands in
`postings.source`, which the dashboard's filter dropdown and health panel derive
their options from — so those read `Acme` rather than `greenhouse`. The value is
a snapshot taken at fetch time: renaming a source leaves older postings under
the old name and the filter lists both. The alternative, a join from posting to
source row, buys nothing that matters and loses history when a source is
deleted.

Djinni and DOU are no longer special. They become ordinary rows whose selectors
happen to be the ones currently hardcoded in their adapters. Those selector sets
are recorded in the feature doc as copy-paste reference.

### Selectors

```ts
SelectorsSchema = z.object({
  item:            z.string().min(1),   // each posting block on the listing page
  link:            z.string().min(1),   // anchor within item whose href is the posting URL
  title:           z.string().optional(),
  company:         z.string().optional(),
  location:        z.string().optional(),
  employmentType:  z.string().optional(),
  description:     z.string().optional(),
  detail:          z.string().optional(),
}).strict()
```

`item` and `link` are the minimum needed to produce a posting at all. `title`
defaults to the link's own text, which is how most boards are built. `company`
defaults to the source's `name`, which is the right answer for a single-company
careers page and wrong only for aggregators, where the selector exists.
`detail` names the container on the *posting* page that holds the description;
absent, the whole page's text is used.

Every selector is a CSS selector string passed to cheerio. Comma-separated
alternates work for free, which is how `djinni.ts` currently expresses its
fallbacks, so that capability survives the adapter's deletion.

## The adapter

`src/sources/custom.ts` replaces `ats.ts`, `djinni.ts` and `dou.ts`.
`htmlToText` moves out of `ats.ts` into `src/sources/html.ts`.

`createCustomSource(spec, fetchFn)` returns a `JobSource` whose `id` is the
source's `name` — that string is what `run_log.source` records, so a failing
board is named in the health panel by the name the user gave it.

`listPostings()` fetches the listing URL, iterates `item`, and for each block
resolves the `link` href with `new URL(href, listingUrl)`. That handles relative
hrefs generically, which is what `djinni.ts` hand-rolls with a `BASE` constant.
A block with no resolvable href, or with an empty title, is skipped rather than
erroring: a listing page's markup usually contains one or two blocks that match
the item selector without being postings.

Posting ids are `src:<source uuid>:<externalId>`, where `externalId` is the
posting URL's pathname with any trailing slash removed, plus its query string
minus referrer parameters (`from`, `ref`, `utm_*`, and the like). The query
string is not optional: a board that addresses postings as `/job?id=42` would
otherwise collapse all of them onto one id and exactly one would ever be
scored. But it cannot survive unfiltered either — DOU's listing links carry
`from=list_hot`, `from=list_regular`, and so on for the same vacancy, which
would otherwise produce a different posting id, and a second trip through the
classifier, per listing block a link was shown in. Extracting a numeric id was
considered and rejected — the
boards in play spell theirs too differently for one rule (`/jobs/123-title/`,
`/careers/senior-node`, `?id=42`), and a wrong extraction silently merges two
postings, which is worse than an id that carries some slug text. Keying on the
row's uuid rather than its name means renaming a source does not orphan its
postings.

### Detail fetch

The classifier needs a real description, and a company careers page usually
lists nothing but titles. So `JobSource` gains one optional method:

```ts
interface JobSource {
  id: string;
  listPostings(): Promise<RawPosting[]>;
  hydrate?(posting: RawPosting): Promise<RawPosting>;
}
```

`hydrate` fetches the posting's own URL and replaces `description` with the text
of the `detail` container, or of the whole page if no `detail` selector is set.

`PipelineService.run()` calls it *after* the dedup gate:

```
list (every tick)
  → upsert                    (last_seen advances, as today)
  → hasScore gate             (skip if already scored)
  → title blocklist           (reject → score row, no detail fetch)
  → hydrate                   (one request, for this posting, once ever)
  → upsert                    (persist the real description)
  → hard filters              (location, employment type, salary, description words)
  → classify
```

The listing page is still fetched unconditionally on every tick — that is the
new-posting detector and it does not change. Only detail pages are gated. Per
source per tick the cost is one listing request plus one request per posting that
has no score row yet, which in steady state is zero.

Hydrate runs *before* the hard filters, not after, because `applyHardFilters`
reads `posting.description` for the salary rule (`src/filters.ts:30`). Filtering
first would run that rule against a listing snippet that is usually empty, so
the salary rule would effectively never fire. The cost of this ordering is that a
posting the hard filters go on to reject still cost one detail fetch — once,
ever.

A `hydrate` failure is counted as a source error, logged to `run_log`, and the
posting is left unscored. The next tick re-lists it and retries, which is the
same convention already used for a classifier throw.

## Blocklists

Two lists of words, each the union of a global list and the source's own
additions:

| List | Global home | Per-source home | Checked against | When |
|---|---|---|---|---|
| Title words | `profile.blockedTitleWords` | `sources.blocked_title_words` | `posting.title` | before hydrate |
| Description words | `profile.blockedDescriptionWords` | `sources.blocked_description_words` | `posting.description` | with the hard filters |

A global list covers the words that are deal-breakers everywhere; the per-source
list covers a board that needs one extra word without imposing it on the others.
The effective list is the union, so a source can add but never subtract.

Matching lives in one function, `matchBlockedWord(text, words): string | null`
in `src/filters.ts`. Each entry becomes a case-insensitive word-boundary regex
over the regex-escaped entry, so `php` matches `PHP / Laravel` but not
`phpstorm`, `go` matches `Go developer` but not `Google`, and `c++` and `.net`
are literals rather than syntax errors. A multi-word entry matches as a phrase.
The function returns the entry that matched, so the rejection reason can name it.

The title check screens the title alone. Screening every scraped field was
considered and rejected: a word appearing in a location or a tag list would
reject the posting, and the two lists exist precisely so that body-text
deal-breakers can be expressed separately.

The title check cannot live inside `applyHardFilters`, which by design runs
after hydrate, so it is its own exported function `applyTitleFilter(posting,
words)`. The description check is a new rule inside `applyHardFilters`. Both
return the existing `FilterResult` shape and both produce the existing
hard-filter score row: `providerId: 'hard-filter'`, zeroed subscores, and
`reasoning: 'hard-filter:title-word:php'` or
`'hard-filter:description-word:relocation required'`. A rejected posting stays
visible in the dashboard with the word that killed it, which is how an
over-aggressive list gets noticed.

### Blocklists are not retroactive

The dedup gate is *has a score row*, not *have we seen it*. A rejected posting
has a real score row, so removing a word from a blocklist does not bring the
posting back — it stays skipped. Tightening a list affects new postings only.
This is the same property that makes re-running safe and it is not worth a
re-score button; it is worth documenting, in the dashboard help text and in the
feature doc.

## Settings plumbing

`AppSettings.sources` becomes a flat `SourceSpec[]`:

```ts
interface SourceSpec {
  id: string;
  name: string;
  url: string;
  selectors: Selectors;
  blockedTitleWords: string[];
  blockedDescriptionWords: string[];
}
```

The `{ ats, djinni, dou }` grouping in `SourcesSchema` existed only to mirror
v1's `sources.yaml` and has no remaining reader. `toSourcesConfig` becomes
`toSourceSpecs`, keeping its one real job of dropping disabled rows so callers
never have to remember to filter. `buildSources` becomes
`specs.map(createCustomSource)`. `incompleteReason` checks `specs.length`.

`SourceInputSchema` collapses from a discriminated union to a flat strict object
`{ name, url, selectors, blockedTitleWords, blockedDescriptionWords }`, with the
two word arrays defaulting to `[]`.

`ProfileSchema` gains `blockedTitleWords` and `blockedDescriptionWords`, both
defaulting to `[]` in the lenient schema and both required in
`ProfileBodySchema`, matching how the existing profile fields are split.

`SettingsService.load()` must change one line: it currently returns
`row.profile` raw from jsonb (`src/settings/settings.service.ts:28`). An
`app_settings` row written before this change has no blocked-word keys, so the
arrays would be `undefined` and `matchBlockedWord` would throw. `load()` parses
through `ProfileSchema` instead, which is exactly what that schema's defaults
exist for. No data migration is needed for the `profile` column.

### API

| Method | Path | Change |
|---|---|---|
| `GET` | `/api/sources` | unchanged; row shape is new |
| `POST` | `/api/sources` | body is the new flat `SourceInputSchema` |
| `PUT` | `/api/sources/:id` | **new** — replaces a whole row |
| `PATCH` | `/api/sources/:id` | unchanged; still `{ enabled }` only |
| `DELETE` | `/api/sources/:id` | unchanged |

`PUT` is what makes selectors tunable: a selector that stops matching is fixed
in place rather than by delete-and-re-add, which would be the difference between
re-tuning a board and losing its posting history. It replaces the whole row for
the same reason the settings documents do — a body missing a field would
silently blank that field. `PATCH` keeps its narrow toggle job so the row's
checkbox does not need to send selectors.

`PUT` and `POST` both surface a unique violation — on `url` or on `name` — as a
409, as `POST` already does, with a message naming which of the two collided.

### Versioning

A global profile save bumps `app_settings.version`, because the blocked-word
lists change which postings get judged. Editing a source row does not, which is
the existing rule — source rows have never bumped the version. This is a
deliberate asymmetry for the same knob, and it is tolerable because the version
counter only drives the dashboard's stale-score badge; the blocklists' real
irreversibility is the score row described above, which no version scheme
addresses.

## Migration

`name`, `url` and `selectors` are all `NOT NULL` and there is nothing in an
existing row to backfill `selectors` from. So the migration begins with
`DELETE FROM sources`.

This wipes configured sources. It does not touch `postings`, `scores` or
`run_log`: postings already collected under `djinni:*`, `dou:*` or an ATS prefix
keep their full history and stay visible in the dashboard, and simply stop
refreshing, so their `last_seen` freezes and they age out of the default view on
their own.

Migration steps, in one transaction:

1. `DELETE FROM sources`
2. drop the `sources_ats_has_board_and_slug`, `sources_url_only_for_non_ats` and
   `sources_identity_uniq` constraints
3. drop the `kind`, `board`, `slug` columns and the `source_kind` enum type
4. add `name`, `selectors` (both `NOT NULL`), the two `text[]` columns with
   `'{}'` defaults, and the `unique(url)` and `unique(name)` constraints; make
   `url` `NOT NULL`

`src/settings/import.ts` — the one-shot v1 file importer — can no longer produce
a usable source from `sources.yaml`, because that file has no selectors. It stops
reading the `sources:` key entirely and imports only `cv.md`, `profile.yaml` and
`rubric.md`. `seed.ts`'s built-in defaults ship no sources, as they do today.
A fresh install therefore still hits `incompleteReason`'s "no enabled sources"
path and shows the first-run banner.

## Dashboard

`SourcesTable.tsx` is the section that changes. The add form becomes Name, URL,
the selector fields, and the two per-source word lists. The table becomes
`On | Name | URL | Edit | Delete`, where Edit expands the row into the same form
bound to that row and saves through `PUT`. The comment about identity being
immutable comes out — it no longer is, and that is the point.

The Profile section gains the two global word lists, using the existing
`ChipInput` component that already serves `excludedLocations` and
`allowedEmploymentTypes` — a word is typed and committed with Enter, and appears
as a removable chip. A one-per-line textarea was the first thought, but a third
list-of-strings control in the same form with different interaction rules is
worse than reusing the one that is already there.

Every new field carries help text, because a CSS selector field with no
explanation is unusable by the person who owns this dashboard six months from
now:

- **Blocked words — titles** — *Reject a posting outright if its title contains
  one of these words. Checked before the job page is downloaded, so it also
  saves a request. Whole words only, case-insensitive — `php` will not match
  `phpstorm`.*
- **Blocked words — descriptions** — *Reject a posting if its full description
  contains one of these words. Checked after the job page is downloaded. Use it
  for deal-breakers in the body text, like `relocation required`. Whole words and
  phrases, case-insensitive.*
- **Per-source word lists** — *Extra blocked words for this board only, added to
  the global lists in Profile. Leave empty to use the global lists alone.*
- **Selectors** — each field labelled with what it selects and whether it is
  required, per the table in *Selectors* above.
- A note on both blocked-word sections that removing a word does not bring back
  postings already rejected by it.

`dashboard/src/api/types.ts` is updated to match `api.schema.ts`, which stays a
deliberate duplication.

## Testing

**Jest** (`backend/src`, `*.spec.ts`):

- `sources/custom.spec.ts` — selector extraction against fixture HTML; relative
  and absolute hrefs; missing optional selectors falling back to link text and
  source name; blocks that match `item` but have no href or no title being
  skipped; `externalId` derivation from numeric and non-numeric URLs; `hydrate`
  with and without a `detail` selector.
- `filters.spec.ts` — `matchBlockedWord` word-boundary behaviour (`php` vs
  `phpstorm`, `go` vs `Google`), case-insensitivity, phrase entries, regex
  metacharacters in entries (`c++`, `.net`), empty list; `applyTitleFilter`;
  the new description rule inside `applyHardFilters`.
- `settings/schema.spec.ts` — `SelectorsSchema` requiring `item` and `link` and
  rejecting unknown keys; the flat `SourceInputSchema`; profile word arrays
  defaulting in `ProfileSchema` and required in `ProfileBodySchema`.
- `settings/to-source-specs.spec.ts` — disabled rows dropped, word arrays
  passed through.
- `sources/sources.factory.spec.ts` — one adapter per spec.
- `pipeline/pipeline.service.spec.ts` — hydrate is called after the `hasScore`
  gate and not for an already-scored posting; a title-word rejection writes a
  score row and does **not** call hydrate; a hydrate throw leaves the posting
  unscored and counts a source error; the effective word list is the union of
  global and per-source.
- `sources/ats.spec.ts`, `djinni.spec.ts`, `dou.spec.ts` are deleted.

**Vitest integration, `DATABASE_URL_TEST` set:** the repository suite covers the
new columns, the `unique(url)` violation surfacing as a conflict, and `PUT`
replacing a row. The live-source suite that asserted real Djinni/DOU selectors
still parse loses its subject — those selectors are now data, not code — so it
is reduced to the generic adapter against a recorded fixture.

**Dashboard Vitest:** the add form's selector and word fields, the inline edit
round-trip through `PUT`, and the Profile section's two new textareas.

The migration is verified by running `drizzle-kit migrate` against a copy of a
populated database and confirming postings survive.

## Documentation

- `CLAUDE.md` — the sources seam, the `sources` table description, the pipeline
  ordering, and the note that `AppSettings.sources` is a flat list.
- `README.md` — the REST API table gains `PUT /api/sources/:id`.
- `docs/features/custom-sources.md` — the problem, the rejected alternatives
  (auto-detection, LLM extraction, keeping the ATS kind), the files touched, how
  to verify, and the known-good Djinni and DOU selector sets for re-adding them.
