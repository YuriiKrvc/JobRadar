# Local Ollama Model as the Default Classifier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a locally-running Ollama the default classifier for JobRadar,
reached over the existing OpenAI-compatible provider seam, with a request
timeout and documentation for the host-side setup compose cannot perform.

**Architecture:** The provider abstraction already exists —
`selectProvider(env)` routes to `createOpenAiCompatProvider` whenever
`LLM_BASE_URL` is set, and that provider already speaks Ollama's
`/v1/chat/completions`. This plan adds the one thing that provider lacks (a
request timeout, because a local model can hang where a hosted API did not),
teaches `worker`/`worker-dev` how to reach a service running outside compose,
and flips `.env.example` and the docs so local is the default rather than the
alternative. Ollama itself is **not** added to compose.

**Tech Stack:** NestJS 11, Jest (unit, `backend/src/**/*.spec.ts`, `rootDir:
src`), Docker Compose (run from `backend/`), Ollama's OpenAI-compatible
endpoint.

**Spec:** `docs/superpowers/specs/2026-08-26-local-ollama-model-design.md`

## Global Constraints

- Working directory for all backend commands is `backend/`. Docker Compose runs
  from `backend/`, and this machine has no compose plugin — use
  `docker-compose`, not `docker compose`.
- Unit tests are Jest with `rootDir: src`: `npm test`, or
  `npx jest src/path/file.spec.ts` for one file. **No integration test is added
  by this plan** — a suite requiring a running Ollama would silently skip
  everywhere else, which this repo treats as a known trap.
- **`selectProvider`'s precedence does not change.** `LLM_BASE_URL` is checked
  before `ANTHROPIC_API_KEY`; the Anthropic branch, `anthropic.ts` and its spec
  are left untouched. Local wins by precedence, not by deletion.
- **Ollama is not added to `docker-compose.yml`.** No `ollama` service, no
  `ollama-pull` init service, no `local-llm` profile, no `ollama` volume.
  Docker Desktop on macOS cannot expose Metal to a Linux container, so a
  containerised model would run CPU-only.
- **The dedup gate is not touched.** A posting that already has a score row
  keeps it and is never re-scored. No `rescore.ts`.
- **`app_settings.version` does not bump** on a provider change. It bumps only
  on a CV, profile or rubric save.
- Exact variable names and defaults, copied from the spec:
  - `LLM_BASE_URL=http://host.docker.internal:11434/v1`
  - `LLM_MODEL=llama3.1`
  - `LLM_JSON_SCHEMA=true`
  - `LLM_TIMEOUT_MS` default `120000`
  - Notify threshold spelling: `NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1`
    (provider id `openai-compat:llama3.1`, non-alphanumerics → `_`, uppercased)
- The timeout applies to the OpenAI-compatible provider **only**. `anthropic.ts`
  uses the vendor SDK and is out of scope.
