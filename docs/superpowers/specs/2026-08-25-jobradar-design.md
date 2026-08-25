# JobRadar — Design

**Date:** 2026-08-25
**Status:** Approved, ready for implementation planning

## Problem

Watching several job boards by hand is slow and easy to drop. Vacancies that fit
get missed because they scroll past during a busy week. JobRadar polls configured
job sources, scores every new vacancy against the author's CV and constraints, and
pushes matches to Telegram.

## Scope

**In scope (v1):** the full pipeline (fetch → dedupe → filter → classify → store →
notify), three source adapters (ATS boards, Djinni, DOU), a pluggable classifier,
Telegram notifications, and a local web dashboard.

**Deferred to a later spec:** LinkedIn (needs a persistent authenticated browser
session, actively resists automation, and carries account risk — it is its own
project) and a generic "paste any listing URL" adapter.

## Architecture

Six pipeline stages, run in order by the worker:

```
sources.yaml ──► [1] adapters ──► RawPosting[]
                                      │
                    [2] dedupe ───────┤  posting already has a score row → skip
                                      ▼
                    [3] hard filters ─┤  location / employment type → verdict NO, no LLM call
                                      ▼
                    [4] classifier ── provider + CV + rubric ──► FitVerdict
                                      ▼
                    [5] store ──────► Postgres
                                      ▼
                    [6] notify ─────► Telegram (total ≥ threshold)
```

Dedupe and hard filters run before the classifier so no vacancy is ever paid for
twice, and obvious rejects cost nothing.

The repository holds two independent projects:

```
backend/     pipeline, worker, REST API   (Node + TypeScript)
dashboard/   read-only UI                 (Vite + React + TypeScript)
```

They share no source. The REST API is the entire contract between them.

### Stack

