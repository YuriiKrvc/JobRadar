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
cp .env.example .env && $EDITOR .env   # Telegram token + chat id, CORS_ORIGIN
docker compose up -d --build
curl localhost:8080/api/health
```

Classification needs an Ollama running on the host, with one setup step
compose cannot do for you — see [The classifier](#the-classifier-a-local-model-by-default)
before expecting any posting to get scored.

The dashboard is a separate project with its own lifecycle. Continuing in the
same shell (still inside `backend/` from the block above):

```bash
cd ../dashboard && npm ci && npm run dev   # http://localhost:5173, proxies /api to :8080
```

To deploy it, `npm run build` and copy `dist/` to any static host, then set
`CORS_ORIGIN` in `backend/.env` to that host's origin and
`cd backend && docker compose restart api`. The API serves no static assets.

The dashboard opens on an empty Postings feed with a "finish setup" prompt.
Switch to **Settings**, paste your CV, set your hard constraints, and add at
least one source. The next scheduled run picks them up.

## Adding a source

A source is a **name**, a **listing URL**, and the **CSS selectors** that find
postings on it. There is no list of supported boards — you point it at a careers
page and describe its markup.

| Selector | Required | What it must match |
|---|---|---|
| `item` | yes | One element per posting, on the listing page |
| `link` | yes | The link to the posting, inside `item` |
| `title` | no | Falls back to the link's own text |
| `company` | no | Falls back to the source's name — right for a single-company careers page |
| `location` | no | |
| `employmentType` | no | |
| `description` | no | The listing snippet |
| `detail` | no | The element on the **posting** page holding its description |

`detail` is the one worth setting even though it is optional. Without it, the
whole posting page's text becomes the description, which drags in nav bars,
cookie banners and sidebars — that wastes tokens on every classification and can
trip the hard filters, because a `$1500` in the site's own salary-filter widget
looks exactly like the vacancy's salary to the salary rule.

To find selectors, open the listing page, right-click a posting, Inspect, and
read the class names. Comma-separated alternates work (`li.job, div.job-item`),
so you can cover a board that uses two layouts.

Save the source, then watch it work:

```bash
cd backend
docker compose logs -f worker                  # wait for the next tick, or
docker compose run --rm worker node dist/once.js   # run the pipeline once, now
```

A healthy source logs `{"event":"run.complete","fetched":N,…}` with `N` above
zero and `sourceErrors: 0`. If `fetched` is `0`, your `item` or `link` selector
matched nothing — or the board renders its listing in JavaScript, which cannot
work: the parser reads static HTML only, and no selector will fix it.

### Blocked words

Two lists reject postings before the LLM ever sees them, saving the tokens:
**title** words are checked first, before the posting's detail page is even
fetched; **description** words are checked after. Matching is whole-word and
case-insensitive, so `php` does not match `phpstorm`, and `c++` and `.net` work
as written.

Set them globally in the profile, and per-source on a source. A source's lists
are *added* to the global ones — a source can never opt out of a global word.

A rejection is recorded, not discarded: the posting appears in the dashboard with
`hard-filter:title-word:<word>` as its reasoning. **Rejections are not
retroactive** — removing a word does not bring back what it already rejected,
because a rejection writes a score row and a posting with a score row is never
reconsidered. To re-test one, delete its score row:

```bash
docker compose exec db psql -U jobradar -d jobradar \
  -c "delete from scores where posting_id = '<id>'"
```

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

**Verify before you delete the backup.** Open the dashboard at `/settings`, or:

```bash
curl -s localhost:8080/api/settings | head -c 400
```

Confirm you see your real CV, your excluded locations, and your salary floor —
not the "Replace this with your CV" placeholder. Only then remove
`../jobradar-config-backup`. If you see the placeholder, the import took the
wrong files: restore the backup into `config/`, empty the database
(`cd backend && docker compose down -v`), and bring the stack up again.

The first run backfills every currently-listed vacancy — expect roughly ten
times a normal run's cost, once.

The API has no authentication and binds to `127.0.0.1` only. Do not publish
port 8080 without a reverse proxy providing TLS and auth. The dashboard is a
static bundle deployed wherever you choose — its exposure is your call, not
this repository's. **Its host must rewrite unknown paths to `/index.html`**:
the SPA uses real routes (`/`, `/settings`), so without that rewrite a hard
refresh or a shared link to `/settings` returns 404. Deploy the API before the
dashboard when upgrading — a dashboard newer than its API degrades (no
sub-score breakdown) rather than breaking, but the reverse order is the one
that reads correctly. Postgres, however, is published on `5433` on *all*
interfaces with the default `jobradar`/`jobradar` credentials — change them or
bind `127.0.0.1:5433:5432` in `backend/docker-compose.yml` before running on a
shared network.

## Commands

| Command | Purpose |
|---|---|
| `cd backend && docker compose build` | Rebuild the images — **do this after every code or migration change** |
| `cd backend && docker compose up -d` | db → migrations → worker + API. Does **not** rebuild |
| `cd backend && docker compose run --rm worker node dist/once.js` | One pipeline run, then exit |
| `cd backend && docker compose logs -f worker` | Follow scheduled runs |
| `cd dashboard && npm run build` | Build the SPA for deployment |
| `cd backend && npm test` | Backend unit suite — Jest, no containers needed |
| `cd backend && npm run test:integration` | Integration suite — Vitest; needs `DATABASE_URL_TEST`, plus `INTEGRATION=1` for the live-board suite |
| `cd dashboard && npm test` | Dashboard suite |

`docker compose up -d` starts whatever images already exist. After changing code
or adding a migration, `docker compose build` first — otherwise you run a stale
image against a migrated database, and the failure surfaces only as a `run_log`
row complaining about columns that no longer exist.

`DATABASE_URL_TEST` is **not** optional for `test:integration`: the three
database suites throw at module load without it, so `INTEGRATION=1` on its own
cannot pass. Point it at a scratch database — the suites truncate
`app_settings`, so aiming it at your real one destroys your CV and profile:

```bash
cd backend && INTEGRATION=1 \
  DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar_test \
  npm run test:integration
