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