- Only `worker` and `worker-dev` gain `extra_hosts`. `api`, `api-dev`, `db` and
  `migrate` are untouched — the API never classifies and must not require the
  model to boot.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/classifier/providers/openai-compat.ts` | Add `timeoutMs` option; pass `AbortSignal.timeout()` as the fetch `signal` | 1 |
| `backend/src/classifier/providers/openai-compat.spec.ts` | Extend `capture()` to record `init`; three new tests | 1 |
| `backend/src/classifier/classifier.module.ts` | Read and parse `LLM_TIMEOUT_MS`, thread into the provider | 2 |
| `backend/src/classifier/classifier.module.spec.ts` | **New file.** `selectProvider` has no unit test today | 2 |
| `backend/docker-compose.yml` | `extra_hosts` on `worker` and `worker-dev` | 3 |
| `backend/.env.example` | Local vars lead; Anthropic key commented | 3 |
| `README.md` | Rewrite "Switching to a local model" as the default path | 4 |
| `CLAUDE.md` | `LLM_PROVIDER` seam gains the timeout and the not-in-compose note | 4 |
| `docs/features/local-ollama-model.md` | **New file.** Record of intent | 4 |

Tasks 1 and 2 are the only production code. Task 3 is configuration with no
unit test (compose and `.env.example` are not importable), verified by rendering
the merged compose config. Task 4 is documentation, which this repo's closing
checklist requires before the feature is considered done.

---

### Task 1: Request timeout in the OpenAI-compatible provider

`createOpenAiCompatProvider` passes no `signal` to `fetch`, so a request has no
timeout. Against a local model a stalled Ollama hangs the fetch forever, and
because `PipelineService.run()` awaits classification inline, one hung request
stalls the entire tick while `@Cron` keeps firing behind it.

An abort must surface as an ordinary rejection from `complete()`. That path is
already correct downstream: `ClassifierService.classify` retries once, and two
failures leave the posting unscored so the dedup gate retries it next tick.

**Files:**
- Modify: `backend/src/classifier/providers/openai-compat.ts:3-11` (the
  `OpenAiCompatOptions` interface) and `:40-48` (the `doFetch` call)
- Test: `backend/src/classifier/providers/openai-compat.spec.ts:4-11` (the
  `capture` helper) and the `describe` block

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OpenAiCompatOptions` gains one optional field —
  `timeoutMs?: number`, defaulting to `120000` inside the factory. Task 2 passes
  it. The provider `id` is unchanged (`openai-compat:${opts.model}`), so notify
  thresholds are unaffected.

- [ ] **Step 1: Extend the `capture` helper to record the whole `init`**

The existing helper records only `url` and the parsed `body`, so no test can
assert on `signal`. Replace the helper at the top of
`backend/src/classifier/providers/openai-compat.spec.ts` with:

```typescript
function capture(responseBody: unknown) {
  const seen: any[] = [];
  const fetchFn = async (url: string, init?: any) => {
    seen.push({ url, body: JSON.parse(init.body), init });
    return new Response(JSON.stringify(responseBody), { status: 200 });
  };
  return { seen, fetchFn: fetchFn as any };
}
```

This is additive — every existing test reads `seen[0].url` or `seen[0].body`
and keeps working.

- [ ] **Step 2: Write the three failing tests**

Append these inside the existing `describe('openai-compat provider', ...)`
block in the same file:

```typescript
  it('passes an abort signal on every request', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({ baseUrl: 'http://x/v1', model: 'm', fetchFn });
    await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].init.signal.aborted).toBe(false);
  });

  it('aborts the request once timeoutMs elapses', async () => {
    // A server that never answers: the only thing that can settle this
    // promise is the signal the provider is expected to pass.
    const fetchFn = ((_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as any;
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://x/v1', model: 'm', timeoutMs: 10, fetchFn,
    });
    await expect(p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA }))
      .rejects.toThrow(/abort/i);
  });

  it('does not abort a request that answers within timeoutMs', async () => {
    const { seen, fetchFn } = capture(ok);
    const p = createOpenAiCompatProvider({
      baseUrl: 'http://x/v1', model: 'm', timeoutMs: 5000, fetchFn,
    });
    const out = await p.complete({ system: 's', user: 'u', schema: VERDICT_JSON_SCHEMA });
    expect(out.raw).toBe('{"a":1}');
    expect(seen[0].init.signal.aborted).toBe(false);
  });
```

