# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

README.md is the command reference (quick start, Docker Compose table, REST API,
local-model switching, rubric tuning). This file covers what it does not: how the
pieces fit and where the non-obvious seams are.

## Commands not in README.md

```bash
cd backend && npx jest src/filters.spec.ts            # one unit file
cd backend && npx jest -t "hard filter"               # one test by name
cd backend && npx vitest run test/integration/postings.repository.integration.test.ts
cd backend && npm run generate                        # new migration from schema.ts diff
cd dashboard && npx vitest run tests/App.test.tsx
```

Two test runners, split by intent, not by convention:

- **Jest** — `backend/src/**/*.spec.ts`, `rootDir: src`. Pure unit tests, no
  containers. This is `npm test`.
- **Vitest** — `backend/test/integration/**/*.integration.test.ts`, serial
  (`fileParallelism: false`), 30s timeout. Each suite self-skips unless its env
  var is present: `DATABASE_URL_TEST` for the three database suites,
  `INTEGRATION=1` for the live-source suite that drives `createCustomSource`
  against a real board and asserts the recorded selectors still parse. The live
  suite skips silently without its var, so a green `test:integration` with no env
  set proves nothing.

  The database suites do **not** skip — they *throw at module load* without
  `DATABASE_URL_TEST`. So `INTEGRATION=1 npm run test:integration` on its own
  cannot pass (3 failed, 1 passed, 1 skipped). Both variables are always needed:

  ```bash
  cd backend && INTEGRATION=1 \
    DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar_test \
    npm run test:integration
  ```

  **Point `DATABASE_URL_TEST` at a scratch database, never at `jobradar`.**
  `settings.schema.integration.test.ts` opens with `DELETE FROM app_settings`, so
  a run against the real database destroys the user's CV, rubric and profile in
  its first statement. `jobradar_test` exists on the compose Postgres for this.
- Dashboard uses Vitest + jsdom (`tests/**/*.test.{ts,tsx}`).

The integration suite's hook timeout is 60s, not Vitest's 10s default: the
first Postgres connection of a process can take 10-20s cold, and the default
failed those runs spuriously. The test bodies themselves are fast.

## Architecture

Two independent projects, no shared source. `GET /api/postings` and
`GET /api/health` are the entire contract between them.

### backend/ — one Nest DI graph, three entrypoints

`AppModule` (config + db + pipeline) is the shared core. Each entrypoint layers
its own concern on top:

| Entrypoint | Adds | Runs |
|---|---|---|
| `worker.main.ts` | `WorkerModule` (`@nestjs/schedule`) | `@Cron(CRON_SCHEDULE ?? '*/30 * * * *')`, plus one run at boot |
| `once.ts` | nothing | one `PipelineService.run()`, then `app.close()` |
| `main.ts` | **not** `AppModule` — only `DatabaseModule` + `SettingsModule` + `ApiModule` | HTTP server |

The API deliberately does not import `AppModule`: it never classifies, never
notifies, and must not require `ANTHROPIC_API_KEY` to boot. It does import
`SettingsModule`, which is DB-backed and has no filesystem dependency, so that
stays true.

`PipelineService.run()` is the whole product loop, in one readable method:
fetch per source → `repo.upsert` (always, so `last_seen` advances) →
`repo.hasScore` gate → **title blocklist** → **`source.hydrate` detail fetch** →
remaining hard filters → LLM classify → then a separate `dispatchNotifications`
pass. Four details carry weight:

- The dedup gate is *has a score row*, not *have we seen it*. A posting whose
  classification threw has no score row and is retried next tick.
- Hard-filtered postings get a real score row with `providerId: 'hard-filter'`
  and `reasoning: 'hard-filter:<rule>'`. They are recorded, not dropped, and are
  visible in the dashboard.
- The **title** blocklist runs before the detail fetch and the rest of the hard
  filters run after it. That split is the whole reason the filters are two calls
  (`applyTitleFilter`, then `applyHardFilters`) instead of one: a title we
  already reject is not worth an HTTP request, but the salary and
  description-word rules read `description`, and a listing snippet rarely
  carries either. So hydrate sits *after* the dedup gate — a posting's detail
  page is fetched once ever, not every tick — and *before* the rules that need
  its output.