```

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
| GET | `/api/postings` | Query: `verdict`, `source`, `provider`, `minTotal`, `since`, `limit`. Rows carry `subscores` — the five rubric dimensions, each `{score, note}` |
| GET | `/api/health` | Last 20 source runs |
| GET | `/healthz` | Liveness |
| GET | `/api/settings` | `{cv, rubricBody, rubricWeights, profile, version, updatedAt}` |
| PUT | `/api/settings/cv` | `{cv}` — bumps `version` |
| PUT | `/api/settings/rubric` | `{body, weights}` — bumps `version` |
| PUT | `/api/settings/profile` | Whole profile document — bumps `version` |
| GET | `/api/sources` | All rows, enabled and disabled |
| POST | `/api/sources` | `{name, url, selectors, blockedTitleWords?, blockedDescriptionWords?}` — 201; 409 if the name or the URL is taken |
| PUT | `/api/sources/:id` | Same body; replaces the row in place, leaving `enabled` alone. 404 on unknown id, 409 on a name or URL collision |
| PATCH | `/api/sources/:id` | `{enabled}` — toggle only; 404 on unknown id |
| DELETE | `/api/sources/:id` | 204; 404 on unknown id |

The three document `PUT`s are separate so that one save is one version bump,
with no diff logic deciding whether a bump is warranted. Each replaces its whole
document, so a body missing a field is rejected rather than defaulted.

A source is a **name, a listing URL and a set of CSS selectors** — there is no
board or slug. `PUT` replaces all of that in place, which is how you fix a
selector that a site's redesign broke without losing the row's `enabled` state.
`PATCH` is the narrow toggle for `enabled` alone.

Two consequences of editing in place. A posting's stable id embeds the source's
**UUID**, not its name, so renaming a source does not orphan its postings — but
`postings.source` is a copy of the name taken at fetch time and is never
refreshed, so older postings stay filed under the old name. And changing the
`url` re-points the row at a different listing: postings already fetched under
the old URL keep their ids and simply stop being re-seen.

Source edits do **not** bump `app_settings.version`. Which boards you poll does
not change how a vacancy is judged, so existing scores are not marked stale.

Errors carry one shape across every endpoint, and the dashboard reads `message`:

```json
{ "statusCode": 400, "error": "Bad Request", "message": "profile.minSalaryUsd: must be a positive integer" }
```

**These endpoints write, and there is no authentication.** They are safe only
because the API binds `127.0.0.1` in every compose service; reach it over an SSH
tunnel. Publishing port 8080 requires adding auth first.

Response shapes live in `backend/src/api/api.schema.ts` and are mirrored in
`dashboard/src/api/types.ts`. **Changing one means changing the other** — that
duplication is the deliberate price of keeping the projects independent.

## The classifier: a local model by default

Classification runs against an Ollama on the **host machine**, not in this
compose stack. Docker Desktop cannot expose the Mac's GPU to a Linux
container, so a containerised model would run CPU-only — minutes per posting
instead of seconds.

That means a few prerequisites `docker-compose up` cannot satisfy for you:

```bash
ollama pull llama3.1

# Ollama binds 127.0.0.1 by default, and a host loopback socket is NOT
# reachable from a container: host.docker.internal resolves to the host's
# routable interface. Without this, every classification fails ECONNREFUSED.
launchctl setenv OLLAMA_HOST 0.0.0.0   # macOS; then restart Ollama

