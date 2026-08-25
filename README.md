# JobRadar

Polls job boards, scores each new vacancy against your CV with an LLM, and
pushes matches to Telegram. A read-only dashboard shows everything it has seen.

Two independent projects in one repository:

| Directory    | What it is                                     |
|--------------|------------------------------------------------|
| `backend/`   | NestJS: pipeline, scheduled worker, REST API    |
| `dashboard/` | Vite + React SPA consuming that API             |

They share no source. `GET /api/postings` and `GET /api/health` are the entire
contract. Docker Compose covers the **backend only** — the dashboard is built on
the host and its `dist/` is bind-mounted into the API container, which serves it
same-origin so there is no CORS layer and no second web server.

## Quick start

```bash
cp .env.example .env && $EDITOR .env      # API key, Telegram bot token + chat id
$EDITOR config/cv.md                       # your CV, in prose
$EDITOR config/profile.yaml                # hard constraints
$EDITOR config/sources.yaml                # boards to watch

cd dashboard && npm ci && npm run build && cd ..
docker compose up -d --build
open http://localhost:8080
```

The first run backfills every currently-listed vacancy — expect roughly ten
times a normal run's cost, once.

The API and dashboard have no authentication and bind to `127.0.0.1` only. Do
not publish port 8080 without a reverse proxy providing TLS and auth.

## Commands

| Command | Purpose |
|---|---|
| `docker compose up -d` | db → migrations → worker + API |
| `docker compose run --rm worker node dist/once.js` | One pipeline run, then exit |
| `docker compose logs -f worker` | Follow scheduled runs |
| `cd dashboard && npm run build` | Rebuild the SPA (required after any frontend change) |
| `cd backend && npm test` | Backend unit suite — Jest, no containers needed |
| `cd backend && npm run test:integration` | Integration suite — Vitest; needs `DATABASE_URL_TEST` and/or `INTEGRATION=1` |
| `cd dashboard && npm test` | Dashboard suite |

## Development

```bash
docker compose --profile dev up -d db api-dev   # API on :8080, tsx watch
cd dashboard && npm run dev                     # Vite on :5173, proxies /api
```

Vite's proxy removes CORS in development; same-origin serving removes it in
production.

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

Set these in `.env` instead of `ANTHROPIC_API_KEY`:

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
`docker compose restart worker`. Old scores keep their old version so history
stays interpretable. Watch the near-miss band (scores 40–49, shown in red) — a
cluster of good vacancies there means the rubric needs adjustment.
