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

## First run

```
cp .env.example .env && $EDITOR .env    # API keys and Telegram credentials
cd dashboard && npm ci && npm run build && cd ..
docker compose up -d --build
open http://localhost:8080
```

The dashboard opens on an empty Postings table with a "finish setup" prompt.
Switch to **Settings**, paste your CV, set your hard constraints, and add at
least one source. The next scheduled run picks them up.

### Upgrading from a file-configured install

`config/` used to be tracked, and this release stops tracking it. `git pull`
therefore refuses to run while your edited `config/cv.md` is still tracked and
modified. Do **not** unblock it with `git checkout -- config/`: that would
restore the shipped placeholder over your CV before `migrate` ever reads it, and
the seeder would import the placeholder, report `seeded-from-files`, and exit 0
with your real configuration gone.

Back it up first, untrack it locally, then pull:

```bash
cp -a config ../jobradar-config-backup    # 1. keep a copy outside the repo
git rm -r --cached config                 # 2. untrack, leaving the files on disk
git commit -m "untrack config/"           # 3. so the pull has nothing to overwrite
git pull
```

Your files stay on disk untouched, and `config/` is in `.gitignore` from here
on. Then run the first `docker compose up -d --build`: the `migrate` service
imports `config/` into the database once and never touches it again.

**Verify before you delete the backup.** Open the dashboard's Settings tab, or:

```bash
curl -s localhost:8080/api/settings | head -c 400
```

Confirm you see your real CV, your excluded locations, and your salary floor —
not the "Replace this with your CV" placeholder. Only then remove
`../jobradar-config-backup`. If you see the placeholder, the import took the
wrong files: restore the backup into `config/`, empty the database
(`docker compose down -v`), and bring the stack up again.

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

Open the dashboard, switch to the **Settings** tab, and edit the rubric prose or
the five dimension weights. Saving bumps the settings version, which is stored
with every score written afterwards, so old scores stay interpretable and the
postings table marks any row scored under an older version.

Weights do not need to sum to 100 — each one is normalised by the actual total,
and the percentage shown beside it is what the score uses. Raising `coreStack`
from 35 to 70 doubles its influence without touching the other four.

Changes take effect on the next scheduled run (every 30 minutes). No restart.

Watch the near-miss band (scores 40–49, shown in red) — a cluster of good
vacancies there means the rubric needs adjustment.