# Ollama's server-side context window defaults to 2048 tokens on older
# releases and 4096 on recent ones — smaller than this project's prompt (the
# CV and rubric as the system message, plus up to ~12000 characters of
# description as the user message). An over-long prompt is *silently
# truncated from the front*, where the CV and rubric live, rather than
# rejected: the failure mode is a 200 OK and a schema-valid score computed
# without your CV. Set this generously; it costs memory, so a per-model
# `num_ctx` is the alternative if 8192 is too much for your machine.
launchctl setenv OLLAMA_CONTEXT_LENGTH 8192   # macOS; then restart Ollama
```

On Linux there is no `launchctl`; set both variables in a systemd drop-in
instead, then restart the service:

```bash
systemctl edit ollama.service
# [Service]
# Environment="OLLAMA_HOST=0.0.0.0"
# Environment="OLLAMA_CONTEXT_LENGTH=8192"
systemctl restart ollama
```

A host firewall can still drop traffic arriving on Docker's `docker0`
interface even with both variables set — check that before assuming Ollama
itself is misconfigured.

**While `OLLAMA_HOST=0.0.0.0` is set, Ollama accepts connections from your
local network.** There is no auth on it — the same caveat as this project's
Postgres, published on 5433 with no host prefix.

`.env.example` also ships `LLM_JSON_SCHEMA=true`, which asks Ollama to
constrain output to a JSON schema — supported from **Ollama 0.5** onward. An
older daemon returns HTTP 400 on every classification, so check `ollama
--version` before anything else if requests fail outright.

The matching `backend/.env` (already the default in `.env.example`):

```
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1
LLM_JSON_SCHEMA=true
# LLM_TIMEOUT_MS=120000
```

Prove the worker can actually reach it before trusting any score:

```bash
cd backend && docker-compose exec worker sh -c 'wget -qO- $LLM_BASE_URL/models'
```

A JSON list of models means you are done. `Connection refused` means
`OLLAMA_HOST` is not in effect — restart Ollama after setting it.

Reachability alone does not prove classification is *working* — a too-small
context window still returns 200 OK with a plausible-looking verdict. Watch
the worker's log for the real failure signal instead:

```bash
docker-compose logs -f worker | grep "classify failed for"
```

The scheduled tick runs every 30 minutes by default (`CRON_SCHEDULE`); rather
than wait for one, run the pipeline once and exit:

```bash
docker-compose run --rm worker node dist/once.js
```

`LLM_BASE_URL` is free-form, so the same variable points at a LAN address or a
remote GPU box with no compose change. Unset it and the worker falls back to
`ANTHROPIC_API_KEY`.

`LLM_TIMEOUT_MS` (default 120000) aborts a stalled completion via
`AbortSignal.timeout()`. The pipeline awaits classification inline, so without
it one hung request stalls the whole tick. A timeout is not retried with a
repair prompt — only a parse failure is, since retrying a request that never
answered would falsely tell the model its "previous response" was invalid —
so a genuinely unresponsive model costs exactly one `LLM_TIMEOUT_MS` per
posting, not two. A model that responds but returns unparsable JSON twice in a
row still costs up to two round trips serially, each as long as
`LLM_TIMEOUT_MS` if the response is also slow. Either way, the posting is left
unscored and the next tick retries it.

### Scores from two models are not comparable

Every score row records the provider that produced it, and re-running adds rows
rather than overwriting. Two consequences:

- **Postings already scored are never re-scored.** The dedup gate is "has a
  score row", so switching models does not revisit your history — the local
  model judges only postings first seen after the switch. Re-considering one
  means deleting its score row by hand.
- The notify threshold is per provider, `NOTIFY_THRESHOLD_<PROVIDER_ID>` with
  non-alphanumerics replaced by `_`. For the default above the provider id is
  `openai-compat:llama3.1`, so the variable is
  **`NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1`**. Expect to tune it: a local
  model's numbers will not match a frontier model's.
- **Lowering that threshold also surfaces old postings.** The pending-notification
  query filters on `scores.total` alone, not on which provider produced the
  score, so setting the new provider's threshold below what the previous one
  was tuned to re-evaluates every already-scored posting still under the old
  bar — including a backlog scored by whichever provider you switched away
  from — and can notify all of it on the next tick.

## Tuning the rubric

Open the dashboard at **`/settings`** and edit the rubric prose or
the five dimension weights. Saving bumps the settings version, which is stored
with every score written afterwards, so old scores stay interpretable and the
postings feed marks any row scored under an older version.

Weights do not need to sum to 100 — each one is normalised by the actual total,
and the percentage shown beside it is what the score uses. Raising `coreStack`
from 35 to 70 doubles its influence without touching the other four.

Changes take effect on the next scheduled run (every 30 minutes). No restart.

Watch the near-miss band (scores 40–49, shown in red) — a cluster of good
vacancies there means the rubric needs adjustment.