- A `hydrate` failure increments `sourceErrors` and writes a `run_log` row **per
  posting**, whereas a listing failure writes one row per source. The counter is
  deliberately mixed-granularity: it makes the health panel noisy on a board
  whose detail pages all fail, and that is the price of each posting staying
  individually retryable rather than one bad detail page aborting the source.

### Two writes to `postings`, and why they are not one

`PostingsRepository` exposes two write paths, and the distinction is load-bearing:

- `upsert(p)` means *"I saw this posting again."* It inserts, or on conflict
  advances `last_seen` and **nothing else**. The pipeline calls it for every
  listed posting on every tick, before the dedup gate.
- `saveHydrated(p)` means *"here is the real content."* It is the only path
  allowed to overwrite a posting's body — `url`, `title`, `company`, `location`,
  `employmentType`, `description`, `raw`, `lastSeen` — and it is called once,
  right after a successful `hydrate`.

Collapsing them into one content-refreshing upsert is exactly the bug that
end-to-end verification caught: the row held the full hydrated description for
one cron interval, then the next tick's unconditional `upsert(listed)` reverted
it to the listing snippet — or to `''` for a source with no listing
`description` selector. The unit tests could not see it, because a mocked repo
does not model `onConflictDoUpdate`. If you ever need `upsert` to refresh a
column, you almost certainly want `saveHydrated` instead.

Neither write touches `postings.source`. It is a snapshot of the source's name
at fetch time, which is why renaming a source in the dashboard leaves older
postings filed under the old name.

Scores accumulate — `insertScore` appends, never overwrites. Every row carries
`providerId` and `settingsVersion`, because scores from different models or
different settings are not comparable. That single fact explains the
per-provider notify threshold (`NOTIFY_THRESHOLD_<PROVIDER_ID>`, sanitised, in
`NotifyConfig.thresholdFor`), the `app_settings.version` counter, the
dashboard's stale-score badge, and why re-running is safe.

`app_settings.version` bumps on a CV, profile, or rubric save — all three feed
the classifier — but **not** on a source change, because which boards are
polled does not affect how a vacancy is judged.

Swappable seams are DI tokens with factory providers, all resolved from env or
config at module construction:

- `LLM_PROVIDER` — `selectProvider(env)` in `classifier.module.ts`:
  `LLM_BASE_URL` → OpenAI-compatible, else `ANTHROPIC_API_KEY` → Anthropic, else
  throw. The token is defined in `providers/types.ts`, not the module, to break a
  DI cycle. `providers/fake.ts` exists for tests.
- `BUILD_SOURCE` — a factory taking **one** `SourceSpec` and returning one
  `JobSource`. `PipelineService` calls it once per enabled source, inside the
  loop. Per-spec rather than per-run because the pipeline needs each source's
  own blocklists alongside its adapter, and zipping two arrays by index to
  recover that pairing is a bug waiting to happen. It is a factory at all
  because sources are editable: a boot-time array could not see a source added
  from the dashboard. There is now exactly one adapter behind it,
  `createCustomSource` — adding a board is a database row, not a code change.
- `NOTIFIER` — currently Telegram; `notifications` is keyed by `channel`.

`ClassifierService.classify` retries once on parse failure by appending the
validation error to the user prompt and asking for bare JSON; two failures throw
and the posting is left unscored for the next run.

### One adapter, driven by stored CSS selectors

`src/sources/custom.ts` is the only job source. `createCustomSource(spec)` reads
`spec.selectors` — `item` and `link` required, `title`, `company`, `location`,
`employmentType`, `description`, `detail` optional — and cheerio-parses the
listing at `spec.url`. `listPostings()` yields one `RawPosting` per `item` match;
`hydrate()` fetches each posting's own page and replaces `description` with the
text under `detail`, or with the whole page's text if `detail` is unset.

The seams inside it that are not obvious from the signature:

- **`cheerio` parses static HTML only.** A board that renders its listing in the
  browser yields zero postings, and no selector can fix that. This is the
  feature's one hard limitation, not a bug to be filed.
- **`externalIdFrom(url)` keeps the host and the query string, minus referrer
  parameters**
  (`from`, `referrer`, `utm_*`, ad-click ids). The pathname alone is not enough —
  a board addressing postings as `/job?id=42` would collapse every posting onto
  one id. `from` is stripped because DOU's listing links carry `?from=list_hot`,
  which would otherwise split one vacancy across several postings. `ref` and
  `source` are deliberately **not** stripped: a false merge silently drops a
  posting from scoring, while a false split only wastes one duplicate
  classification, so the list errs short on purpose. The host is in the id for
  that same reason: an aggregator's links can point at different company sites,
  and without it `a.com/careers/backend` and `b.com/careers/backend` would be
  one posting.
