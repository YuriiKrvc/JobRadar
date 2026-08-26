# JobRadar — Local Ollama Model as the Default Classifier

**Date:** 2026-08-26
**Status:** Approved, ready for implementation planning
**Depends on:** the `LLM_PROVIDER` seam as specified in
`2026-08-25-jobradar-design.md`, implemented as of `e22fad9`

File and line references below were verified against that commit.

## Problem

Classification is the only part of JobRadar that needs a paid API key. The
pipeline classifies every newly-seen posting on every tick, so the running cost
scales with how many boards the user watches, and `ANTHROPIC_API_KEY` is a hard
requirement for the worker to do anything useful.

The code already anticipated this. `selectProvider(env)` in
`backend/src/classifier/classifier.module.ts:11-24` routes to
`createOpenAiCompatProvider` whenever `LLM_BASE_URL` is set, falling through to
Anthropic only when it is not. `openai-compat.ts` speaks
`POST /chat/completions` with `response_format: json_schema`, and its unit tests
are written against `http://localhost:11434/v1` — Ollama's OpenAI-compatible
endpoint. README documents the three-variable switch at line 251.

So the provider abstraction is done. What is missing is everything around it:
containers cannot reach a host-bound Ollama without configuration, the default
`.env.example` still leads with the Anthropic key, there is no request timeout
on a provider that is now expected to be slow, and nothing documents which of
the resulting knobs must change together.

## Scope

**In scope:** make a locally-running Ollama the documented default classifier.
Compose learns how to reach a service running outside it, `.env.example` leads
with the local variables, the OpenAI-compatible provider gains a request
timeout, and the documentation states the host-side prerequisite that otherwise
makes the whole thing look broken.

**Explicitly not in scope:**

- **Running Ollama under Docker Compose.** Ollama stays a separate service on
  the host, managed outside this repository. Considered and rejected — see
  *Why Ollama is not a compose service*.
- **Removing the Anthropic provider.** `anthropic.ts`, its spec and its branch
  in `selectProvider` stay exactly as they are. Local wins by precedence, not by
  deletion.
- **Re-scoring existing postings.** No `rescore.ts`, no change to the dedup
  gate. See *What happens to existing scores*.
- **Changing the dedup gate to be per-provider.** Rejected: it would make the
  gate's meaning depend on mutable config, so an `LLM_MODEL` typo would silently
  re-classify the entire posting history against a slow local model.
- **Model selection in the dashboard.** The model is deployment config, like the
  notify thresholds and the database URL. It stays in `.env` and the API never
  returns it to a browser.
- **Prompt or rubric changes to suit a smaller model.** The rubric is
  user-owned and tunable from the dashboard already. If llama3.1 scores
  differently than a frontier model did, that is what the per-provider notify
  threshold and the recorded `providerId` exist to absorb.
- **Streaming, token budgeting, or model warm-up.** One request, one response,
  same as today.

## Why Ollama is not a compose service

An `ollama/ollama` service plus a one-shot `ollama-pull` init container would
have made the stack self-contained, mirroring how `migrate` already gates
`worker` with `service_completed_successfully`. It was rejected for one decisive
reason and one secondary one:

- **Docker Desktop on macOS cannot expose Metal to a Linux container.** A
  containerised Ollama on the target machine would run CPU-only, while the same
  model run natively is GPU-accelerated. For a pipeline that classifies every
  new posting inside a 30-minute tick, that difference is the difference between
  usable and not.
- **Ollama's model cache is large and long-lived.** It belongs to the host, not
  to a volume whose lifecycle is tied to this project's compose stack.

The cost of that choice is that the stack is no longer self-contained: a fresh
install has one prerequisite that `docker-compose up` cannot satisfy. The
mitigation is documentation, not code — see *Documentation* below.

## What changes

### Reaching a service outside compose

`worker` and `worker-dev` gain:

```yaml
extra_hosts: ["host.docker.internal:host-gateway"]
```

On Docker Desktop that name already resolves without the mapping; adding it
explicitly means the same `.env` works unchanged on a Linux host, where it does
not. This is the only edit to `backend/docker-compose.yml`.

`api`, `api-dev`, `db` and `migrate` are untouched. The API never classifies and
must not require the model to boot — the same reason it deliberately does not
import `AppModule` (`main.ts`).

Because the URL is plain configuration, `LLM_BASE_URL` remains free-form: it can
point at `host.docker.internal`, at a LAN address, or at a remote GPU box, with
no compose edit in any of those cases.

### The host-side prerequisite

**Ollama binds `127.0.0.1:11434` by default, and a host loopback socket is not
reachable from a container.** `host.docker.internal` resolves to the host's
routable interface, not its loopback, so the worker gets `ECONNREFUSED` on every
classification until Ollama is told to listen more widely:

```bash
launchctl setenv OLLAMA_HOST 0.0.0.0   # macOS; then restart Ollama
```

This is the single most likely cause of a migration that appears broken, so it
is a required setup step in the README rather than a troubleshooting footnote.

It also means Ollama accepts connections from the local network while set. That
warning belongs beside it, in the same spirit as the existing note that `db`'s
`5433:5432` has no host prefix and is therefore reachable from the LAN.

### Configuration

`.env.example` is reordered so the local model is the default and Anthropic is
the commented fallback:

```
LLM_BASE_URL=http://host.docker.internal:11434/v1
LLM_MODEL=llama3.1
LLM_JSON_SCHEMA=true
# LLM_TIMEOUT_MS=120000
# ANTHROPIC_API_KEY=sk-ant-...
```