Why the middle test is shaped that way: an injected `fetchFn` does not honour
`signal` on its own — `AbortSignal.timeout` only fires the event. A fake that
ignores the signal would hang the test forever, so the fake deliberately
rejects on `abort`, which is exactly what real `fetch` does. `timeoutMs: 10`
keeps the wait negligible.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && npx jest src/classifier/providers/openai-compat.spec.ts
```

Expected: all three FAIL, each in a distinct way.
1. `expect(received).toBeInstanceOf(AbortSignal)` — received `undefined`,
   because no `signal` is passed yet.
2. A Jest timeout (5s default): nothing ever aborts the fake, because the
   provider passes no signal for the fake to listen to.
3. `TypeError: Cannot read properties of undefined (reading 'aborted')` — same
   missing signal. Once implemented this test guards the opposite risk: a
   timeout that fires on a request that answered in time.

- [ ] **Step 4: Add the option to the interface**

In `backend/src/classifier/providers/openai-compat.ts`, add one field to
`OpenAiCompatOptions`, after `maxTokens`:

```typescript
  maxTokens?: number;
  /**
   * Abort a request after this many ms. A local model can hang where a hosted
   * API would not, and PipelineService awaits classification inline — one hung
   * request stalls the whole tick. Generous by default: a cold 8B model on CPU
   * can legitimately take a minute, and a timeout that fires on a slow but
   * working request is worse than no timeout at all.
   */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
```

- [ ] **Step 5: Pass the signal on the fetch call**

Still in `openai-compat.ts`, at the `doFetch` call (line 40), add the `signal`
property. The full call becomes:

```typescript
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
      });
```

The signal is constructed per request, inside `complete()`, not once in the
factory — a factory-level signal would start its countdown at module
construction and abort every request after the first two minutes of process
uptime.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend && npx jest src/classifier/providers/openai-compat.spec.ts
```

Expected: PASS, all tests in the file — the five pre-existing ones plus the
three new ones.

- [ ] **Step 7: Run the whole unit suite**

```bash
cd backend && npm test
```

Expected: PASS. Nothing else constructs `createOpenAiCompatProvider`, so this
is a regression check rather than a likely failure.

- [ ] **Step 8: Commit**

```bash
git add backend/src/classifier/providers/openai-compat.ts \
        backend/src/classifier/providers/openai-compat.spec.ts
git commit -m "feat: time out OpenAI-compatible completion requests

A local model can hang where a hosted API would not, and the pipeline
awaits classification inline, so one stalled request stalls the tick."
```

---

### Task 2: Thread `LLM_TIMEOUT_MS` through `selectProvider`

The provider now accepts `timeoutMs`, but nothing sets it from the environment.
`selectProvider` has no unit test at all today, so this task creates one — and
the parsing is worth testing precisely because a typo'd env var must fall back
to the default rather than produce `NaN`, which `AbortSignal.timeout(NaN)`
would treat as `0` and abort every request instantly.

**Files:**
- Modify: `backend/src/classifier/classifier.module.ts:11-24` (`selectProvider`)
- Test: `backend/src/classifier/classifier.module.spec.ts` (create)

**Interfaces:**
- Consumes: `OpenAiCompatOptions.timeoutMs?: number` from Task 1.
- Produces: nothing later tasks depend on. Tasks 3 and 4 are config and docs.

- [ ] **Step 1: Write the failing test**

Create `backend/src/classifier/classifier.module.spec.ts`:

```typescript
import { resolveTimeoutMs, selectProvider } from './classifier.module';

// selectProvider takes env as an argument rather than reading process.env,
// which is the whole reason it is testable without mutating global state.
describe('selectProvider', () => {
  it('prefers a local base URL over an Anthropic key', () => {
    const p = selectProvider({
      LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      LLM_MODEL: 'llama3.1',
      ANTHROPIC_API_KEY: 'sk-ant-stale',
    } as NodeJS.ProcessEnv);
    expect(p.id).toBe('openai-compat:llama3.1');
  });

  it('defaults the model to llama3.1', () => {
    const p = selectProvider({ LLM_BASE_URL: 'http://x/v1' } as NodeJS.ProcessEnv);
    expect(p.id).toBe('openai-compat:llama3.1');
  });

  it('parses LLM_TIMEOUT_MS', () => {
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '30000' } as NodeJS.ProcessEnv)).toBe(30000);
  });

  it('falls back to 120000 when LLM_TIMEOUT_MS is absent', () => {
    expect(resolveTimeoutMs({} as NodeJS.ProcessEnv)).toBe(120000);
  });

  it('falls back to 120000 when LLM_TIMEOUT_MS is not a positive number', () => {
    // NaN or 0 would make AbortSignal.timeout abort every request immediately,
    // turning a typo into a classifier that never succeeds.
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: 'soon' } as NodeJS.ProcessEnv)).toBe(120000);
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv)).toBe(120000);
    expect(resolveTimeoutMs({ LLM_TIMEOUT_MS: '-5' } as NodeJS.ProcessEnv)).toBe(120000);
  });

  it('throws when neither a base URL nor an Anthropic key is set', () => {
    expect(() => selectProvider({} as NodeJS.ProcessEnv)).toThrow(/LLM_BASE_URL/);
  });
});
```