- **A `detail` selector is close to mandatory in practice.** Without one,
  `hydrate` falls back to `htmlToText(whole page)`, which drags in nav, JSON-LD
  and sidebar text. That is not merely wasted tokens: verification against DOU
  produced `hard-filter:salary` rejections on three good postings because the
  page chrome contained `$1000`/`$1500` from the site's own salary-filter widget,
  and `statedSalaryUsd` cannot tell those from the vacancy's own figures.
- **A `detail` selector that matches nothing keeps the listing description**
  rather than blanking the field — a silent downgrade is worse than a stale
  snippet.

Blocklists are two pairs of string arrays, matched whole-word and
case-insensitively (`matchBlockedWord` in `filters.ts`, using lookarounds rather
than `\b` so `c++` and `.net` behave). `profile.blockedTitleWords` /
`blockedDescriptionWords` are global; each source row carries its own two lists.
The pipeline concatenates them per source — a source may add words but never
subtract them, so the global lists are a floor.

**Blocklists are not retroactive.** Removing a word does not bring back the
postings it already rejected: a rejection writes a score row, and the dedup gate
is "has a score row". Re-considering one means deleting its score row by hand.

### Settings live in Postgres, not on disk

`src/settings/` owns two tables: `app_settings` (a singleton row — CV, rubric
body, rubric weights, profile, `version`) and `sources`. A `sources` row is a
name, a listing URL, a `selectors` jsonb blob, two blocked-word arrays and an
`enabled` flag — no `kind`, no `board`, no `slug`. `name` and `url` each carry a
unique constraint (`sources_name_uniq`, `sources_url_uniq`), so a 23505 is
ambiguous and `sources.controller.ts` reads `constraint_name` to say which one
collided. `name` is user-facing in two ways at once: it is the source's display
label *and* its `JobSource.id`, which is what lands in `postings.source` and in
`run_log.source`. `SettingsService.load()` composes both tables into an
immutable `AppSettings` snapshot, filtering `sources` to the enabled rows.

`PipelineService.run()` reads that snapshot **once** at the top of a tick and
threads it into hard filters, the classifier, and source construction. One read
per tick means a run can never observe settings changing under it mid-flight,
and the next tick picks up a dashboard edit with no restart. There is no cache:
a cache spanning the `worker` and `api` containers would need LISTEN/NOTIFY.

Consequences worth knowing:

- `AppConfigService` and the `SOURCES` token are gone. `classify()` and
  `weightedTotal()` take what they need as arguments instead of injecting it.
- Rubric weights are normalised by their **actual sum**, not by 100
  (`classifier/rubric.ts`). Only relative weights ever mattered, so `35/20/15/20/10`
  and `70/40/30/40/20` are the same rubric. `RubricWeightsSchema` refuses
  all-zero weights, which would divide by zero and store `NaN` as a total.
- Verdict bands (`toVerdict()`, 75/50) stay in code. Weights only affect scores
  computed after a change; the bands define what STRONG *means* across the whole
  history.
- A fresh install has an empty CV and no sources, so `run()` guards: it writes a
  `run_log` row reading `settings incomplete: <what>` and returns without calling
  the model. That surfaces in the dashboard's health panel and drives the
  first-run banner.

`src/settings/import.ts` and `seed.ts` are **not** on the runtime path. The
`migrate` compose service runs `seed.ts` once after `drizzle-kit migrate`: if
`app_settings` has a row it exits, otherwise it imports a v1 `/config` directory
if `cv.md` is there, and falls back to built-in defaults. `CONFIG_DIR` and the
`../config` mount survive **only** on `migrate`, for that one-shot import.

Neither the importer nor the seeder writes **any** `sources` row any more, and a
v1 `config/sources.yaml` is ignored even when present — it carries no selectors,
so it cannot produce a usable row. A fresh install therefore starts with zero
sources and `run()` logs `settings incomplete: no enabled sources` until the user
adds one from the dashboard. `seed.integration.test.ts` asserts the empty
`sources` table explicitly, so this stays true by test rather than by accident.

Two upgrade-path properties of the schema-0003 migration:

