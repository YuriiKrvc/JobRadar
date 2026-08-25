# Per-project Docker and env configuration — Design

**Date:** 2026-08-25
**Status:** Approved, ready for implementation planning

## Problem

`README.md` and `CLAUDE.md` both open by calling JobRadar "two independent
projects in one repository" that "share no source". The filesystem contradicts
that. Every deployment artefact sits at the repository root and is implicitly
backend-owned:

| Root file | Actual owner |
|---|---|
| `docker-compose.yml` | backend — all six services are backend processes |
| `Dockerfile` | backend — every stage is `COPY backend/…` |
| `.dockerignore` | backend — three of six entries are `backend/`-prefixed |
| `.env`, `.env.example` | backend — `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TELEGRAM_*` |

Nothing at the root is shared. A reader opening `docker-compose.yml` cannot tell
which project it configures without reading it, and `backend/` cannot be built,
run, or reasoned about without climbing out of its own directory.

The coupling is not only cosmetic. The `api` service bind-mounts
`./dashboard/dist` into the API container and sets `STATIC_ROOT`, so the
backend's deployment descriptor reaches into the frontend's build output.

This was not drift. `2026-08-25-jobradar-design.md` chose it deliberately, and
named its price: "Backend serves the built SPA — same-origin, so no CORS, no
proxy config, no second container" against the cost "frontend build is coupled
into the backend image". "Independent projects" was always scoped to *source*,
never to deployment. What changes now is the deployment target, not our
assessment of that trade-off at the time it was made.

## Supersedes

The original spec said to revisit same-origin serving "only if the dashboard is
exposed publicly and needs TLS termination and auth". That trigger has not
fired. This spec revisits it on a different one: **the dashboard will be
deployed to a separate server.** Once the SPA is hosted elsewhere, the backend
can never be the thing serving it, so the bind-mount and `STATIC_ROOT` are not a
trade-off to weigh — they are unreachable configuration.

That also settles the question the original spec left open. Same-origin serving
is no longer available at any price, so the API must answer cross-origin
requests, and CORS stops being an avoidable complication.

## Goal

`backend/` owns its Docker and env configuration. `dashboard/` gains nothing it
does not use. The repository root keeps only what is genuinely shared or
user-owned.

## Scope

**In scope:** moving `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.env`
and `.env.example` into `backend/`; rewriting every path they contain; removing
the `dashboard/dist` mount and `STATIC_ROOT` from the `api` service; deleting
`ServeStaticModule` and the `@nestjs/serve-static` dependency; adding a
`CORS_ORIGIN`-driven CORS layer; updating `README.md` and `CLAUDE.md`; writing
the feature doc.

After this change, no file under `backend/` refers to `dashboard/`, and no file
under `dashboard/` refers to `backend/`. That is the acceptance criterion the
rest of the spec serves.

**Explicitly not in scope:**

- **A frontend container.** `dashboard/` is not containerised today and will not
  be. No `dashboard/docker-compose.yml`, no `dashboard/Dockerfile`.
- **A `dashboard/.env`.** The dashboard reads no environment variables — `grep`
  for `import.meta.env` and `VITE_` across `dashboard/src` and `dashboard/tests`
  returns nothing. Creating an empty file for symmetry would be a lie about how
  the SPA is configured.
- **A root `docker-compose.yml`.** No `include:` shim. Bringing the stack up
  means `cd backend && docker compose up -d`.
- **Moving `config/`.** `cv.md`, `profile.yaml`, `sources.yaml` and `rubric.md`
  are user-owned operational data — what you edit, not what you deploy. They
  stay at the repository root and are mounted from `../config`.
- **Standing up the frontend's server.** The SPA is deployed to a separate
  server; provisioning it, and choosing what serves `dist/` there, is its own
  task. This spec's obligation is that the backend works correctly once that is
  true — which means CORS.

## Target layout

```
.gitignore  README.md  CLAUDE.md  docs/  config/     ← root keeps only these
backend/
  docker-compose.yml    moved; paths rewritten; explicit project name
  Dockerfile            moved; COPY paths de-prefixed
  .dockerignore         moved; paths de-prefixed
  .env  .env.example    moved; gains CORS_ORIGIN
  src/  test/  drizzle/ …
dashboard/              unchanged
```

The five root files are deleted, not copied.

## Design

### The build context shifts one level down

`Dockerfile` moves to `backend/Dockerfile`. Its build context becomes `backend/`,
so every path de-prefixes:

| Before | After |
|---|---|
| `COPY backend/package.json backend/package-lock.json ./` | `COPY package.json package-lock.json ./` |
| `COPY backend/tsconfig.json backend/tsconfig.build.json ./` | `COPY tsconfig.json tsconfig.build.json ./` |
| `COPY backend/src ./src` | `COPY src ./src` |
| `COPY backend/drizzle ./drizzle` | `COPY drizzle ./drizzle` |
| `COPY backend/drizzle.config.ts ./` | `COPY drizzle.config.ts ./` |
| `COPY backend/ ./` | `COPY . ./` |

The four-stage structure (`api-deps` → `api-build` → `runtime`, plus `dev`) is
unchanged, including the reason the `migrate` service builds from `dev`:
`drizzle-kit` is a devDependency and `runtime` installs with `--omit=dev`.

`context: .` inside the compose file needs no textual edit — it simply resolves
to `backend/` now. This is the one change that is invisible in the diff and must
be verified by building, not by reading.

### `.dockerignore` de-prefixes and sheds dead entries

```
node_modules
dist
.env
test
coverage
```

`.git`, `docs` and `dashboard/tests` are removed: they lie outside the new
context and can no longer match anything.

### The compose file keeps its shape, changes its paths

Four path edits and two deletions:

- `./config:/config:ro` → `../config:/config:ro` (`worker`, `worker-dev`)
- `./backend/src:/app/src:ro` → `./src:/app/src:ro` (`worker-dev`, `api-dev`)
- `api`: delete `STATIC_ROOT: "/app/public"` and the
  `./dashboard/dist:/app/public:ro` volume
- `api-dev`: delete `STATIC_ROOT: ""` — an unset variable already disables
  static serving, so the empty string was a redundant way of saying "off"; it
  documented the contrast with the `api` service, which no longer sets it

`env_file: [.env]` needs no change; it resolves relative to the compose file's
own directory. Every service definition, healthcheck, `depends_on` condition,
port binding and `dev` profile is otherwise preserved verbatim, including the
`tsc`-not-`tsx` watch commands and the reason for them.

### Project name must be pinned, or the database is orphaned

Compose derives its project name from the directory containing the compose file.
Moving `JobRadar/docker-compose.yml` to `backend/docker-compose.yml` changes that
name from `jobradar` to `backend`, and with it the volume name: the existing
`jobradar_pgdata` would be abandoned and a fresh empty `backend_pgdata` created
on the next `up`. Every stored posting and score would appear to vanish.

The compose file therefore gains an explicit project name:

```yaml
name: jobradar
```

This is the highest-risk element of the change. It is verified by observation —
`docker volume ls | grep pgdata` before and after — not by reasoning.

### Static serving is removed; CORS replaces it

`ServeStaticModule` is deleted from `backend/src/main.ts`, along with the
`staticRoot` constant, the conditional `imports` spread, and the
`@nestjs/serve-static` dependency in `backend/package.json`. The backend no
longer serves static assets at all.

Keeping it as a dormant opt-in was considered and rejected. With the SPA on its
own server there is no path that sets `STATIC_ROOT`, so the branch is
unreachable — a dependency and a conditional retained for a scenario the
deployment model excludes. Deleting it is what makes "no references between the
two projects" true in the code and not merely in the compose file.

Because the SPA is served from another origin, `main.ts` gains an
`app.enableCors()` call driven by a new `CORS_ORIGIN` variable. This is not a
convenience: with static serving gone, **the dashboard cannot reach the API in
production unless `CORS_ORIGIN` names its origin.** Absent the variable, CORS
stays off, which is the correct default for the worker-only and API-only
deployments that have no browser client.

The parsing lives in `backend/src/cors.ts` rather than inline in `main.ts`.
`main.ts` is a bootstrap script with no test seam; a small exported function has
one, and `src/**/*.spec.ts` is the repository's existing home for Jest unit
tests. The function maps the raw environment value to CORS options or to
`undefined`, and handles a comma-separated list of origins.

**`CORS_ORIGIN` is load-bearing in production and inert in development.** The
documented dev flow — `npm run dev`, Vite proxying `/api` to `:8080` — is
same-origin, so the variable is never exercised there and a green local run
proves nothing about it. Production is the opposite: the deployed dashboard is
cross-origin by construction and fails without it. The docs must state both
halves, or the first deployment breaks in a way local testing cannot predict.

### `backend/.env.example`

Unchanged apart from one addition:

```
CORS_ORIGIN=http://localhost:5173
```

`.gitignore` needs no edit — its bare `.env` pattern is not anchored to a
directory and already matches `backend/.env` (confirmed with
`git check-ignore -v backend/.env`).

## Documentation

Three claims currently stated as invariants become false and must be rewritten
wherever they appear, rather than patched where convenient:

1. "the dashboard is built on the host and its `dist/` is bind-mounted into the
   API container" — `README.md` intro.
2. "which serves it same-origin so there is no CORS layer and no second web
   server" / "Same-origin in both, so there is no CORS layer anywhere" —
   `README.md` intro and Development section, `CLAUDE.md` `dashboard/` section.
3. "`dist/` must be built on the host before `docker compose up`" — no longer
   true; the API does not read it, and nothing in the backend does.

The replacement text must describe the actual arrangement: the backend builds
and runs on its own and exposes an API; the dashboard is built and deployed to a
separate server; the two meet only over HTTP, and `CORS_ORIGIN` is what permits
that meeting. The README's "Two independent projects" claim becomes true of
deployment as well as source, which is worth saying explicitly since it was
previously true only of source.

`README.md` also needs `cd backend` in the quick start, in the commands table,
in the Development section, in "Switching to a local model" (`.env` →
`backend/.env`) and in "Tuning the rubric" (`docker compose restart worker`).
`CLAUDE.md`'s Docker section gains the project-name pin and loses the
`dashboard/dist` mount; its `dashboard/` section loses the `ServeStaticModule`
paragraph and gains the CORS seam. `backend/package.json` loses
`@nestjs/serve-static`, so `package-lock.json` changes too — `npm install` in
`backend/`, committed, not hand-edited.

Per `CLAUDE.md`'s post-feature rule, a feature doc is written to
`docs/features/per-project-docker-config.md`. It is the first file in that
directory.

## Verification

| Check | Command | Expected |
|---|---|---|
| Compose parses from its new home | `cd backend && docker compose config` | no error; `../config` and `./src` resolve |
| Database survives the move | `docker volume ls \| grep pgdata` | `jobradar_pgdata`, before and after |
| Image builds in the new context | `cd backend && docker compose build` | all four stages succeed |
| Stack runs | `cd backend && docker compose up -d` then `curl -s :8080/healthz` and `curl -s :8080/api/health` | both respond |
| API serves no static assets | `curl -s -o /dev/null -w '%{http_code}' :8080/` | 404 — no SPA, no index.html |
| CORS preflight honoured | `curl -si -X OPTIONS :8080/api/postings -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: GET'` | `Access-Control-Allow-Origin: http://localhost:5173` |
| CORS off by default | same request with `CORS_ORIGIN` unset | no `Access-Control-Allow-*` header |
| Unit suite green | `cd backend && npm test` | passes, including the new `cors.spec.ts` |
| Dashboard still works | `cd dashboard && npm run dev` | SPA at `:5173` shows live postings via the Vite proxy |
| No cross-project references | `grep -rn 'dashboard' backend/` | no hits outside comments about the API contract |
| No stale references | `grep -rn 'STATIC_ROOT\|serve-static\|dashboard/dist\|docker compose up' README.md CLAUDE.md backend/` | no hits except in this spec and the feature doc |

The last row matters as much as the others: `CLAUDE.md` instructs grepping for
old behaviour rather than guessing which files mention it.

## Rejected alternatives

**An nginx container for the dashboard**, proxying `/api` to the backend. It
preserves same-origin and gives the frontend a real compose file, but it adds a
second web server, a `dashboard/Dockerfile`, and a shared external Docker
network so two compose projects can reach each other — substantial machinery for
a read-only SPA that a static host serves for free.

**A root `docker-compose.yml` using `include:`**, so `docker compose up` keeps
working from the root. It reintroduces at the root exactly the file the change
exists to remove, and requires Compose v2.20+. A `cd` is cheaper than the
indirection.

**Keeping the `dashboard/dist` bind-mount**, with or without a `DASHBOARD_DIST`
variable to make the path configurable. It preserves today's behaviour and needs
no CORS, but the frontend is moving to its own server: there will be no
`dashboard/dist` on the backend host to mount.

**Retaining `ServeStaticModule` as a dormant opt-in.** Attractive because it
deletes nothing and leaves a one-line path back to same-origin serving. Rejected
once the deployment target was settled: nothing sets `STATIC_ROOT` in a
separate-server topology, so it is a dependency and a code branch kept alive for
a configuration that will not occur. Restoring it later is a small, obvious
change guided by this spec and the original one.

**Creating `dashboard/.env` with a `VITE_API_URL`.** Symmetric, but it invents a
configuration knob the frontend does not have in order to populate a file it
does not need.

**Moving `config/` into `backend/`.** Defensible — `AppConfigService` is its only
reader — but it is hand-edited operational input, not backend source, and root
is where a user expects to find it.
