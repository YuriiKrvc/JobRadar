# JobRadar

Polls job boards, scores each new vacancy against your CV with an LLM, and
pushes matches to Telegram. A read-only dashboard shows everything it has seen.

Two independent projects in one repository:

| Directory    | What it is                                     |
|--------------|------------------------------------------------|
| `backend/`   | NestJS: pipeline, scheduled worker, REST API    |
| `dashboard/` | Vite + React SPA consuming that API             |

They share no source and no deployment. `GET /api/postings` and `GET /api/health`
are the entire contract. The backend builds and runs on its own from
`backend/docker-compose.yml`; the dashboard is a static bundle deployed to a
server of your choosing. Because they sit on different origins, the API must be
told which origin to accept — see `CORS_ORIGIN` below.

## Quick start

If `docker compose` reports `unknown command`, your Docker installs the
standalone Compose v2 binary — substitute `docker-compose` in every command
below. True Compose v1 will not work: it supports neither version-less compose
files nor the top-level `name:` key this project depends on.

```bash
cd backend
cp .env.example .env && $EDITOR .env   # API key, Telegram token + chat id, CORS_ORIGIN
$EDITOR ../config/cv.md                # your CV, in prose
$EDITOR ../config/profile.yaml         # hard constraints
$EDITOR ../config/sources.yaml         # boards to watch
docker compose up -d --build
curl localhost:8080/api/health
```

The dashboard is a separate project with its own lifecycle. Continuing in the
same shell (still inside `backend/` from the block above):

```bash
cd ../dashboard && npm ci && npm run dev   # http://localhost:5173, proxies /api to :8080
```

To deploy it, `npm run build` and copy `dist/` to any static host, then set
`CORS_ORIGIN` in `backend/.env` to that host's origin and
`cd backend && docker compose restart api`. The API serves no static assets.

The first run backfills every currently-listed vacancy — expect roughly ten
times a normal run's cost, once.

The API has no authentication and binds to `127.0.0.1` only. Do not publish
port 8080 without a reverse proxy providing TLS and auth. The dashboard is a
static bundle deployed wherever you choose — its exposure is your call, not
this repository's. Postgres, however, is published on `5433` on *all*
interfaces with the default `jobradar`/`jobradar` credentials — change them or
bind `127.0.0.1:5433:5432` in `backend/docker-compose.yml` before running on a
shared network.

## Commands

| Command | Purpose |
|---|---|
| `cd backend && docker compose up -d` | db → migrations → worker + API |
| `cd backend && docker compose run --rm worker node dist/once.js` | One pipeline run, then exit |
| `cd backend && docker compose logs -f worker` | Follow scheduled runs |
| `cd dashboard && npm run build` | Build the SPA for deployment |
| `cd backend && npm test` | Backend unit suite — Jest, no containers needed |
| `cd backend && npm run test:integration` | Integration suite — Vitest; needs `DATABASE_URL_TEST` and/or `INTEGRATION=1` |
| `cd dashboard && npm test` | Dashboard suite |

## Development

Two separate terminals — the API watches and serves continuously, and `npm run
dev` occupies its own shell the same way:

```bash
cd backend && docker compose --profile dev up -d db api-dev   # API on :8080, tsc watch
```

```bash
cd dashboard && npm run dev   # Vite on :5173, proxies /api
```

Vite's proxy makes development same-origin, so `CORS_ORIGIN` is never exercised
locally — a working dev setup proves nothing about it. Production is
cross-origin by construction and fails without it.

## REST API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/postings` | Query: `verdict`, `source`, `provider`, `minTotal`, `since`, `limit` |
| GET | `/api/health` | Last 20 source runs |
| GET | `/healthz` | Liveness |

Response shapes live in `backend/src/api/api.schema.ts` and are mirrored in
`dashboard/src/api/types.ts`. **Changing one means changing the other** — that
duplication is the deliberate price of keeping the projects independent.

## Switching to a local model

Set these in `backend/.env` instead of `ANTHROPIC_API_KEY`:

```
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=qwen3:14b
LLM_JSON_SCHEMA=true
```

Scores from different models are not comparable — every score row records the
provider that produced it, re-running adds rows rather than overwriting, and the
notify threshold is settable per provider via
`NOTIFY_THRESHOLD_<PROVIDER_ID>` (non-alphanumerics replaced with `_`).

## Tuning the rubric

Edit `config/rubric.md`, bump its `version:` header, then
`cd backend && docker compose restart worker`. Old scores keep their old version so history
stays interpretable. Watch the near-miss band (scores 40–49, shown in red) — a
cluster of good vacancies there means the rubric needs adjustment.