`resolveTimeoutMs` is exported purely for this test — the parsing is the part
with a failure mode worth pinning, and it is not reachable through
`selectProvider`'s return value.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest src/classifier/classifier.module.spec.ts
```

Expected: FAIL at compile — `Module '"./classifier.module"' has no exported
member 'resolveTimeoutMs'`.

- [ ] **Step 3: Implement the parser and thread it through**

In `backend/src/classifier/classifier.module.ts`, add the helper above
`selectProvider` and use it in the OpenAI-compatible branch:

```typescript
/**
 * Exported for its unit test. A non-numeric or non-positive value must fall
 * back rather than reach AbortSignal.timeout, which treats NaN as 0 and would
 * abort every request instantly — a typo that silently breaks all scoring.
 */
export function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.LLM_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
}

export function selectProvider(env: NodeJS.ProcessEnv): LLMProvider {
  if (env.LLM_BASE_URL) {
    return createOpenAiCompatProvider({
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL ?? 'llama3.1',
      apiKey: env.LLM_API_KEY,
      jsonSchemaSupport: env.LLM_JSON_SCHEMA === 'true',
      timeoutMs: resolveTimeoutMs(env),
    });
  }
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
  }
  throw new Error('Set ANTHROPIC_API_KEY, or LLM_BASE_URL for a local model');
}
```

Only the `timeoutMs` line and the new helper are additions. The precedence, the
model default and the error message are unchanged — do not touch them.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx jest src/classifier/classifier.module.spec.ts
```

Expected: PASS, six tests.

- [ ] **Step 5: Run the whole unit suite**

```bash
cd backend && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/classifier/classifier.module.ts \
        backend/src/classifier/classifier.module.spec.ts
git commit -m "feat: read the completion timeout from LLM_TIMEOUT_MS

A non-numeric value falls back to the default: NaN would reach
AbortSignal.timeout as 0 and abort every request instantly."
```

---

### Task 3: Reach Ollama from the worker, and make local the default config

Two configuration changes with one purpose: the worker can resolve a host
service, and a fresh `cp .env.example .env` produces a local-model install
rather than one that needs an API key.

`extra_hosts` goes on `worker` and `worker-dev` only. On Docker Desktop
`host.docker.internal` already resolves without it; the explicit mapping is
what makes the same `.env` work on a Linux host, where it does not.

**Files:**
- Modify: `backend/docker-compose.yml` (the `worker` and `worker-dev` services)
- Modify: `backend/.env.example:1-12`

**Interfaces:**
- Consumes: `LLM_TIMEOUT_MS` from Task 2 (documented here as a commented
  variable).
- Produces: nothing in code. Task 4 documents these values.

- [ ] **Step 1: Add `extra_hosts` to `worker`**

In `backend/docker-compose.yml`, the `worker` service becomes:

```yaml
  worker:
    build: { context: ., target: runtime }
    env_file: [.env]
    # The classifier talks to an Ollama running on the host, not in this stack:
    # Docker Desktop cannot expose Metal to a Linux container, so a
    # containerised model would run CPU-only. Docker Desktop resolves this name
    # already; the explicit mapping is what makes the same .env work on Linux.
    extra_hosts: ["host.docker.internal:host-gateway"]
    command: ["node", "dist/worker.main.js"]
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
```

