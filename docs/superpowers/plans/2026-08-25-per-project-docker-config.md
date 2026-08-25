# Per-project Docker and env configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Docker and env artefact into `backend/`, which already owns
all of them, and sever the last runtime link to `dashboard/` so the backend
builds and runs with no reference to the frontend.

**Architecture:** Four tasks in dependency order. First a pure, unit-tested
`CORS_ORIGIN` parser. Then the `main.ts` rewrite that adopts it and deletes
`ServeStaticModule`. Then the physical file move, which rewrites every path the
moved files contain and pins the Compose project name so the existing Postgres
volume survives. Finally the documentation, which has three now-false claims to
retract.

**Tech Stack:** NestJS 11, Jest (`rootDir: src`, `testRegex: .*\.spec\.ts$`),
Docker Compose v2, Node 22 Alpine.

**Spec:** `docs/superpowers/specs/2026-08-25-per-project-docker-config-design.md`

## Global Constraints

- **`name: jobradar` must be the first line of `backend/docker-compose.yml`.**
  Compose derives the project name from the compose file's directory. Without
  the pin, moving the file renames the volume `jobradar_pgdata` →
  `backend_pgdata` and the existing database is silently abandoned.
- **Never run `docker compose down -v`** at any point in this plan. The `-v`
  flag deletes the volume this plan exists to protect. Plain `down` is safe.
- **Acceptance criterion:** when the plan is complete, `grep -rn 'dashboard' backend/`
  returns nothing but comments about the HTTP API contract, and
  `grep -rn 'backend' dashboard/src dashboard/tests` returns nothing.
- **CORS is off by default.** An unset or empty `CORS_ORIGIN` must leave the API
  with no `Access-Control-Allow-*` headers — correct for worker-only and
  API-only deployments that have no browser client.
- **The `config/` directory does not move.** It stays at the repository root and
  is mounted from `../config`.
- Backend commands run from `backend/`. Every `docker compose` invocation in
  this plan after Task 3 assumes that working directory.

---

### Task 1: `CORS_ORIGIN` parser

A pure function with no Nest dependency, so it can be unit-tested without
booting an application. `main.ts` is a bootstrap script with no test seam; this
is the seam.

**Files:**
- Create: `backend/src/cors.ts`
- Test: `backend/src/cors.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `corsConfigFrom(raw: string | undefined): CorsConfig | undefined`
  and `type CorsConfig = { origin: string[] | true }`. Task 2 calls it from
  `main.ts` and passes the result straight to `app.enableCors()`.

The `true` in that union is not cosmetic. Express's `cors` package matches an
array of origins **literally** against the request's `Origin` header, so
`{ origin: ['*'] }` matches nothing and fails silently. A bare `*` must become
`{ origin: true }`, which is how that package spells "any origin".

- [x] **Step 1: Write the failing test**

Create `backend/src/cors.spec.ts`:

```ts
import { corsConfigFrom } from './cors';