- It **`DELETE`s every existing `sources` row**, by design. `name` and
  `selectors` are `NOT NULL` and there is nothing in a v1 `kind`/`board`/`slug`
  row to backfill them from. An upgrading user re-adds their boards through the
  dashboard; their postings and scores survive untouched.
- The global blocked-word lists live **inside the `app_settings.profile` jsonb**,
  which the migration never rewrites. A v1 profile blob has no
  `blockedTitleWords` key at all, and parses anyway because `ProfileSchema`
  declares both arrays with `.default([])`. Those defaults only apply where
  something actually parses, and there are **two** read paths that must:
  `SettingsService.load()` for the worker, and `SettingsController.read()` for
  `GET /api/settings`. Both call `ProfileSchema.parse(row.profile)`. The
  controller's parse is not redundant with the service's — it is the one the
  dashboard depends on, and returning the raw jsonb there hands `undefined` to
  `ChipInput`'s `value.map()`, which unmounts the whole app with no way to
  recover from the UI (`PUT /api/settings/profile` is `.strict()` and demands
  both arrays). Integration tests cover a v1-shaped blob through both paths.

### dashboard/ — two routes, one of them a write surface

The visual design of both pages is specified in `docs/dashboard design/`;
follow it rather than inventing layout.

React 19 with `react-router-dom`, no state library and no data-fetching
library — a `useApi` hook over `fetch` and a `useSave` hook for the writes.
`App` is the layout: it owns all three fetches, renders the masthead, and
publishes `{postings, health, settings, ui, setUi}` through
`DashboardDataContext`. `/` renders `pages/PostingsPage`, `/settings` renders
`pages/SettingsPage`, anything else redirects to `/`. A context rather than
`<Outlet context>` because a component test can then wrap one component in a
provider instead of standing up a router.

`BrowserRouter` means real paths, so **the production static host must rewrite
unknown paths to `/index.html`** or a hard refresh on `/settings` 404s. Vite's
dev server already does.

**Postings state lives entirely in the query string.** `src/api/filters-url.ts`
is the only thing that knows the encoding: `parseFilters` / `toSearchParams`
for the URL, `toApiFilters` for the request. There is no mirrored `useState`,
so Back and Forward step through filter changes. Two consequences worth
knowing: the URL stores a *relative* window (`since=7d`), never a computed
date, so a bookmark does not silently freeze as it ages; and the min-score
slider commits on release rather than on input, because a range input fires per
pixel of drag and each commit would push a history entry.

Everything derived — day buckets, relative time, near miss, stale, rejection
sentences — lives in `src/postings/derive.ts`, is pure, and **takes `now` as an
argument**. No hidden clock is what makes day bucketing testable. The masthead's
"N new" comes from the same `groupByDay` call the feed uses, so the two cannot
disagree.

Presentation is CSS Modules over one global token file. `src/styles/tokens.css`
is the **only** file permitted to define `:root` custom properties or style bare
element selectors; everything else is a `*.module.css` beside its component.
The Settings surface shares one scoped `components/settings.module.css` rather
than five near-identical modules — `section`, `actions`, `field` and `state`
mean the same thing in each, and duplicating them would be the old global sheet
under a new name. `dashboard/tsconfig.json` must keep `vite/client` in its
`types` array or CSS-module imports stop typechecking.

The Settings page has four sections (CV, profile, sources, rubric), each with
its own dirty-tracked Save button and its own error state, matching the three
separate document `PUT`s — that is what makes "one version bump per save" fall
out of the design instead of needing diff logic.

Settings state is owned by `App`, not by `SettingsPage`, so the Postings page's
stale-score badge sees a save immediately and changing route does not refetch.
`SettingsPage` gates on `data`, never on `loading`: a reload triggered by one
section's save would otherwise unmount the other three mid-edit and discard
whatever was typed into them. No optimistic updates — `PUT`, then refetch; on
failure the form stays dirty and keeps the user's input.

Writes are safe to expose only because the API binds `127.0.0.1` in every
compose service and secrets never cross the boundary. **Publishing port 8080
requires authentication first.**

In dev, Vite proxies `/api` to
`:8080`, which makes development same-origin. In production the SPA is deployed
to its own server, so requests are cross-origin: the API enables CORS only when
`CORS_ORIGIN` is set. Parsing lives in `src/cors.ts` — `main.ts` has no test
seam, that function does. A bare `*` maps to `origin: true`, not `['*']`,
because the `cors` package matches array entries literally. The backend serves
no static assets; `ServeStaticModule` and `STATIC_ROOT` were removed when the
projects were split.