- [ ] **Step 2: Add `extra_hosts` to `worker-dev`**

The `worker-dev` service gains the same key. Do not repeat the comment — add a
short back-reference instead:

```yaml
  worker-dev:
    profiles: ["dev"]
    build: { context: ., target: dev }
    env_file: [.env]
    extra_hosts: ["host.docker.internal:host-gateway"]   # see worker above
    volumes:
      - ./src:/app/src:ro
```

Leave the rest of `worker-dev` — including the `tsc, not tsx` comment and the
`command` — exactly as it is.

- [ ] **Step 3: Verify the merged compose config renders**

```bash
cd backend && docker-compose config | grep -B2 -A2 host-gateway
```

Expected: two `extra_hosts` entries, one under `worker` and one under
`worker-dev`, each reading `host.docker.internal:host-gateway`. A YAML mistake
surfaces here as a parse error rather than at `up` time.

Then confirm nothing else picked it up:

```bash
cd backend && docker-compose config | grep -c host-gateway
```

Expected: `2`. If it is more, `extra_hosts` landed on `api` or `api-dev` —
remove it there.

- [ ] **Step 4: Reorder `.env.example`**

Replace the first block of `backend/.env.example` — everything from
`DATABASE_URL` through the `NOTIFY_THRESHOLD` comments — with:

```
DATABASE_URL=postgres://jobradar:jobradar@db:5432/jobradar

# Thresholds and credentials stay here, not in the database: they are
# deployment config, and the API must never return them to a browser.

# The classifier. Default is an Ollama running on the host — see
# "Switching to a local model" in README.md, which has one prerequisite
# docker-compose cannot satisfy for you (OLLAMA_HOST=0.0.0.0).
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1
LLM_JSON_SCHEMA=true
# LLM_TIMEOUT_MS=120000                      # abort a completion after this long
# LLM_API_KEY=                               # only for a gateway that needs one

# Unset LLM_BASE_URL to fall back to Anthropic. Scores from the two are not
# comparable, which is why every score row records the provider that made it.
# ANTHROPIC_API_KEY=sk-ant-...

TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
# NOTIFY_THRESHOLD=50                        # global default
# NOTIFY_THRESHOLD_<PROVIDER_ID>=50          # per-provider override
# For the default above that is NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1
```

Leave the `CORS_ORIGIN` block at the end of the file untouched.

- [ ] **Step 5: Verify the example file still parses as an env file**

```bash
cd backend && docker-compose --env-file .env.example config --services
```

Expected: the six service names (`db`, `migrate`, `worker`, `api`,
`worker-dev`, `api-dev`) and no warning about an unparseable line. This catches
a stray quote or a `#` in the wrong column.

- [ ] **Step 6: Commit**

```bash
git add backend/docker-compose.yml backend/.env.example
git commit -m "feat: default to a host-run Ollama for classification

Only worker and worker-dev get extra_hosts; the API never classifies and
must not require the model to boot."
```

---

### Task 4: Documentation

The repo's own closing checklist makes this part of the feature, not an
afterthought: update what the change invalidated, then write the record of
intent the diff cannot carry.

**Files:**
- Modify: `README.md:251-264` (the "Switching to a local model" section) and
  `README.md:19-31` (Quick start, one added line)
- Modify: `CLAUDE.md:135-138` (the `LLM_PROVIDER` seam bullet)
- Create: `docs/features/local-ollama-model.md`

**Interfaces:**
- Consumes: the variable names and defaults from Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Rewrite the README section**

Replace `README.md` lines 251-264 with:

```markdown
## The classifier: a local model by default

Classification runs against an Ollama on the **host machine**, not in this
compose stack. Docker Desktop cannot expose the Mac's GPU to a Linux
container, so a containerised model would run CPU-only — minutes per posting
instead of seconds.

That means one prerequisite `docker-compose up` cannot satisfy for you:

```bash
ollama pull llama3.1