describe('corsConfigFrom', () => {
  it('returns undefined when the variable is unset', () => {
    expect(corsConfigFrom(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty or whitespace-only value', () => {
    expect(corsConfigFrom('')).toBeUndefined();
    expect(corsConfigFrom('   ')).toBeUndefined();
  });

  it('wraps a single origin in an array', () => {
    expect(corsConfigFrom('http://localhost:5173')).toEqual({
      origin: ['http://localhost:5173'],
    });
  });

  it('splits a comma-separated list and trims each entry', () => {
    expect(corsConfigFrom('http://a.example, http://b.example')).toEqual({
      origin: ['http://a.example', 'http://b.example'],
    });
  });

  it('drops empty entries from a ragged list', () => {
    expect(corsConfigFrom('http://a.example,, ,http://b.example')).toEqual({
      origin: ['http://a.example', 'http://b.example'],
    });
  });

  // The cors package compares array entries literally, so ['*'] would match
  // no origin at all. `true` is how that package spells "any origin".
  it('maps a bare asterisk to origin: true, not to ["*"]', () => {
    expect(corsConfigFrom('*')).toEqual({ origin: true });
    expect(corsConfigFrom('  *  ')).toEqual({ origin: true });
  });

  it('treats an asterisk inside a list as a literal origin, not a wildcard', () => {
    expect(corsConfigFrom('*,http://a.example')).toEqual({
      origin: ['*', 'http://a.example'],
    });
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

```bash
cd backend && npx jest src/cors.spec.ts
```

Expected: failure resolving `./cors` — "Cannot find module './cors' from 'src/cors.spec.ts'".

- [x] **Step 3: Write the implementation**

Create `backend/src/cors.ts`:

```ts
/**
 * CORS configuration derived from the CORS_ORIGIN environment variable.
 *
 * `origin: true` means "any origin"; a string array is matched literally by the
 * `cors` package that Nest delegates to.
 */
export type CorsConfig = { origin: string[] | true };

/**
 * Parses CORS_ORIGIN into options for `app.enableCors()`.
 *
 * Returns `undefined` when the variable is absent or blank, which leaves CORS
 * off — the right default for the worker and for API deployments with no
 * browser client. A bare `*` becomes `origin: true` rather than `['*']`,
 * because the `cors` package compares array entries literally and `['*']`
 * would therefore match no request at all.
 */
export function corsConfigFrom(raw: string | undefined): CorsConfig | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  if (trimmed === '*') return { origin: true };

  const origins = trimmed
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  return origins.length > 0 ? { origin: origins } : undefined;
}
```

- [x] **Step 4: Run the test and confirm it passes**

```bash
cd backend && npx jest src/cors.spec.ts
```

Expected: 7 passing tests.

- [x] **Step 5: Run the whole unit suite to confirm nothing regressed**

```bash
cd backend && npm test
```

Expected: all suites pass.

- [x] **Step 6: Commit**

```bash
git add backend/src/cors.ts backend/src/cors.spec.ts
git commit -m "feat(api): parse CORS_ORIGIN into enableCors options

A bare * maps to origin: true rather than ['*'] — the cors package
matches array entries literally, so ['*'] would match no request."
```

---

### Task 2: Delete static serving, enable CORS

**Files:**
- Modify: `backend/src/main.ts` (whole file replaced)
- Modify: `backend/package.json:23` (remove `@nestjs/serve-static`)
- Modify: `backend/package-lock.json` (regenerated by npm, never hand-edited)
- Modify: `.env.example` (still at the repository root until Task 3)

**Interfaces:**
- Consumes: `corsConfigFrom` and `CorsConfig` from Task 1.
- Produces: an API that serves no static assets and enables CORS only when
  `CORS_ORIGIN` is set. Task 3 removes the now-inert `STATIC_ROOT` and
  `dashboard/dist` entries from the compose file.

**Note for the reviewer:** this task deliberately leaves the `./dashboard/dist`
mount in the root `docker-compose.yml`. The API ignores it from now on, so it is
inert, and the file is about to move in Task 3 — editing it twice would create
churn in a file whose every line is already changing. Do not flag it here.

- [x] **Step 1: Replace `backend/src/main.ts`**

The current file imports `ServeStaticModule`, computes `staticRoot` from the
environment, and conditionally spreads the module into `imports`. All three go.
Write the file as:

```ts
import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from './db/db.module';
import { ApiModule } from './api/api.module';
import { corsConfigFrom } from './cors';

// This module deliberately does not import AppModule: the API never
// classifies, never notifies, and must not require ANTHROPIC_API_KEY to boot.
@Module({ imports: [DatabaseModule, ApiModule] })
class ApiRoot {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiRoot);
  app.enableShutdownHooks();

  // The dashboard is deployed to its own server, so browser requests are
  // cross-origin and CORS_ORIGIN is what permits them. Unset means CORS off,
  // which is correct for deployments with no browser client.
  const cors = corsConfigFrom(process.env.CORS_ORIGIN);
  if (cors) app.enableCors(cors);

  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
  Logger.log(
    JSON.stringify({ event: 'api.started', port, corsOrigin: cors?.origin ?? null }),
  );
}

void bootstrap();
```

- [x] **Step 2: Remove the dependency**

```bash
cd backend && npm uninstall @nestjs/serve-static
```

This edits both `package.json` and `package-lock.json`. Do not hand-edit either.

- [x] **Step 3: Confirm no reference to static serving survives in the backend**

```bash
cd backend && grep -rn "serve-static\|ServeStatic\|STATIC_ROOT" src package.json
```

Expected: no output. A hit means Step 1 or Step 2 was incomplete.

- [x] **Step 4: Confirm the project still compiles**

```bash
cd backend && npm run build
```

Expected: clean exit. A missing-module error for `@nestjs/serve-static` means
an import survived Step 1.

- [x] **Step 5: Run the unit suite**

```bash
cd backend && npm test
```

Expected: all suites pass, including `src/cors.spec.ts` from Task 1.

- [x] **Step 6: Add `CORS_ORIGIN` to `.env.example`**

Append to the repository-root `.env.example` (Task 3 moves this file):

```
# Origin of the deployed dashboard. Unset means CORS stays off, which is
# correct for the worker and for API deployments with no browser client.
# Comma-separated for several origins; a bare * allows any.
# Unused in local development — Vite proxies /api, making dev same-origin.
CORS_ORIGIN=http://localhost:5173
```

- [x] **Step 7: Add the same line to your local `.env`**

`.env` is gitignored, so this is a local edit with no commit. Without it the
deployed dashboard cannot reach the API.

```bash
grep -q CORS_ORIGIN .env || printf '\nCORS_ORIGIN=http://localhost:5173\n' >> .env
```

- [x] **Step 8: Commit**

```bash
git add backend/src/main.ts backend/package.json backend/package-lock.json .env.example
git commit -m "refactor(api): drop static serving, enable CORS instead

The dashboard deploys to its own server, so ServeStaticModule can never
fire — it and @nestjs/serve-static are removed rather than kept as a
dormant opt-in. CORS_ORIGIN replaces same-origin serving as the way the
SPA reaches the API."
```

---

### Task 3: Move the Docker and env files into `backend/`

The largest task, and the one with a destructive failure mode. Every step
before the move is a precaution; do not skip them.

**Files:**
- Move: `Dockerfile` → `backend/Dockerfile` (contents rewritten)
- Move: `.dockerignore` → `backend/.dockerignore` (contents rewritten)
- Move: `docker-compose.yml` → `backend/docker-compose.yml` (contents rewritten)
- Move: `.env.example` → `backend/.env.example` (contents unchanged)
- Move: `.env` → `backend/.env` (untracked; `mv`, not `git mv`)

**Interfaces:**
- Consumes: the API from Task 2, which no longer reads `STATIC_ROOT`.
- Produces: a `backend/` directory that builds and runs standalone. Task 4
  documents it.

- [x] **Step 1: Record the volume name before touching anything**

```bash
docker volume ls | grep pgdata
```

Expected: `local     jobradar_pgdata`. Write this down. Step 9 compares against
it. If the output is empty, no database exists yet and the risk does not apply —
continue anyway.

- [x] **Step 2: Stop the stack cleanly from its current location**

```bash
cd /Users/ykravchenko/www/JobRadar && docker compose down
```

Plain `down`. **Not `down -v`** — that deletes `jobradar_pgdata`.

- [x] **Step 3: Confirm nothing outside the root references these files**

```bash
cd /Users/ykravchenko/www/JobRadar
grep -rn "docker-compose\|Dockerfile" --include='*.yml' --include='*.yaml' \
  --include='*.json' --include='*.ts' --include='*.sh' \
  . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=docs
```

Expected: no hits, or only hits inside files this plan already moves. A CI
workflow or script referencing `-f docker-compose.yml` would need updating too;
if one appears, stop and report it rather than guessing.

- [x] **Step 4: Move the four tracked files, preserving history**

```bash
cd /Users/ykravchenko/www/JobRadar
git mv Dockerfile backend/Dockerfile
git mv .dockerignore backend/.dockerignore
git mv docker-compose.yml backend/docker-compose.yml
git mv .env.example backend/.env.example
```

- [x] **Step 5: Move the untracked `.env`**

`.env` is gitignored, so `git mv` fails on it. Use a plain move. It stays
ignored afterwards: `.gitignore`'s bare `.env` pattern is not anchored to a
directory and matches at any depth (verified with `git check-ignore -v backend/.env`).

```bash
cd /Users/ykravchenko/www/JobRadar && mv .env backend/.env
```

- [x] **Step 6: Rewrite `backend/Dockerfile`**

The build context is now `backend/`, so every `COPY backend/X` loses its
prefix. `RUN mkdir -p public` also goes: it existed only to receive the
`dashboard/dist` mount that Task 2 made irrelevant. Write the file as:

```dockerfile
FROM node:22-alpine AS api-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM api-deps AS api-build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=api-build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
USER node
CMD ["node", "dist/worker.main.js"]

# Built from full deps on purpose: the migrate service needs drizzle-kit,
# which is a devDependency and absent from the runtime stage.
FROM api-deps AS dev
WORKDIR /app
COPY . ./
CMD ["npx", "tsx", "watch", "src/worker.main.ts"]
```

- [x] **Step 7: Rewrite `backend/.dockerignore`**

Paths are relative to the build context, which is now `backend/`. The `.git`,
`docs` and `dashboard/tests` entries lie outside it and can no longer match, so
they are dropped rather than re-pointed. Write the file as:

```
node_modules
dist
.env
test
coverage
```

- [x] **Step 8: Rewrite `backend/docker-compose.yml`**

Note the first line. Note that `context: .` is unchanged as text but now
resolves to `backend/`. Write the file as:

```yaml
# Pinned because Compose otherwise derives the project name from this file's
# directory. Without it, moving this file out of the repository root renamed
# the volume jobradar_pgdata -> backend_pgdata and orphaned the database.
name: jobradar

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: jobradar
      POSTGRES_PASSWORD: jobradar
      POSTGRES_DB: jobradar
    # Host port 5433: 5432 is commonly taken by another local Postgres.
    # In-network clients still use db:5432 (see DATABASE_URL in .env).
    ports: ["5433:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jobradar"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    # Built from the dev stage on purpose: drizzle-kit is a devDependency and
    # the runtime stage installs with --omit=dev, so it is absent there.
    build: { context: ., target: dev }
    env_file: [.env]
    command: ["npx", "drizzle-kit", "migrate"]
    depends_on:
      db: { condition: service_healthy }

  worker:
    build: { context: ., target: runtime }
    env_file: [.env]
    environment:
      CONFIG_DIR: /config
    # config/ stays at the repository root: it is hand-edited operational
    # input, not backend source.
    volumes: ["../config:/config:ro"]
    command: ["node", "dist/worker.main.js"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }

  api:
    build: { context: ., target: runtime }
    env_file: [.env]
    environment:
      PORT: "8080"
    ports: ["127.0.0.1:8080:8080"]
    command: ["node", "dist/main.js"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }

  worker-dev:
    profiles: ["dev"]
    build: { context: ., target: dev }
    env_file: [.env]
    environment:
      CONFIG_DIR: /config
    volumes:
      - ./src:/app/src:ro
      - ../config:/config:ro
    # tsc, not tsx: esbuild drops design:paramtypes, which breaks Nest's
    # constructor-type injection. tsc honours emitDecoratorMetadata.
    command: ["sh", "-c", "npx tsc -p tsconfig.build.json --watch --preserveWatchOutput & until [ -f dist/worker.main.js ]; do sleep 1; done; exec node --watch dist/worker.main.js"]
    depends_on:
      db: { condition: service_healthy }

  api-dev:
    profiles: ["dev"]
    build: { context: ., target: dev }
    env_file: [.env]
    environment:
      PORT: "8080"
    ports: ["127.0.0.1:8080:8080"]
    volumes:
      - ./src:/app/src:ro
    # tsc, not tsx: see worker-dev above.
    command: ["sh", "-c", "npx tsc -p tsconfig.build.json --watch --preserveWatchOutput & until [ -f dist/main.js ]; do sleep 1; done; exec node --watch dist/main.js"]
    depends_on:
      db: { condition: service_healthy }

volumes:
  pgdata:
```

Three deletions to verify against the old file: `STATIC_ROOT: "/app/public"` and
the `./dashboard/dist:/app/public:ro` volume are gone from `api`, and
`STATIC_ROOT: ""` is gone from `api-dev` (an unset variable already means "off").

- [x] **Step 9: Confirm the project name is pinned before bringing anything up**

```bash
cd /Users/ykravchenko/www/JobRadar/backend && docker compose config | head -3
```

Expected: the output includes `name: jobradar`. If it says `name: backend`,
Step 8's first line is missing — **stop and fix it before running `up`**, or the
database will be orphaned.

- [x] **Step 10: Confirm the mounts resolve**

```bash
cd /Users/ykravchenko/www/JobRadar/backend && docker compose config | grep -A2 "source:"
```

Expected: the `config` bind resolves to the absolute path of the repository-root
`config/` directory, and the dev `src` binds resolve to `backend/src`. No source
path should contain `dashboard`.

- [x] **Step 11: Build in the new context**

```bash
cd /Users/ykravchenko/www/JobRadar/backend && docker compose build
```

Expected: all stages succeed. A `COPY failed: file not found` here means a path
in Step 6 still carries the `backend/` prefix.

- [x] **Step 12: Bring the stack up and confirm the database survived**

```bash
cd /Users/ykravchenko/www/JobRadar/backend && docker compose up -d
docker volume ls | grep pgdata
```

Expected: `jobradar_pgdata` and nothing named `backend_pgdata`. This is the
check the whole task is built around — compare against Step 1's output.

- [x] **Step 13: Confirm the API answers and serves no static assets**

```bash
curl -s localhost:8080/healthz; echo
curl -s localhost:8080/api/health | head -c 200; echo
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/
```

Expected: the first two return data; the third prints `404`. A `200` on the last
means static serving is still wired somewhere.

- [x] **Step 14: Confirm CORS behaves both ways**

With `CORS_ORIGIN=http://localhost:5173` in `backend/.env` (added in Task 2):

```bash
curl -si -X OPTIONS localhost:8080/api/postings \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -i access-control
```

Expected: `Access-Control-Allow-Origin: http://localhost:5173`.

Then confirm the default is off:

```bash
cd /Users/ykravchenko/www/JobRadar/backend
sed -i.bak '/^CORS_ORIGIN=/d' .env && docker compose up -d --force-recreate api
curl -si -X OPTIONS localhost:8080/api/postings \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -i access-control
```

Expected: no output — no `Access-Control-*` headers at all. Then restore:

```bash
mv .env.bak .env && docker compose up -d --force-recreate api
```

- [x] **Step 15: Confirm neither project references the other**

Both halves of the acceptance criterion, in order:

```bash
cd /Users/ykravchenko/www/JobRadar
grep -rn "dashboard" backend/ --exclude-dir=node_modules --exclude-dir=dist
grep -rn "backend" dashboard/src dashboard/tests dashboard/vite.config.ts
```

Expected from the first: no output, or only prose comments about the HTTP API
contract. Any path reference is a failure of this task's central goal.

Expected from the second: no output. The dashboard is untouched by this plan, so
this should already hold — run it anyway. If it does not hold, the frontend has
a coupling to the backend that this plan did not know about, and that is worth
stopping to report rather than working around.

- [x] **Step 16: Commit**

```bash
cd /Users/ykravchenko/www/JobRadar
git add -A backend/Dockerfile backend/.dockerignore backend/docker-compose.yml backend/.env.example
git add -u
git commit -m "build: move Docker and env config into backend/

backend/ owned all of it already: every Dockerfile stage was COPY
backend/*, every compose service is a backend process, and every variable
in .env is read by backend code. The build context drops one level, so
COPY paths and the config mount are rewritten.

name: jobradar is pinned because Compose otherwise derives the project
name from the file's directory, which would have renamed the volume
jobradar_pgdata -> backend_pgdata and orphaned the database."
```

---

### Task 4: Documentation

Three claims stated as invariants across `README.md` and `CLAUDE.md` are now
false. Retract them wherever they appear rather than patching the convenient
occurrences — `CLAUDE.md` explicitly instructs grepping for the old behaviour
rather than guessing which files mention it.

**Files:**
- Modify: `README.md` (intro, quick start, commands table, Development, local
  model section, rubric section)
- Modify: `CLAUDE.md:86-96` (config paragraph, `dashboard/` section) and the
  Docker section
- Create: `docs/features/per-project-docker-config.md`

**Interfaces:**
- Consumes: the finished arrangement from Tasks 1-3.
- Produces: nothing consumed by later tasks. This is the final task.

- [x] **Step 1: Find every stale claim**

```bash
cd /Users/ykravchenko/www/JobRadar
grep -rn "STATIC_ROOT\|serve-static\|ServeStatic\|dashboard/dist\|same-origin\|no CORS\|docker compose" README.md CLAUDE.md
```

Keep this list. Step 6 re-runs it as the completion check.

- [x] **Step 2: Rewrite the `README.md` intro paragraph**

Replace the paragraph beginning "They share no source." with:

```markdown
They share no source and no deployment. `GET /api/postings` and `GET /api/health`
are the entire contract. The backend builds and runs on its own from
`backend/docker-compose.yml`; the dashboard is a static bundle deployed to a
server of your choosing. Because they sit on different origins, the API must be
told which origin to accept — see `CORS_ORIGIN` below.
```

- [x] **Step 3: Rewrite the `README.md` quick start**

Replace the existing fenced block and the `open http://localhost:8080` line with:

````markdown
```bash
cd backend
cp .env.example .env && $EDITOR .env   # API key, Telegram token + chat id, CORS_ORIGIN
$EDITOR ../config/cv.md                # your CV, in prose
$EDITOR ../config/profile.yaml         # hard constraints
$EDITOR ../config/sources.yaml         # boards to watch
docker compose up -d --build
curl localhost:8080/api/health
```

The dashboard is a separate project with its own lifecycle:

```bash
cd dashboard && npm ci && npm run dev   # http://localhost:5173, proxies /api to :8080
```

To deploy it, `npm run build` and copy `dist/` to any static host, then set
`CORS_ORIGIN` in `backend/.env` to that host's origin and
`cd backend && docker compose restart api`. The API serves no static assets.
````

- [x] **Step 4: Update the `README.md` commands table and Development section**

Every `docker compose` row gains a `cd backend &&` prefix:

```markdown
| Command | Purpose |
|---|---|
| `cd backend && docker compose up -d` | db → migrations → worker + API |
| `cd backend && docker compose run --rm worker node dist/once.js` | One pipeline run, then exit |
| `cd backend && docker compose logs -f worker` | Follow scheduled runs |
| `cd dashboard && npm run build` | Build the SPA for deployment |
| `cd backend && npm test` | Backend unit suite — Jest, no containers needed |
| `cd backend && npm run test:integration` | Integration suite — Vitest; needs `DATABASE_URL_TEST` and/or `INTEGRATION=1` |
| `cd dashboard && npm test` | Dashboard suite |
```

The `cd dashboard && npm run build` row loses "(required after any frontend
change)" — the backend no longer reads `dist/`, so nothing local depends on it.

Replace the Development section's block and its trailing sentence with:

````markdown
```bash
cd backend && docker compose --profile dev up -d db api-dev   # API on :8080, tsc watch
cd dashboard && npm run dev                                   # Vite on :5173, proxies /api
```

Vite's proxy makes development same-origin, so `CORS_ORIGIN` is never exercised
locally — a working dev setup proves nothing about it. Production is
cross-origin by construction and fails without it.
````

- [x] **Step 5: Update the remaining two `README.md` sections**

In "Switching to a local model", change "Set these in `.env`" to "Set these in
`backend/.env`".

In "Tuning the rubric", change `docker compose restart worker` to
`cd backend && docker compose restart worker`.

- [x] **Step 6: Verify no stale claim survives in `README.md`**

Re-run Step 1's grep. Every remaining hit must describe the new arrangement.
Expected: no hit mentions `STATIC_ROOT`, `serve-static`, or `dashboard/dist`,
and no bare `docker compose` command lacks a `cd backend` prefix.

- [x] **Step 7: Rewrite the `CLAUDE.md` `dashboard/` section**

Replace the sentence beginning "In dev, Vite proxies `/api` to" through "before
`docker compose up`." with:

```markdown
`useApi` hook over `fetch` and four components. In dev, Vite proxies `/api` to
`:8080`, which makes development same-origin. In production the SPA is deployed
to its own server, so requests are cross-origin: the API enables CORS only when
`CORS_ORIGIN` is set. Parsing lives in `src/cors.ts` — `main.ts` has no test
seam, that function does. A bare `*` maps to `origin: true`, not `['*']`,
because the `cors` package matches array entries literally. The backend serves
no static assets; `ServeStaticModule` and `STATIC_ROOT` were removed when the
projects were split.
```

- [x] **Step 8: Rewrite the `CLAUDE.md` Docker section**

Replace it with:

```markdown
### Docker

Everything Docker lives in `backend/`, and the build context is `backend/` —
`docker compose` commands run from there, not from the repository root.
`Dockerfile` has a `dev` stage (full deps + `tsx watch`) and a `runtime` stage
(`npm ci --omit=dev`). The `migrate` service builds from **dev** because
`drizzle-kit` is a devDependency and is absent from runtime. `worker` and `api`
are the same runtime image with different `command`s. Postgres is published on
host `5433` (5432 is often taken); in-network clients still use `db:5432`.
The `dev` profile (`worker-dev`, `api-dev`) bind-mounts `backend/src` for watch
mode. Nothing binds beyond `127.0.0.1`, and there is no auth.

`name: jobradar` on the first line is load-bearing. Compose otherwise derives
the project name from the compose file's directory, and `backend/` would give
`backend_pgdata` instead of `jobradar_pgdata` — a silently empty database.

`config/` stays at the repository root and is mounted from `../config`: it is
hand-edited operational input, not backend source.
```

Also update the config paragraph a few lines above: `CONFIG_DIR` is
"bind-mounted read-only from `./config`" → "from `../config`".

- [x] **Step 9: Write the feature doc**

`CLAUDE.md` requires one per feature. Create
`docs/features/per-project-docker-config.md` — the first file in that directory:

```markdown
# Per-project Docker and env configuration

## The problem

`README.md` opened by calling JobRadar "two independent projects", but every
deployment artefact sat at the repository root and all of it was backend-owned:
a `Dockerfile` whose every stage was `COPY backend/…`, a compose file whose six
services were all backend processes, and a `.env` whose every variable was read
by backend code. Nothing at the root was shared.

The `api` service also bind-mounted `./dashboard/dist` and set `STATIC_ROOT`, so
the backend's deployment descriptor reached into the frontend's build output.

## The decision

Move all five files into `backend/` and sever the runtime link. The dashboard is
deployed to its own server, so same-origin serving is not a trade-off to weigh —
it is unreachable. `ServeStaticModule` and `@nestjs/serve-static` were deleted
rather than kept as a dormant opt-in, and `CORS_ORIGIN` took over the job of
letting the SPA reach the API.

This reverses a decision the original design spec made deliberately. That spec
chose same-origin serving to avoid CORS, nginx, and a second container, and said
to revisit "only if the dashboard is exposed publicly". A different trigger
fired: separate deployment targets.

## Alternatives rejected

- **An nginx container for the dashboard.** Preserves same-origin, but adds a
  web server, a Dockerfile, and a shared external network between two compose
  projects — for a static bundle any host serves for free.
- **A root compose file using `include:`.** Reintroduces at the root the file
  the change exists to remove.
- **Keeping the bind-mount behind a `DASHBOARD_DIST` variable.** There will be
  no `dashboard/dist` on the backend host to mount.
- **Retaining `ServeStaticModule` as a dormant opt-in.** Nothing sets
  `STATIC_ROOT` in a separate-server topology, so it would be a dependency kept
  alive for a configuration that cannot occur.
- **Moving `config/` into `backend/`.** It is hand-edited operational input;
  root is where a user expects it.

## Files

- `backend/Dockerfile`, `backend/.dockerignore`, `backend/docker-compose.yml`,
  `backend/.env`, `backend/.env.example` — moved from the root, paths rewritten
- `backend/src/cors.ts`, `backend/src/cors.spec.ts` — new
- `backend/src/main.ts` — static serving removed, CORS added
- `backend/package.json` — `@nestjs/serve-static` removed
- `README.md`, `CLAUDE.md` — three now-false invariants retracted

## The trap this change contains

Compose derives its project name from the compose file's directory. Moving the
file to `backend/` would have renamed the volume `jobradar_pgdata` →
`backend_pgdata`, and the next `up` would have created an empty database while
the real one sat orphaned. `name: jobradar` on the first line of
`backend/docker-compose.yml` prevents this. Do not remove it.

## Verifying it works

```bash
cd backend
docker compose config | head -3          # must say: name: jobradar
docker compose up -d --build
docker volume ls | grep pgdata           # jobradar_pgdata, not backend_pgdata
curl -s localhost:8080/api/health        # data
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/   # 404 — no static assets
npm test                                 # includes src/cors.spec.ts
grep -rn dashboard . --exclude-dir=node_modules --exclude-dir=dist  # nothing
```

CORS, both directions:

```bash
curl -si -X OPTIONS localhost:8080/api/postings \
  -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: GET' \
  | grep -i access-control     # header present with CORS_ORIGIN set, absent without
```
```

- [x] **Step 10: Commit**

```bash
cd /Users/ykravchenko/www/JobRadar
git add README.md CLAUDE.md docs/features/per-project-docker-config.md
git commit -m "docs: backend owns its Docker config; the API serves no SPA

Retracts three claims that the split made false: that dashboard/dist is
bind-mounted into the API container, that there is no CORS layer
anywhere, and that dist/ must be built before docker compose up."
```

---

## Notes for the executor

**Ordering against the settings-in-DB spec.** A concurrent spec,
`docs/superpowers/specs/2026-08-25-settings-in-db-design.md`, moves all four
`config/` documents into Postgres and makes the dashboard a **write** client.
If that lands first, the `../config` mounts in Task 3 Step 8 disappear entirely
and the `$EDITOR ../config/*` lines in Task 4 Step 3 are replaced by browser
editing. Nothing else in this plan changes. If this plan lands first, that one
removes the mounts as part of its own work.

That spec also raises an authentication question neither spec answers: a
write-capable API reachable cross-origin from a deployed dashboard, with no
auth, is a different security posture from a read-only one behind
`127.0.0.1`. This plan does not address it, and should not be read as having
cleared it. The `ports: ["127.0.0.1:8080:8080"]` binding is unchanged and remains
the only thing limiting exposure.
