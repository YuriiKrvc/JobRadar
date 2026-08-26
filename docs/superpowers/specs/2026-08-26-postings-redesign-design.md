# Postings redesign and dashboard routing — design

**Status:** approved for planning
**Date:** 2026-08-26
**Source material:** `docs/dashboard design/Postings - design doc.html` (page 1 of 2)

## Problem

The dashboard is a two-tab `useState` toggle over a five-column table. Three
things are wrong with it, and the design doc names all three:

1. **There is no addressable state.** Settings has no URL, so it cannot be
   linked, bookmarked, or reloaded into. Neither can a filter set.
2. **`scoredAt` is fetched and never shown.** The primary job — "what is new
   and worth my time today?" — cannot be answered from the screen at all.
3. **`subscores` is stored and never exposed.** The audit job — "why did it
   score that?" — is answered by one reasoning sentence, while five
   dimensions with per-dimension notes sit unused in the database.

The design doc frames the page around a two-minute daily scan, with the audit
tools one click below that scan rather than beside it.

## Scope

In: routing, the Postings page redesign, the shared shell, one backend field,
and the styling substrate both pages will use.

Out: re-laying-out Settings (page 2 of the design doc, a follow-up task that
also depends on the unimplemented custom-sources feature). Settings moves to
its own route and inherits the new tokens and font, but its layout is
unchanged.

## Decisions

### Routing — `react-router-dom` v7, real paths

| Route | Renders |
|---|---|
| `/` | `pages/PostingsPage.tsx` |
| `/settings` | `pages/SettingsPage.tsx` (moved from `components/`) |
| `*` | `<Navigate to="/" replace/>` |

`App` stops being the application and becomes the layout: masthead plus
`<Outlet/>`. `BrowserRouter` mounts in `main.tsx`.

**The data-ownership invariant survives the split.** CLAUDE.md records that
`App` owns the settings fetch specifically so the stale-score badge on
Postings sees a Settings save without a refetch. The three `useApi` calls stay
in the layout and reach the pages through a `DashboardDataContext`, not
through `<Outlet context>` — a context is directly mockable in component
tests, where an outlet context forces every test to build a router.

**Deployment consequence.** `BrowserRouter` needs a history fallback. Vite's
dev server provides one; the production static host does not, and the SPA
deploys to its own server. A rewrite rule (`/* -> /index.html`) becomes a
deployment requirement and is documented in README.md.

Rejected: hash routing (works on any host, but the URLs are the product's
only shareable surface and `#/settings` reads as a workaround); a hand-rolled
`pushState` hook (same server requirement as the library, and re-implements
what the library gives for free).

### Filters live in the URL

`src/api/filters-url.ts` — two pure functions, `parseFilters(URLSearchParams)`
and `toSearchParams(PostingFilters)`. `PostingsPage` reads `useSearchParams`
as the single source of truth; there is no mirrored `useState`, so back and
forward genuinely work.

Malformed or unknown params are **ignored, not rejected**: a hand-edited URL
degrades to defaults rather than erroring. The backend's
`PostingFiltersSchema` remains the real validator.

Two UI-only params ride along: `sort=asc|desc` and `rejected=1`.

**The slider needs care.** A range input pushes a history entry per pixel of
drag. Min score keeps local state while dragging and commits to the URL on
release or blur; every other control commits immediately.

### Styling — CSS Modules, one global token file

`src/styles/tokens.css` is global and imported once in `main.tsx`: Broadsheet's
`:root` custom properties (paper `#f3f2f2`, ink `#201e1d`, cyan `#0088b0`,
magenta `#d6006c`, the three tonal ramps, process yellow, the space, radius
and shadow scales), the `@fontsource/source-serif-4` imports, and a thin base
layer — `body`, link colours, focus ring. Nothing component-specific.

Every component gets a sibling `Foo.module.css`. `src/styles.css` is deleted
and its rules are redistributed to the components that own them, including the
Settings components, whose layout is otherwise untouched.

Variants are class names chosen in the component (`s[band]`, `s.nearMiss`,
`s.stale`), never style props. The design is **light only**, per the doc.

Two mechanical prerequisites:

- `dashboard/tsconfig.json` declares an explicit `types` array without
  `vite/client`, so `import s from './X.module.css'` does not typecheck
  today. `vite/client` must be added.
- Vitest stubs CSS modules with a proxy returning the key, so `s.numeral` is
  `"numeral"` under test. No config change is needed, and no existing test
  queries by class name.

