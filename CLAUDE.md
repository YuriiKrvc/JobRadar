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
| `main.ts` | **not** `AppModule` — only `DatabaseModule` + `ApiModule` | HTTP server |

The API deliberately does not import `AppModule`: it never classifies, never
notifies, and must not require `ANTHROPIC_API_KEY` or `/config` to boot.

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
`providerId` and `rubricVersion`, because scores from different models or rubric
versions are not comparable. That single fact explains the per-provider notify
threshold (`NOTIFY_THRESHOLD_<PROVIDER_ID>`, sanitised, in
`AppConfigService.notifyThresholdFor`), the version header requirement in
`config/rubric.md`, and why re-running is safe.

Swappable seams are DI tokens with factory providers, all resolved from env or
config at module construction:

- `LLM_PROVIDER` — `selectProvider(env)` in `classifier.module.ts`:
  `LLM_BASE_URL` → OpenAI-compatible, else `ANTHROPIC_API_KEY` → Anthropic, else
  throw. The token is defined in `providers/types.ts`, not the module, to break a
  DI cycle. `providers/fake.ts` exists for tests.
- `SOURCES` — `buildSources(cfg.sources)` fans `config/sources.yaml` out into
  `JobSource[]` (ats/djinni/dou). Adding a board means a new `createXSource`
  returning `{ id, listPostings() }` plus a `SourcesSchema` entry.
- `NOTIFIER` — currently Telegram; `notifications` is keyed by `channel`.

`ClassifierService.classify` retries once on parse failure by appending the
validation error to the user prompt and asking for bare JSON; two failures throw
and the posting is left unscored for the next run.

Config is filesystem-first: `AppConfigService` reads `CONFIG_DIR` (default
`/config`, bind-mounted read-only from `../config`) once at construction and
validates with Zod. `cv.md`, `profile.yaml`, `sources.yaml`, `rubric.md` are
required; a missing one is a boot failure, by design. Changing config means
restarting the worker.

### dashboard/ — read-only SPA

Plain React 19, no router, no state library, no data-fetching library — an
`useApi` hook over `fetch` and four components. In dev, Vite proxies `/api` to
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

`config/` stays at the repository root and is mounted from `../config`: it is
hand-edited operational input, not backend source.

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