# Ollama binds 127.0.0.1 by default, and a host loopback socket is NOT
# reachable from a container: host.docker.internal resolves to the host's
# routable interface. Without this, every classification fails ECONNREFUSED.
launchctl setenv OLLAMA_HOST 0.0.0.0   # macOS; then restart Ollama
```

**While `OLLAMA_HOST=0.0.0.0` is set, Ollama accepts connections from your
local network.** There is no auth on it — the same caveat as this project's
Postgres, published on 5433 with no host prefix.

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

`LLM_BASE_URL` is free-form, so the same variable points at a LAN address or a
remote GPU box with no compose change. Unset it and the worker falls back to
`ANTHROPIC_API_KEY`.

`LLM_TIMEOUT_MS` (default 120000) aborts a stalled completion. The pipeline
awaits classification inline, so without it one hung request stalls the whole
tick. An abort leaves the posting unscored and the next tick retries it.

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
```

- [ ] **Step 2: Point Quick start at it**

`README.md` Quick start currently says the `.env` line is for
`API key, Telegram token + chat id, CORS_ORIGIN`. The API key is no longer the
default. Change that comment and add one line after the code block:

```
cp .env.example .env && $EDITOR .env   # Telegram token + chat id, CORS_ORIGIN
```

And immediately after the `curl localhost:8080/api/health` block, add:

```markdown
Classification needs an Ollama running on the host, with one setup step
compose cannot do for you — see [The classifier](#the-classifier-a-local-model-by-default)
before expecting any posting to get scored.
```

- [ ] **Step 3: Update the `LLM_PROVIDER` seam in CLAUDE.md**

Replace the `LLM_PROVIDER` bullet (lines 135-138) with:

```markdown
- `LLM_PROVIDER` — `selectProvider(env)` in `classifier.module.ts`:
  `LLM_BASE_URL` → OpenAI-compatible, else `ANTHROPIC_API_KEY` → Anthropic, else
  throw. The token is defined in `providers/types.ts`, not the module, to break a
  DI cycle. `providers/fake.ts` exists for tests. The default deployment is the
  OpenAI-compatible branch against an Ollama on the **host** — Ollama is
  deliberately absent from `docker-compose.yml`, because Docker Desktop cannot
  expose Metal to a Linux container and a containerised model would run
  CPU-only. `worker` and `worker-dev` carry
  `extra_hosts: host.docker.internal:host-gateway` for that; `api` does not,
  because it never classifies. The OpenAI-compatible provider aborts after
  `LLM_TIMEOUT_MS` (default 120000, `resolveTimeoutMs` falls back on anything
  non-positive because `AbortSignal.timeout(NaN)` aborts instantly) — the
  pipeline awaits classification inline, so an un-timed-out hang stalls the
  whole tick. An abort leaves the posting unscored, which the dedup gate
  retries next tick.
```

- [ ] **Step 4: Write the feature doc**

Create `docs/features/local-ollama-model.md`, following the structure of the
existing docs in that directory (problem, decision, alternatives rejected,
files touched, how to verify):