Response shapes are declared twice on purpose — `backend/src/api/api.schema.ts`
(Zod, also the query-param validation via `zod-validation.pipe.ts`) and
`dashboard/src/api/types.ts` (plain types). Changing one means changing the
other. It is the accepted cost of keeping the projects independent; a shared
types package is a reasonable thing to propose, but not to introduce unasked.

A posting row carries `subscores` — the five rubric dimensions, each a
`{score, note}` on the same 0-100 scale as `total` — which the dashboard's
breakdown panel renders as bars. Because the two projects deploy separately, a
dashboard newer than its API sees rows without that field: `LedgerRow` treats a
missing `subscores` as "no breakdown available" rather than throwing. Deploy the
API first.

### Docker

Everything Docker lives in `backend/`, and the build context is `backend/` —
`docker compose` commands run from there, not from the repository root.
`Dockerfile` has a `dev` stage (full deps + `tsx watch`) and a `runtime` stage
(`npm ci --omit=dev`). The `migrate` service builds from **dev** because
`drizzle-kit` is a devDependency and is absent from runtime. `worker` and `api`
are the same runtime image with different `command`s. Postgres is published on
host `5433` (5432 is often taken); in-network clients still use `db:5432`.
The `dev` profile (`worker-dev`, `api-dev`) bind-mounts `backend/src` for watch
mode. `api` and `api-dev` bind `127.0.0.1:8080:8080`, but `db`'s `5433:5432` has
no host prefix, so Postgres is reachable from the local network on port 5433
with the `jobradar`/`jobradar` credentials in `.env` — and there is no auth on
the API either.

`name: jobradar` on the first line is load-bearing. Compose otherwise derives
the project name from the compose file's directory, and `backend/` would give
`backend_pgdata` instead of `jobradar_pgdata` — a silently empty database.

`config/` is no longer runtime input — settings live in Postgres. The
`../config` mount and `CONFIG_DIR` survive on the `migrate` service alone, so a
v1 install can import its `cv.md`, `rubric.md` and `profile.yaml` once. A v1
`config/sources.yaml` is **not** imported at all — see the settings section — so
boards are always re-added from the dashboard. `config/` is now gitignored; an
upgrading user must untrack it *before* pulling, or a checkout would restore the
shipped placeholder CV over their real one before the seeder ever reads it.

Two Docker traps that cost real debugging time:

- **`docker-compose up` does not rebuild.** Run `docker-compose build` first or
  you run stale images against a migrated database. The symptom is a `run_log`
  row like `Failed query: select "id", "kind", "board", "slug" … from "sources"`
  — an old image reading columns migration 0003 dropped.
- **`docker-compose run --rm migrate` prints `migrations applied successfully!`
  whether it applied four migrations or none**, because `drizzle/` is `COPY`ed
  into the image rather than bind-mounted. Without `docker-compose build migrate`
  first it cheerfully reports success while applying nothing. The message is
  identical either way, which is exactly why the trap is invisible.

And one on generating migrations: `npm run generate` needs a **TTY** for any
migration that both adds and drops columns on the same table — `drizzle-kit`
stops to ask, interactively, whether each pair is a create or a rename. Piping
its output, or running it from a non-interactive tool call, hangs or answers
wrong.

## Working in this repo

This project was built spec-first: the design spec is in
`docs/superpowers/specs/` and the implementation plan in
`docs/superpowers/plans/`. Read the spec before making a change that alters
behaviour rather than implementation — it records intent the code cannot.
`.claude/agents/plan-validator.md` defines the agent that checks a plan against
its spec.

### After implementing a feature

A feature is not done when the code passes. Two documentation steps close it:

1. **Update the existing docs** that the change invalidated — README.md
   (commands, env vars, REST API table), this file (architecture, seams,
   invariants), and `.env.example` if a new variable was introduced. Grep for
   the old behaviour rather than guessing which files mention it.
2. **Write a feature doc** at `docs/features/<feature-name>.md` describing what
   was built: the problem it solves, the design decision and the alternatives
   rejected, the files it touches, and how to verify it works. This is the
   record of intent that the diff cannot carry.
