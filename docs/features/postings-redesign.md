# Postings redesign and dashboard routing

**Spec:** `docs/superpowers/specs/2026-08-26-postings-redesign-design.md`
**Plan:** `docs/superpowers/plans/2026-08-26-postings-redesign.md`
**Source material:** `docs/dashboard design/Postings - design doc.html` (page 1 of 2)

## The problem

The dashboard was a two-tab `useState` toggle over a five-column table. Three
things were wrong, and the design doc named all three.

**There was no addressable state.** Settings had no URL, so it could not be
linked, bookmarked, or reloaded into. Neither could a filter set.

**`scoredAt` was fetched and never shown.** The primary job — "what is new and
worth my time today?" — could not be answered from the screen at all.

**`subscores` was stored and never exposed.** The audit job — "why did it score
that?" — was answered by one reasoning sentence, while five dimensions with
per-dimension notes sat unused in the database.

## What was built

Real routes (`/` and `/settings`), Postings filters held in the query string,
and the Postings page rebuilt to the Broadsheet design: a ledger feed grouped
by day, each row carrying a score numeral weighted by band, a verdict word with
pips, and an expandable five-bar sub-score breakdown. Rejected postings sit
behind a count. Source health became per-source run strips.

Settings moved to its own route and inherited the new tokens and font, but its
layout is unchanged — page 2 of the design doc is a separate task.

## Decisions, and what was rejected

**CSS Modules, not styled-components.** The user initially asked for styled
components. styled-components entered maintenance mode in 2025, carries a
~12kB runtime, and would have meant re-expressing the mock's values as template
literals. CSS Modules are built into Vite, cost nothing at runtime, and let the
design's numbers transfer verbatim. vanilla-extract was the third option — best
type safety, but a build plugin and an unfamiliar authoring syntax is more
machinery than two screens need.

One deviation from the plan as written: the plan gave each Settings component
its own module. In practice five of them share `section`, `actions`, `field`
and `state`, so they share one scoped `components/settings.module.css` instead.
Five near-identical modules would have been the global stylesheet again under a
new name.

**Real paths, not hash routing.** Hash routing works on any static host with no
configuration, but the URLs are the product's only shareable surface and
`#/settings` reads as a workaround. The cost is a deployment requirement: the
static host must rewrite unknown paths to `/index.html`.

**Relative window tokens in the URL, not computed dates.** `since=7d` rather
than `since=2026-08-19`. A bookmarked filter stays relative instead of silently
freezing as the bookmark ages.

**Rejected postings behind a count.** A deliberate departure from the original
brief's "recorded, not dropped, and visible in the dashboard", made to protect
the five-second scan. It reverts by rendering `RejectedStrip`'s `rows` inline.

**Verdict is never carried by colour alone.** Three redundant carriers on every
row: the band word, three pips filled 3/2/1 behind a `role="img"` with a spoken
label, and the numeral's own ink weight. The design doc's CMYK
misregistered-plate numeral was not built — it needs an SVG filter library and
carries no information the pips and ink weight do not.

**Clock injection over a frozen global.** Every time-dependent function in
`src/postings/derive.ts` takes `now: Date`. That is what makes "Today" mean the
UTC calendar date rather than "within 24 hours", and makes the boundary
testable without mocking global time.

## Two bugs found while building

**`settings` was rendering as a failing job board.** The pipeline logs its
settings-incomplete guard under a `settings` pseudo-source in `run_log`. The
new per-source health panel listed it as a board and raised a second
`role="alert"` for a condition `SetupBanner` already covered. `SourceHealth`
now filters it out.

**A dashboard newer than its API would crash.** The two projects deploy
separately, so version skew is a real runtime state. A posting row without
`subscores` would throw when its breakdown expanded; `LedgerRow` now treats a
missing `subscores` as "no breakdown available".

## Files

| Area | Files |
|---|---|
| API | `backend/src/api/api.schema.ts`, `dashboard.queries.ts`, `api.schema.spec.ts` |
| Tokens | `dashboard/src/styles/tokens.css` |
| Pure logic | `dashboard/src/postings/derive.ts`, `dashboard/src/api/filters-url.ts` |
| Shell | `dashboard/src/App.tsx`, `context/DashboardData.tsx`, `pages/` |
| Postings | `dashboard/src/components/postings/` (Filters, PostingsFeed, LedgerRow, ScoreBreakdown, RejectedStrip, EmptyState) |
| Chrome | `dashboard/src/components/Masthead.tsx`, `SetupBanner.tsx`, `SourceHealth.tsx` |
| Deleted | `dashboard/src/styles.css`, `PostingsTable.tsx`, `VerdictBadge.tsx` |

## Where the mock outruns the code

Both flagged rather than built:

- The mock's rejection examples (`hard-filter:title-word:php`, "rejected at the
  listing page … the job page was never downloaded") assume blocked-word
  filters that do not exist. `applyHardFilters` has exactly three rules —
  `location`, `employment-type`, `salary`. `rejectionSentence` covers those and
  falls back readably for any rule added later.
- "Repair this source's selectors" assumes the custom-sources feature specced
  in `docs/superpowers/specs/2026-08-26-custom-sources-design.md` and not yet
  implemented. The link goes to `/settings`; the per-source deep link lands with
  that feature.

## How to verify

```bash
cd backend && npm test                    # 143 tests
cd dashboard && npx tsc -b && npm test    # 174 tests
cd dashboard && npm run build
```

The integration assertion that `latestScores` round-trips `subscores` needs a
**throwaway** database — its `beforeAll` truncates every table, so never point
it at the compose database that holds real postings:

```bash
createdb -h localhost -p 5433 -U jobradar jobradar_test
cd backend
DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar_test \
  npx vitest run test/integration/postings.repository.integration.test.ts
```

By hand, with `npm run dev` in `dashboard/`:

- a hard refresh on `/settings` loads Settings, not a 404;
- the Back button steps through filter changes;
- `/?verdict=STRONG&minTotal=60` applies both filters on load;
- expanding a row's breakdown shows five bars with notes and weight shares;
- a score from an older settings version shows `⚠ v<n>` and draws its bars in
  neutral ink.
