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