`selectProvider()` needs **no change** to its precedence. `LLM_BASE_URL` is
already checked first, so a stale `ANTHROPIC_API_KEY` left in someone's `.env`
is inert rather than ambiguous. The existing error message — `Set
ANTHROPIC_API_KEY, or LLM_BASE_URL for a local model` — stays accurate.

`LLM_MODEL=llama3.1` also happens to be the value `selectProvider` already
defaults to at `classifier.module.ts:14`, so the variable is explicit
documentation rather than a behaviour change.

### A request timeout

`createOpenAiCompatProvider` passes no `signal` to `fetch`
(`openai-compat.ts:40-48`), so a request has no timeout. Against a hosted API
that was tolerable. Against a local model it is not: a stalled or swapping
Ollama leaves the `fetch` hanging indefinitely, and because
`PipelineService.run()` awaits classification inline, one hung request stalls
the whole tick while `@Cron` keeps firing behind it.

`LLM_TIMEOUT_MS` (default `120000`) is applied as `AbortSignal.timeout()` on the
provider's `fetch` call. The default is deliberately generous: a cold 8B model
on CPU can legitimately take a minute, and a timeout that fires on a slow but
working request is worse than no timeout at all.

An abort surfaces as an ordinary rejection from `complete()`, which lands on a
path that already exists and is already correct: `ClassifierService.classify`
retries once, and two failures leave the posting with no score row, so the dedup
gate picks it up again on the next tick. No new error handling is required
anywhere else.

The timeout applies to the OpenAI-compatible provider only. `anthropic.ts` uses
the vendor SDK, which has its own timeout handling, and is out of scope.

## What happens to existing scores

The dedup gate in `PipelineService.run()` is *"does this posting have a score
row"*, not *"have we seen it"*. That is unchanged by this work, and the
consequence is explicit and accepted:

**A posting that already has a score keeps it and is never re-scored.** The
local model judges only postings first seen after the switch. The dashboard will
show a history scored by two incomparable providers, distinguished by the
`providerId` recorded on every score row — which is exactly what that column
exists for.

Two knobs follow from this and must be understood together:

- The provider id becomes `openai-compat:llama3.1`, so the per-provider notify
  threshold is **`NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1`**.
  `NotifyConfig.thresholdFor` (`notify.config.ts:12`) uppercases the id and
  replaces every non-alphanumeric character, so the `.` in `3.1` becomes `_` and
  the `:` and `-` do too. Any existing `NOTIFY_THRESHOLD_*` tuned for Anthropic
  keeps applying to the rows it was tuned for, and continues to be used if the
  deployment ever falls back.
- `app_settings.version` does **not** bump. It bumps on a CV, profile or rubric
  save, because all three feed the classifier's prompt. Which model reads that
  prompt is deployment config, and the stale-score badge tracks settings
  changes, not provider changes. Provider identity is already carried per row.

Calibrating the new threshold is therefore a manual, gradual activity: watch the
scores the local model produces on new postings and set the variable from what
you see. No tooling for that is in scope.

## Testing

Unit (Jest, `backend/src/**/*.spec.ts`):

- `openai-compat.spec.ts` — the request carries a `signal`; a configured timeout
  is honoured; an aborted request rejects from `complete()` rather than
  resolving or hanging. The existing `capture()` helper already injects a
  `fetchFn`, so the timeout is testable without any network or timing
  dependency.
- `classifier.module.spec.ts` (new file — `selectProvider` has no unit test
  today) — `selectProvider` threads `LLM_TIMEOUT_MS` into
  the provider, and defaults it when the variable is absent or unparseable.

No integration test. The live-network Vitest suite drives `createCustomSource`
against a real board and is unrelated; adding a suite that requires a running
Ollama would be a suite that silently skips on every machine that does not have
one, which this repository already treats as a known trap (an `INTEGRATION=1`
self-skipping suite proves nothing when green).

Manual verification, which is the real test of this change:

1. `ollama pull llama3.1` and confirm `OLLAMA_HOST=0.0.0.0` is in effect.
2. `docker-compose build && docker-compose up -d` from `backend/`, then
   `docker-compose exec worker sh -c 'wget -qO- $LLM_BASE_URL/models'` to prove
   the worker can reach Ollama at all. This is the step that catches the
   loopback-binding mistake, and it catches it before any posting is misjudged.
3. Watch a tick classify a posting and confirm the new score row records
   `providerId = 'openai-compat:llama3.1'`.
4. Confirm an existing scored posting is **not** re-scored.

## Documentation

Per this repository's own closing checklist, four documents change:

- **`README.md`** — "Switching to a local model" (line 251) is rewritten as the
  default path rather than an alternative: the `OLLAMA_HOST` prerequisite and
  its LAN-exposure warning, `ollama pull`, the reachability check, the
  `NOTIFY_THRESHOLD_OPENAI_COMPAT_LLAMA3_1` spelling, and `LLM_TIMEOUT_MS`. The
  section is also referenced from Quick start, since it is now a prerequisite of
  a working install rather than an optional detour.
- **`CLAUDE.md`** — the `LLM_PROVIDER` seam description (line 135) gains the
  timeout and the note that Ollama is external to compose by design.
- **`backend/.env.example`** — reordered as above.
- **`docs/features/local-ollama-model.md`** — the record of intent: why Ollama
  is not a compose service, why existing scores are left alone, and why the
  timeout default is generous.