Rejected: `styled-components` (in maintenance mode as of 2025, ~12kB runtime,
and the mock's values transfer verbatim only into plain CSS);
`vanilla-extract` (best type safety, but a build plugin and an unfamiliar
authoring syntax is more machinery than two screens need).

### The Postings page

Ledger layout — the six-column dense row, chosen over the doc's "brief"
default. Masthead tabs, not the left rail.

New components under `src/components/postings/`:

- **`Masthead.tsx`** — wordmark, tagline, `role="tab"` links, the 3px rule,
  the uppercase status line (`date · run · N new · N scored · settings vN`),
  the 1px rule. "N new" is derived from the same day bucket the feed uses, so
  the two cannot disagree.
- **`SetupBanner.tsx`** — today's `settingsError` logic restyled as the SET UP
  block; `role="alert"`, links to `/settings`.
- **`Filters.tsx`** — rewritten. Verdict becomes a segmented Any / Strong /
  Maybe / No group with `aria-pressed`; source and provider stay selects; min
  score becomes the slider; "scored since" becomes relative options (any,
  24 hours, 7 days, 30 days) mapped to a date. Right-aligned: the result count
  line and a sort toggle carrying `aria-sort`.
- **`PostingsFeed.tsx`** — splits hard-filtered rows out, buckets the rest by
  UTC calendar date of `scoredAt`, sorts by total within each day, emits
  `Today / Yesterday / N days ago` dividers carrying their own date and count.
- **`LedgerRow.tsx`** — 31px numeral with ink weight by band | verdict word,
  pips, near-miss and stale tags | role and company · location | source |
  reasoning plus the breakdown toggle | relative time.
- **`ScoreBreakdown.tsx`** — the five dimensions as labelled bars with value,
  weight share and the per-dimension note; one `aria-label` speaks the values.
  Bars draw in **neutral ink when the row is stale**, so an incomparable score
  never looks comparable.
- **`RejectedStrip.tsx`** — one line, "N postings never reached the model —
  12 location, 4 salary · Show them", expanding to the rejected rows.
- **`EmptyState.tsx`** — the fresh-install five-line pipeline explainer with
  two buttons into Settings, and the "no posting matches these filters ·
  Clear filters" variant.
- **`SourceHealth.tsx`** — rewritten as per-source panels, each with the last
  ten runs as a bar strip (ink ok, neutral timeout, magenta failure), a status
  word, a note, and a `role="alert"` line when a board is failing.

### Verdict is never carried by colour alone

Three redundant carriers on every row: the band word in letterspaced small
caps, three pips filled 3 / 2 / 1 behind a `role="img"` with a spoken label,
and the numeral's own ink weight — full ink for STRONG, progressively lighter
for MAYBE and NO. Near miss adds tag text and the numeric gap; stale adds the
⚠ glyph and the version number in a bordered tag.

The CMYK misregistered-plate numeral from the mock is **not built**: it needs
an SVG filter library and carries no information.

### Pure logic, extracted

`src/postings/derive.ts` — `isHardFiltered`, `ruleOf`, `rejectionSentence`,
`isNearMiss`, `isStale`, `dayBucket`, `relativeTime`, `pipCount`, `bandInk`.

Every time-dependent function **takes `now` as an argument**. There is no
hidden clock, which is what makes day bucketing and relative time testable
without freezing global time. This module is the TDD seam; the components stay
thin enough to test by rendering.

### Backend — one field, no migration

`scores.subscores` already exists as `jsonb` typed `SubScores`, each dimension
`{ score, note }`. The work is:

- add `subscores` to `PostingRowSchema` (five keys, each `{score: int, note:
  string}`),
- select it in `DashboardQueries.latestScores`,
- mirror the type in `dashboard/src/api/types.ts` — the deliberate double
  declaration CLAUDE.md describes.

Hard-filtered rows already store `ZERO_SUBSCORES`, so the shape is uniform and
the schema needs no union.

`sourceHealth()` already returns the last 20 run-log rows, enough to build the
per-source strip. No endpoint changes.

## Where the mock outruns the code

Both are flagged, not built:

- Its rejection examples (`hard-filter:title-word:php`, "rejected at the
  listing page … the job page was never downloaded") assume blocked-word
  filters that do not exist. `applyHardFilters` has exactly three rules:
  `location`, `employment-type`, `salary`. `rejectionSentence` covers those
  three and falls back gracefully for any rule added later.
- "Repair this source's selectors" assumes the custom-sources feature specced
  in `docs/superpowers/specs/2026-08-26-custom-sources-design.md` and not yet
  implemented. The button links to `/settings`; the per-source deep link lands
  with that feature.

## Testing

- **Unit (Vitest, dashboard):** `derive.ts` and `filters-url.ts` — pure, and
  written test-first. Round-trip property for the filter serializer; boundary
  cases for `dayBucket` across a UTC midnight and for `isNearMiss` at 39 / 40 /
  49 / 50.
- **Component (Vitest + jsdom):** dividers render in order; the rejected strip
  toggles; the breakdown expands and its bars carry the values; a filter
  change writes to the URL and a URL change drives the list; `/settings`
  renders Settings under `MemoryRouter`.
- **Backend (Jest):** `PostingRowSchema` accepts a real row and rejects a
  malformed `subscores`.
- **Backend (Vitest integration):** `latestScores` returns `subscores`
  round-tripped through Postgres — runs only with `DATABASE_URL_TEST` set.

## Documentation this invalidates

- **CLAUDE.md** — the dashboard section states "no router … Two screens do not
  justify a routing dependency" and describes the two-tab `useState`. That
  paragraph is rewritten, not patched. The API-contract note gains
  `subscores`.
- **README.md** — the SPA rewrite requirement for the production host, and the
  REST API table's postings response shape.
- **`docs/features/postings-redesign.md`** — new, per the repo's
  after-implementing-a-feature rule.

## Open questions carried from the design doc, and their resolutions

| Question | Resolution |
|---|---|
| Rejected rows: behind a count, or inline? | Behind a count. Reversible in one line. |
| Which breakdown chart? | Horizontal bars — the most readable of the three. |
| Tabs or left rail? | Masthead tabs. The rail costs horizontal room on a phone. |
| Brief or ledger row? | Ledger. Density over prose. |
| Should stale rows sort differently? | No. They rank among comparable scores and are marked, not moved. Revisit if it proves noisy. |