```markdown
# Local Ollama model as the default classifier

**Spec:** `docs/superpowers/specs/2026-08-26-local-ollama-model-design.md`

## Problem

Classification was the only part of JobRadar needing a paid API key, and its
cost scaled with how many boards were watched. The provider seam for a local
model already existed — `selectProvider` has routed `LLM_BASE_URL` to the
OpenAI-compatible provider since v1, and that provider's own unit tests were
written against Ollama's endpoint. What was missing was everything around it.

## Decision

Ollama runs on the **host**, outside compose. Compose only learns to reach it,
`.env.example` leads with the local variables, and the provider gained the one
thing it lacked: a request timeout.

**Why not a compose service?** Docker Desktop on macOS cannot expose Metal to a
Linux container, so a containerised Ollama runs CPU-only while the same model
run natively is GPU-accelerated. For a pipeline that classifies every new
posting inside a 30-minute tick, that is the difference between usable and not.
Secondarily, the model cache is large and long-lived and belongs to the host,
not to a volume tied to this project's stack. The cost is that the stack is no
longer self-contained: `docker-compose up` cannot satisfy `OLLAMA_HOST=0.0.0.0`
or `ollama pull`, so both are required README steps.

**Why keep the Anthropic provider?** Local wins by precedence, not by deletion.
`LLM_BASE_URL` is checked first, so a stale key is inert. Keeping the branch
costs nothing and leaves a frontier model available to calibrate against.

**Why not re-score existing postings?** The dedup gate is "has a score row".
Making it per-provider would tie its meaning to mutable config, so an
`LLM_MODEL` typo would silently re-classify the entire history against a slow
local model. Existing scores stay, distinguished by the `providerId` on each
row, and the history is knowingly mixed.

**Why is the timeout default so generous?** A cold 8B model on CPU can
legitimately take a minute. A timeout firing on a slow but working request is
worse than no timeout, because the posting is left unscored and retried
forever. 120s aborts genuine hangs and nothing else. `resolveTimeoutMs` refuses
non-positive values: `AbortSignal.timeout(NaN)` behaves as `0` and would abort
every request instantly, turning a typo into a classifier that never succeeds.

## Files

- `backend/src/classifier/providers/openai-compat.ts` — `timeoutMs` option, per-request `AbortSignal.timeout()`
- `backend/src/classifier/classifier.module.ts` — `resolveTimeoutMs`, threaded into the provider
- `backend/docker-compose.yml` — `extra_hosts` on `worker` and `worker-dev` only
- `backend/.env.example` — local variables lead; Anthropic key commented
- `README.md`, `CLAUDE.md` — the setup prerequisite and the seam description

Unchanged on purpose: `selectProvider`'s precedence, `anthropic.ts`, the dedup
gate, `app_settings.version` bumping, and the verdict bands.

## Verifying it

1. `ollama pull llama3.1`; confirm `OLLAMA_HOST=0.0.0.0` and restart Ollama.
2. From `backend/`: `docker-compose build && docker-compose up -d`, then
   `docker-compose exec worker sh -c 'wget -qO- $LLM_BASE_URL/models'`. A model
   list proves reachability; `Connection refused` means `OLLAMA_HOST` is not in
   effect. This catches the loopback mistake before any posting is misjudged.
3. Watch a tick classify a new posting; confirm its score row records
   `providerId = 'openai-compat:llama3.1'`.
4. Confirm a posting that already had a score was **not** re-scored.
5. Set `NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1` once you have seen enough
   local scores to know what a good one looks like.
```

- [ ] **Step 5: Check no stale references survive**

```bash
cd /Users/ykravchenko/www/JobRadar-wt/custom-sources && grep -rn "qwen3" README.md CLAUDE.md backend/.env.example
```

Expected: no matches. The old README section named `qwen3:14b`; the plan
standardises on `llama3.1` so the notify-threshold spelling in the docs matches
the shipped default. (`qwen3:14b` legitimately remains in
`openai-compat.spec.ts` as test data — do not touch it.)

```bash
cd /Users/ykravchenko/www/JobRadar-wt/custom-sources && grep -n "Switching to a local model" README.md
```

Expected: no matches — the heading was renamed, so confirm nothing else linked
to the old one.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/features/local-ollama-model.md
git commit -m "docs: document the host-run Ollama as the default classifier"
```

---

## Final verification

- [ ] `cd backend && npm test` — full Jest suite passes.
- [ ] `cd backend && docker-compose config >/dev/null` — compose file valid.
- [ ] Manual end-to-end, per the spec's *Testing* section: reachability check
      from inside the worker, one posting scored with
      `providerId = 'openai-compat:llama3.1'`, and one already-scored posting
      confirmed untouched.

The manual step is not optional garnish here. Every unit test in this plan uses
an injected `fetchFn`, so none of them prove that a container can reach the
host — which is precisely the thing most likely to be wrong.
