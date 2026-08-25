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
  var is present: `DATABASE_URL_TEST` for the repository suite, `INTEGRATION=1`
  for the live-source suite that asserts real Djinni/DOU/Greenhouse selectors
  still parse. Both skip silently otherwise, so a green `test:integration` with
  no env set proves nothing.
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
`repo.hasScore` gate → hard filters → LLM classify → then a separate
`dispatchNotifications` pass. Two details carry weight:

- The dedup gate is *has a score row*, not *have we seen it*. A posting whose
  classification threw has no score row and is retried next tick.
- Hard-filtered postings get a real score row with `providerId: 'hard-filter'`
  and `reasoning: 'hard-filter:<rule>'`. They are recorded, not dropped, and are
  visible in the dashboard.

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
- `BUILD_SOURCES` — a factory, not an array. `PipelineService` calls it per run
  with the snapshot's `sources`, fanning them out into `JobSource[]`
  (ats/djinni/dou). It is a factory precisely because sources are now editable:
  a boot-time array could not see a source added from the dashboard. Adding a
  board means a new `createXSource` returning `{ id, listPostings() }` plus a
  `SourcesSchema` entry.
- `NOTIFIER` — currently Telegram; `notifications` is keyed by `channel`.

`ClassifierService.classify` retries once on parse failure by appending the
validation error to the user prompt and asking for bare JSON; two failures throw
and the posting is left unscored for the next run.

### Settings live in Postgres, not on disk

`src/settings/` owns two tables: `app_settings` (a singleton row — CV, rubric
body, rubric weights, profile, `version`) and `sources` (one row per board, with
an `enabled` flag). `SettingsService.load()` composes them into an immutable
`AppSettings` snapshot.

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
if `cv.md` is there, and falls back to built-in defaults. Guard and both inserts
are one transaction, so a partial seed cannot leave the row present and the
sources lost. `CONFIG_DIR` and the `../config` mount survive **only** on
`migrate`, for that one-shot import.

### dashboard/ — two tabs, one of them a write surface

Plain React 19, no router, no state library, no data-fetching library — a
`useApi` hook over `fetch`, a `useSave` hook for the writes, and a two-tab
`useState` toggle between Postings and Settings. Two screens do not justify a
routing dependency; a third might. The Settings tab has four sections (CV,
profile, sources, rubric), each with its own dirty-tracked Save button and its
own error state, matching the three separate document `PUT`s — that is what
makes "one version bump per save" fall out of the design instead of needing
diff logic.

Settings state is owned by `App`, not by `SettingsPage`, so the Postings tab's
stale-score badge sees a save immediately and switching tabs does not refetch.
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
v1 install can import its files once. `config/` is now gitignored; an upgrading
user must untrack it *before* pulling, or a checkout would restore the shipped
placeholder CV over their real one before the seeder ever reads it.

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
