# Custom sources with tunable selectors

## The problem

JobRadar v1 shipped three adapters: `ats.ts` (Greenhouse, Lever, Ashby),
`djinni.ts` and `dou.ts`. Adding a board meant writing TypeScript, adding a
`kind` to a Zod union, and redeploying. Which would have been a fair trade if the
three covered the ground — but they did not. The boards actually worth watching
are ordinary company careers pages, regional aggregators, and niche lists, and
none of them speak Greenhouse's JSON API. The adapter that mattered was always
the fourth one, and it was never worth writing because it would have been just as
single-purpose as the first three.

Worse, the two scraping adapters were already selector-driven internally —
`djinni.ts` and `dou.ts` were each a `const SELECTORS = {…}` and a shared parse
loop, with the loops nearly identical and the selectors hand-maintained in code.
The configuration was already data; it just lived in a place only a developer
could reach, so a board that changed a class name was a code change and a
release.

A second problem sat next to it. Postings arrived with only the listing snippet
as their description — a line of metadata on Djinni, a sentence on DOU — and the
classifier was asked to judge a whole vacancy from it. The rubric's `coreStack`
and `logistics` dimensions need the actual requirements text, and the salary hard
filter needs a number that a listing snippet almost never carries.

## The design

One adapter, `src/sources/custom.ts`, whose behaviour is entirely determined by a
row in Postgres. A source is a **name**, a **listing URL**, a `selectors` jsonb
blob, and two blocked-word arrays. `createCustomSource(spec)` returns a
`JobSource` with `listPostings()` and `hydrate()`. Adding a board is now a
dashboard form, not a commit.

`hydrate()` is the answer to the thin-description problem: after a posting
survives the dedup gate and the title blocklist, its own page is fetched and the
text under the `detail` selector — or the whole page's text, if `detail` is unset
— replaces the listing snippet. That richer body is what the hard filters and the
classifier see.

The blocked-word lists exist because hydration made every posting cost an extra
HTTP request and a much larger prompt. Rejecting on the title *before* the detail
fetch is what keeps that affordable: a title you already know you do not want
costs one string match instead of a page load and a classification.

### Ordering, which is the part that carries weight

```
list → upsert (always, so last_seen advances)
     → hasScore gate            ← the dedup point
     → title blocklist          ← before the fetch: a rejected title is not worth a request
     → hydrate + saveHydrated   ← after the gate: fetched once ever, not once per tick
     → remaining hard filters   ← after the fetch: salary and description-word rules need the body
     → classify
```

Every arrow in that sequence was a decision:

- **Hydrate after the dedup gate.** A posting's detail page is fetched exactly
  once in its lifetime. Putting the fetch before the gate would re-fetch every
  known posting on every 30-minute tick, for nothing.
- **Hydrate before the remaining hard filters.** `applyHardFilters` reads
  `description` for both the salary rule and the description blocklist. Running
  it on the listing snippet would let through everything the snippet happens not
  to mention.
- **Two filter calls, not one.** The split into `applyTitleFilter` and
  `applyHardFilters` exists solely so the title check can sit on the other side
  of the fetch. It is not a tidiness refactor.

### Two writes to `postings`

`PostingsRepository` has two write paths and they are not interchangeable:

- `upsert(p)` — *"I saw this posting again."* Inserts, or on conflict advances
  `last_seen` and **nothing else**. Called for every listed posting on every
  tick.
- `saveHydrated(p)` — *"here is the real content."* The only path allowed to
  overwrite a posting's body. Called once, right after a successful `hydrate`.

This split was not the first design. The first attempt was a single `upsert`
whose conflict clause refreshed the content columns, and it was wrong in a way
that only end-to-end verification could catch: because the pipeline upserts the
*listed* posting unconditionally before the dedup gate, the next tick would
overwrite the hydrated 9,000-character body with the 200-character listing
snippet — or with `''` for a source with no listing `description` selector. The
row held the right value for exactly one cron interval and then silently
reverted. The unit tests could not see it; a mocked repository does not model
`onConflictDoUpdate`.

Neither write touches `postings.source`. It is a snapshot of the source's name at
fetch time, which is why renaming a source leaves older postings filed under the
old name.

### Alternatives rejected

**LLM-based posting extraction** — hand each listing page to the model and ask it
for structured postings. No selectors to maintain, works on any layout, and it
was genuinely tempting. Rejected on cost and determinism: it means an LLM call
per *listing page per tick* on top of one per posting, and the extraction is
non-deterministic, so the dedup key — which must be byte-stable forever or the
pipeline re-classifies everything — would be produced by a sampling process. A
scraper that silently returns nothing is debuggable; one that returns
slightly-different ids each run is not.