- Node 22, TypeScript, ESM
- Global `fetch` + `cheerio` for HTML parsing
- Postgres 17 + Drizzle ORM (`postgres.js` driver)
- `@anthropic-ai/sdk` for the default classifier provider
- NestJS 11 for the backend (DI, modules, controllers)
- `@nestjs/schedule` for the 30-minute cron
- Vitest in both projects (+ `unplugin-swc` in the backend, so Nest's DI metadata survives the test transform), plus Testing Library + jsdom in the dashboard
- Vite + React + TypeScript for the dashboard (separate project)
- Docker Compose for the backend only; the dashboard is built on the host

## Components

### 1. Source adapters

Interface:

```ts
interface JobSource {
  readonly id: string;
  listPostings(): Promise<RawPosting[]>;
}
```

| Adapter   | Mechanism                                     |
|-----------|-----------------------------------------------|
| `ats`     | Greenhouse / Lever / Ashby public JSON boards |
| `djinni`  | HTML listing pages, parsed with cheerio        |
| `dou`     | DOU public vacancy feed                        |

Companies and board URLs are listed in `sources.yaml`. Adding LinkedIn later means
adding one file satisfying `JobSource`; nothing downstream changes.

Each adapter produces a stable posting id: `source:externalId` for
single-tenant sources (Djinni, DOU) and `board:slug:externalId` for ATS boards,
where a bare external id is only unique within one company's board.

### 2. Dedupe

Every posting is upserted (`ON CONFLICT (id) DO UPDATE SET last_seen = now()`)
so `last_seen` stays current. The pipeline then skips it if it **already has a
score row**.

Keying on the score rather than the posting is deliberate: a posting whose
classification threw has no score, so the next run retries it, while a scored or
hard-filtered posting is never paid for twice. Keying on the posting row would
have made a transient classifier failure permanent.

### 3. Hard filters

Deterministic, in code, before any model call. Driven by `profile.yaml`:
excluded locations, allowed employment types, and minimum salary where one is
stated. A rejected posting is stored with `verdict = NO` and
`reasoning = "hard-filter:<rule>"`.

**Timezone is deliberately not a hard filter.** Postings state timezone
requirements in prose too irregularly to match reliably ("EU hours", "±3 CET",
"significant overlap with PST"), and a regex strict enough to be useful would
reject good vacancies silently. The timezone from `profile.yaml` is passed to
the classifier instead and scored under the logistics dimension, where a wrong
call is visible in the sub-score rather than invisible in a filter.

### 4. Classifier

Split so that domain logic is shared and model invocation is swappable.

```
classifier/
  rubric.ts       scoring scale, verdict thresholds       (shared)
  prompt.ts       buildPrompt(cv, profile, posting)       (shared)
  schema.ts       Zod schema for the verdict object       (shared)
  classify.ts     prompt → provider → validate → FitVerdict
  providers/
    types.ts      LLMProvider interface
    anthropic.ts
    openai-compat.ts   Ollama / LM Studio / vLLM / llama.cpp
    fake.ts            canned verdicts, for tests
```

Provider interface:

```ts
interface LLMProvider {
  readonly id: string;                 // "anthropic:claude-haiku-4-5", "ollama:qwen3:14b"
  complete(req: {
    system: string;
    user: string;
    schema: JSONSchema;
  }): Promise<{ raw: string; usage?: TokenUsage }>;
}
```

Schema validation and the repair retry live in `classify.ts`, not in each provider:
`raw` is parsed against the Zod schema, and on failure retried once with the
validation error appended. Local models fail schema conformance more often than
Claude does, so this belongs in one shared place.

Provider-specific behaviour stays inside the provider. The Anthropic provider uses
`output_config.format` for schema enforcement; the OpenAI-compatible provider uses
`response_format: {type: "json_schema"}` where the server supports it and falls back
to schema-in-the-prompt where it does not.

#### Default provider

`claude-haiku-4-5`, structured outputs enabled. Two model-specific notes:

- `output_config.effort` is **not** sent — it errors on Haiku 4.5.
- `thinking` is **not** sent — the rubric is explicit and classification does not
  need it.
- No `cache_control` marker. Haiku 4.5's minimum cacheable prefix is 4096 tokens
  and the CV + rubric prefix is roughly 1600; a marker there is a silent no-op.
  Revisit if the rubric grows past 4096 tokens.

Approximate cost: **~$0.004 per vacancy**, ~$12/month at 100 new postings/day. The
first run backfills every currently-listed posting (est. 500–2000), so budget a
one-time charge of roughly 10× a daily run.

#### Rubric

`rubric.md` — a versioned file loaded into the system prompt, not hardcoded. Five
anchored sub-scores; the weighted total is computed **in code**, not by the model.

| Dimension        | Weight | Measures                                                    |
|------------------|--------|-------------------------------------------------------------|
| Core stack match | 35     | Required tech vs. what the CV shows was actually shipped     |
| Seniority fit    | 20     | Right level — not a downgrade, not a screen-out stretch      |
| Domain relevance | 15     | Industry / problem-space familiarity                         |
| Logistics        | 20     | Remote policy, timezone, location, employment type           |
| Growth signal    | 10     | Movement toward stated next step                             |

Each dimension returns 0–100 plus a one-line justification. Narrow anchored
questions calibrate far better than one holistic score, and a wrong total can be
traced to the specific dimension that misfired. Arithmetic stays in code.

The file carries a `version:` header, stored with every score, so tuning the weights
does not silently make old scores incomparable.

#### Verdict bands

| Total   | Verdict | Action                                        |
|---------|---------|------------------------------------------------|
| ≥ 75    | STRONG  | Telegram notification, tagged STRONG            |
| 50–74   | MAYBE   | Telegram notification, tagged MAYBE             |
| 40–49   | NO      | Stored; surfaced in the dashboard "near miss" band |
| < 40    | NO      | Stored only                                     |

Notifying from 50 rather than 75 is deliberate given the choice of the smallest
model: Haiku is weakest exactly on borderline judgment, and an extra MAYBE to
eyeball is cheaper than a silently-rejected STRONG. The 40–49 near-miss band exists
so systematic misjudgment is visible early and the rubric (or the provider) can be
retuned with evidence.

#### Profile input

- `cv.md` — free-form prose CV, whatever would be sent to a recruiter.
- `profile.yaml` — structured hard constraints: excluded locations, allowed
  employment types, minimum salary, timezone.

Prose for the model, structured data for the code filters.

### 5. Storage

Postgres 17 via Drizzle. Three tables.

```
postings        id text PK ("source:externalId"), source, url, title, company,
                location, employment_type, raw jsonb,
                first_seen timestamptz, last_seen timestamptz

scores          id, posting_id FK → postings, provider_id, rubric_version,
                total int, verdict verdict_enum, subscores jsonb,
                reasoning text, scored_at timestamptz
                INDEX(posting_id), INDEX(total)

notifications   id, score_id FK → scores, channel, sent_at timestamptz, error text

run_log         id, source, status run_status_enum, postings_seen int,
                error text, ran_at timestamptz
```

`scores` is append-only and carries `provider_id` + `rubric_version`, because a 78
from Haiku and a 78 from a local 8B model do not mean the same thing. Rescoring
adds a row rather than overwriting.

Notify thresholds are per provider: `NOTIFY_THRESHOLD_<PROVIDER_ID>` (non-alphanumerics
replaced with `_`, uppercased) overrides the global `NOTIFY_THRESHOLD`, which
defaults to 50.

`notifications` is a separate table so a Telegram outage cannot corrupt scoring
state, and the retry query is simply "scores above threshold with no successful
notification row".

`subscores` and `raw` are `jsonb` with Drizzle `$type<>()` annotations, giving typed
access from the classifier's Zod output through to the dashboard filters.

Migrations are generated with `drizzle-kit generate` into reviewable SQL files.

### 6. Notifications

Telegram Bot API over plain HTTPS — no client library needed. One message per
match: verdict tag, total, title, company, location, one-line reasoning, link.
Send failures leave `notifications.sent_at` null so the next run retries.

### 7. Dashboard

Two separate projects in one repository, communicating over a REST API.

```
backend/     Node service: pipeline, worker, and the REST API
dashboard/   Vite + React + TypeScript SPA
```

Each has its own `package.json`, dependency tree, tests, and build. Neither
imports source from the other; the REST contract is the only coupling.

#### REST API (backend)

NestJS on port 8080, JSON only.

| Method | Path              | Returns                                                        |
|--------|-------------------|----------------------------------------------------------------|
| GET    | `/api/postings`   | Latest score per posting. Query: `verdict`, `source`, `minTotal`, `since`, `limit` |
| GET    | `/api/health`     | Last 20 `run_log` rows, newest first                            |
| GET    | `/healthz`        | `{"ok": true}` liveness probe                                   |

Responses are typed by Zod schemas in `backend/src/api/api.schema.ts`, validated at the controller boundary by a `ZodValidationPipe`. The
dashboard maintains its own matching types — duplication is accepted as the
price of keeping the two projects independent.

#### Dashboard (frontend)

Vite + React + TypeScript. One screen: a table of postings with their latest
score, client-side filtering by verdict/source/provider, sorting by total, the
40–49 near-miss band visually distinct, and a source-health panel.

Plain `fetch` with a small `useApi` hook; plain CSS. No data-fetching library
and no CSS framework — one screen against one endpoint does not justify either,
and both are additive later.

#### Serving

In development, Vite's dev server runs on 5173 with `server.proxy` forwarding
`/api` to the backend — HMR, and no CORS.

In production the backend serves the built assets via `ServeStaticModule`
alongside the API on port 8080, so requests are same-origin. Compose covers the
backend only: `dashboard/dist` is bind-mounted into the API container rather
than built inside an image, so no frontend toolchain ships in Docker. A separate static-file
container (nginx, Caddy) is deliberately not used: it adds a container and a
config file to solve a CORS-and-routing problem that same-origin serving
removes outright. Revisit only if the dashboard is exposed publicly and needs
TLS termination and auth.

## Deployment

Containerized from the first commit. Local development and production deployment
are the same compose file.

```yaml
services:
  db:       postgres:17-alpine, named volume, healthcheck
  migrate:  drizzle-kit migrate, exits 0, depends_on db healthy
  worker:   scheduled pipeline runs      # same image,
  api:      REST API + built SPA on :8080  # different command
```

`worker` and `web` build from one Dockerfile and differ only in `command`.

`migrate` is a separate one-shot service rather than an entrypoint step, so `worker`
and `web` cannot race each other applying migrations. Both declare
`depends_on: {migrate: {condition: service_completed_successfully}}`.

**Scheduling** is `@nestjs/schedule` inside `worker`, every 30 minutes — not
cron in the container. Container cron does not inherit the environment, wants to
log to files rather than stdout, and fights PID 1. An in-process scheduler keeps
logs on `docker compose logs -f worker`, inherits env naturally, and shuts down
through Nest's lifecycle hooks — which is also what closes the Postgres pool so
one-shot runs exit instead of hanging.

Resilience: each tick wraps the pipeline in try/catch so a thrown adapter cannot
kill the scheduler, and the service carries `restart: unless-stopped`. The pipeline
remains independently invocable via
`docker compose run --rm worker npm run once`.

**Dockerfile** is multi-stage and backend-only: `api-deps` (`npm ci`),
`api-build` (`tsc`), and a slim `node:22-alpine` runtime carrying only
production deps and the compiled `dist/`, running as a non-root user. The
dashboard bundle arrives as a read-only bind mount at `/app/public`. A `dev` target adds dev dependencies and runs `tsx watch` against
bind-mounted source, available via `docker compose --profile dev up`.

**Config and secrets:** `.env` (gitignored) supplies `ANTHROPIC_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DATABASE_URL`; `.env.example` is
committed. `cv.md`, `profile.yaml`, `rubric.md`, and `sources.yaml` mount read-only
at `/config`, so editing the rubric needs a `docker compose restart worker`, not a
rebuild.

First run:

```
cp .env.example .env && $EDITOR .env
docker compose up -d
open http://localhost:8080
```

VPS deployment is `git pull && docker compose up -d --build` against the same file.

**Accepted cost:** end-to-end runs now go through Docker rather than a bare Node
process. The `dev` profile recovers most of the inner loop, and the Vitest suite
runs on the host with no containers (fixtures plus `FakeProvider`, no DB), so the
tight test loop is unaffected.

## Error handling

- **Per-source isolation.** If Djinni changes its markup and that adapter throws,
  ATS and DOU still complete and still notify. Every source's outcome is written to
  `run_log` and surfaced on the dashboard — a source silently returning zero
  postings for three days is the most likely failure mode and must be visible.
- **Classifier failures** retry once via the schema-repair path. If that also
  fails, no score row is written — which is exactly what makes the next run pick
  the posting up again (see Dedupe). The failure is logged, not swallowed.
- **Telegram failures** leave `sent_at` null; the next run retries.

## Testing

Vitest, run on the host.

- Adapters against committed HTML/JSON fixtures — no network in the suite.
- Classifier against `FakeProvider`: weighted-total arithmetic, schema-repair
  retry, verdict banding, hard filters.
- Dedupe and notification-retry queries against a throwaway Postgres schema.
- One opt-in integration test hitting real endpoints, run manually, to catch
  upstream markup drift.

The dashboard has its own suite (Vitest + Testing Library, jsdom) covering
filtering, sorting, the near-miss band, and loading/error/empty states against a
stubbed `fetch`. It runs independently of the backend suite — `npm test` in
`dashboard/`.

## Decisions and trade-offs

| Decision | Rationale | Cost accepted |
|---|---|---|
| LinkedIn deferred | Needs authenticated browser session, resists automation, account risk | No LinkedIn coverage in v1 |
| Provider abstraction | Local-model switch must be a config change | One extra indirection layer |
| Haiku 4.5 default | ~$0.004/vacancy; volume is high and repetitive | Weakest at borderline judgment — mitigated by the 50 notify threshold and near-miss band |
| Weighted sub-scores | Narrow anchored questions calibrate better; misfires are traceable | Slightly larger output per call |
| Postgres from day one | jsonb querying, real migrations, no concurrent-access limits | Postgres is a hard local prerequisite |
| Drizzle | Schema-as-TS with generated reviewable SQL migrations; typed jsonb | Close call vs. hand-written SQL for a 3-table schema |
| Containerized from scratch (backend only) | Local setup and deployment are one path for the service | Slower end-to-end inner loop; the dashboard must be built on the host before `up` |
| NestJS across the whole backend | One composition model for repository, classifier, pipeline, scheduler, and controllers; lifecycle hooks close the DB pool | Framework weight and decorator metadata for what is ultimately a small service |
| Dashboard as a separate React project | Independent build, deps, and tests; the API contract is explicit rather than implied | Response types are duplicated on both sides |
| Backend serves the built SPA | Same-origin, so no CORS, no proxy config, no second container | Frontend build is coupled into the backend image |
| No nginx | It would exist only to serve static files and proxy `/api` — both solved by same-origin serving | Must add a proxy later if the dashboard is exposed publicly |
| Plain fetch + plain CSS | One screen against one endpoint; TanStack Query and Tailwind are additive later | Loading/error/refetch logic is hand-written |
| `node-cron` over container cron | Logs to stdout, inherits env, clean SIGTERM | Long-lived process; mitigated by try/catch + restart policy |

## Out of scope

- LinkedIn adapter (separate spec)
- Generic paste-any-URL adapter (separate spec)
- Auto-apply or cover-letter generation
- Multi-user support — this is a single-user tool