**A generic heuristic scraper with no configuration** — infer the repeated
element, find the link, guess the title. This works impressively often and fails
unpredictably, and the failure mode is the bad one: a plausible-looking wrong
answer with no place to correct it. Selectors are more work up front and are
*fixable* when a board redesigns. The whole point is that the user can repair a
source without a release.

**LLM-assisted selector auto-detection** — a one-shot "look at this page and
propose selectors" helper, with the result stored as ordinary selectors. This is
the rejected alternative most worth revisiting: it keeps the deterministic
runtime and only spends a model call at configuration time. It is out of scope
rather than wrong. It needs a UI affordance, a way to preview and confirm the
proposal, and a story for when the proposal is subtly wrong — none of which the
current two-tab dashboard has room for.

**Keeping the `kind` field alongside the generic adapter** — retain
`kind: 'ats' | 'custom'` so Greenhouse's JSON API still gets its typed,
zero-selector path. Rejected because a discriminated union is a permanent tax on
every consumer — the schema, the factory, the dashboard form, every test fixture
— and it was being paid to keep three adapters that were not covering the actual
use case. A Greenhouse board can be scraped from its HTML like any other. If a
JSON path returns later, it should return as a second `JobSource` implementation
behind the same `BUILD_SOURCE` seam, not as a field on the row.

**Auto-detecting a parser from the URL's hostname** — recognise `djinni.co` and
apply the known Djinni selectors. This is the old hardcoding wearing a disguise:
the selector sets still live in code, still go stale on a redesign, and the user
still cannot fix them. It also makes behaviour depend invisibly on the URL, so
two sources that look identically configured behave differently. The recorded
selector sets belong in documentation — see the bottom of this file — where a
user can paste and then edit them.

## Known limitations

- **JavaScript-rendered boards cannot work.** `cheerio` parses static HTML; it
  does not execute scripts. A board that renders its listing client-side yields
  zero postings and no selector can fix it. Supporting those needs a headless
  browser, which is a different feature with a different operational cost.
- **A missing `detail` selector is worse than it looks.** The fallback is the
  whole page's text, which drags in nav, JSON-LD and sidebars. That is not only
  wasted tokens: during verification it caused three good DOU postings to be
  rejected with `hard-filter:salary`, because the page chrome contained `$1000`
  and `$1500` from DOU's own salary-filter widget and `statedSalaryUsd` cannot
  tell those from the vacancy's figures.
- **Blocklists are not retroactive.** Removing a word does not bring back the
  postings it already rejected. A rejection writes a score row, and the dedup
  gate is "has a score row", so the posting is never reconsidered. Deleting the
  score row by hand is the only way back.
- **`externalId` errs toward splitting, not merging.** It keeps the query string
  minus referrer parameters (`from`, `referrer`, `utm_*`, ad-click ids). `from`
  is stripped because DOU's listing links carry `?from=list_hot`, which would
  otherwise split one vacancy into several postings. `ref` and `source` are
  deliberately **not** stripped: a false merge silently drops a posting from
  scoring, which is worse than a false split's one duplicate classification.
- **`hydrate` failures are noisy on purpose.** A failed detail fetch increments
  `sourceErrors` and writes a `run_log` row **per posting**, where a listing
  failure writes one per source. On a board whose detail pages all fail, the
  health panel fills up. That mixed granularity is the price of each posting
  staying individually retryable instead of one bad page aborting the source.
- **Migration 0003 deletes every existing `sources` row.** `name` and `selectors`
  are `NOT NULL` and a v1 `kind`/`board`/`slug` row has nothing to backfill them
  from. An upgrading user re-adds their boards through the dashboard; postings
  and scores survive untouched.

## Files

**Backend**

| File | Role |
|---|---|
| `src/sources/custom.ts` | The adapter. `createCustomSource`, `externalIdFrom` |
| `src/sources/html.ts` | `htmlToText`, the no-`detail`-selector fallback |
| `src/sources/sources.factory.ts` | `buildSource(spec)` behind the `BUILD_SOURCE` token |
| `src/sources/sources.module.ts` | `BUILD_SOURCE` provider |
| `src/filters.ts` | `matchBlockedWord`, `applyTitleFilter`, `applyHardFilters` |
| `src/pipeline/pipeline.service.ts` | The ordering above |
| `src/db/postings.repository.ts` | `upsert` and `saveHydrated` |
| `src/settings/schema.ts` | `SelectorsSchema`, `SourceInputSchema`, `SourceSpec`, profile blocklists |
| `src/settings/settings.repository.ts` | `addSource`, `replaceSource`, `setSourceEnabled`, `deleteSource` |
| `src/settings/sources.controller.ts` | `GET/POST/PUT/PATCH/DELETE /api/sources` |
| `src/settings/to-source-specs.ts` | Rows → `SourceSpec[]` |
| `src/db/schema.ts` + `drizzle/0003_*` | `name`, `selectors`, the two `text[]` columns, both unique constraints |

Deleted: `src/sources/ats.ts`, `djinni.ts`, `dou.ts` and their specs, plus the
five fixtures that only they used — `test/fixtures/greenhouse-acme.json`,
`lever-acme.json`, `ashby-acme.json`, `djinni-list.html`, `dou-list.html`.

**Dashboard** — `src/api/types.ts`, `src/api/sources.ts`, and the source form and
profile blocklist fields in `src/settings/`.

## How to verify it works

```bash
cd backend
docker compose build            # NOT optional — `up` does not rebuild
docker compose up -d
```

Add a source in the dashboard's Settings tab — name, listing URL, and at minimum
`item` and `link`. Then force a run rather than waiting for the cron:

```bash
docker compose run --rm worker node dist/once.js
```

**1. The listing parsed.** Expect `{"event":"run.complete","fetched":N,…}` with
`N` above zero and `sourceErrors: 0`, and a matching `run_log` row.

**2. Postings carry the source's name.** Not a slug, not a hostname — the literal
string you typed, spaces included:

```bash
docker compose exec db psql -U jobradar -d jobradar \
  -c "select source, title, company from postings where source = '<your name>'"
```

**3. `hydrate` actually fetched the detail pages — check the description
LENGTH.** This is the check that matters, and it is the one no unit test can make
for you. "Postings appeared" and "postings have descriptions" were both true
while the hydrated body was being silently reverted to the listing snippet on the
next tick. Only the character count distinguishes them:

```bash
docker compose exec db psql -U jobradar -d jobradar \
  -c "select title, length(description) from postings where source = '<your name>'"
```

A hydrated description is a different order of magnitude from a listing snippet
— thousands of characters against hundreds. If you see hundreds, `hydrate` either
did not run or did not persist. Run the pipeline a **second** time and check the
lengths again: they must stay large. Reverting to the snippet on the second run
is the exact regression the `upsert`/`saveHydrated` split prevents.

**4. The title blocklist rejects before the fetch.** Add a word matching one of
those postings to the source's `blockedTitleWords` (or the global profile list),
and re-run. Because blocklists are not retroactive, either use a posting that has
no score row yet, or delete its score row first:

```bash
docker compose exec db psql -U jobradar -d jobradar \
  -c "delete from scores where posting_id = '<id>'"
```

Expect `hardFiltered` to rise and `classified` not to, and a score row with
`provider_id = 'hard-filter'` and `reasoning = 'hard-filter:title-word:<word>'`.

### Verification limits

Recorded as they stood when this was written, as environment conditions rather
than defects in the feature:

- **Classification was not verified end to end.** The `ANTHROPIC_API_KEY` in the
  environment returned `401 authentication_error` on every call, so the pipeline
  was exercised up to and including the classifier invocation and its error
  handling — `classifyErrors` counted, no score row written, posting left
  retryable — but never through a successful model response.
- **Telegram notification was not verified end to end** for the same reason: the
  `TELEGRAM_BOT_TOKEN` returned `401 Unauthorized`.
- The global `profile.blockedTitleWords` list was verified by unit test only; the
  live run used a source's own list, to avoid mutating a real install's settings.
  The two meet one line above the gate, as
  `[...profile.blockedTitleWords, ...spec.blockedTitleWords]`.
- "The title gate skips the detail fetch" is inferred from control flow and from
  `sourceErrors: 0`, not from a request-level trace. The unit suite asserts the
  ordering directly.

## Re-adding Djinni and DOU

The adapters that held these selectors are deleted, so this is the only surviving
copy. Both were verified parsing live on 2026-08-26. Neither set needs a `detail`
selector to *work*, but adding one is recommended — see the limitation above.

**Djinni** — listing URL `https://djinni.co/jobs/keyword-node/`

```
item:        div.job-item[id^="job-item-"], li.list-jobs__item, li[id^="job-item"]
link:        a.job_item__header-link, a.job-item__title-link, a.job-list-item__link
title:       h2.job-item__position, .job-item__position
company:     header .text-gray-800, a.js-analytics-event, .job-list-item__company
location:    .location-text
description: div.fw-medium, .job-list-item__job-info, .job-item__description
```

**DOU** — listing URL e.g. `https://jobs.dou.ua/vacancies/?category=Node.js`

```
item:        li.l-vacancy
link:        a.vt
company:     a.company
location:    span.cities
description: div.sh-info
```

The comma-separated alternates in the Djinni set are the markup fallbacks the old
adapter hand-rolled in TypeScript; cheerio handles them natively, so the generic
adapter needs no fallback logic of its own. DOU has no `title` selector because
the title is the link's own text, which is the documented fallback.
