# JobRadar — Settings in the Database

**Date:** 2026-08-25
**Status:** Approved, ready for implementation planning
**Supersedes:** the "Profile input" and "Config and secrets" sections of
`2026-08-25-jobradar-design.md`
**Depends on:** v1, implemented as of `0be74ab`

File and line references below were verified against that commit.

## Problem

v1 keeps every tunable in four files mounted read-only at `/config`: `cv.md`,
`profile.yaml`, `rubric.md`, and `sources.yaml`. They are read once, at worker
boot. Changing any of them means editing a file on the host and running
`docker compose restart worker`.

That is the wrong loop for the things most likely to change. Adding a company to
watch, pausing a noisy source, raising the minimum salary, or tightening a rubric
anchor are all week-to-week adjustments, and each one currently costs an SSH
session and a restart. The dashboard is already open in a browser tab and already
shows the consequences of these settings; it should be where they are changed.

## Scope

**In scope:** all four config documents move into Postgres and become editable
from the dashboard. A fresh install is configurable entirely from the browser,
with no file editing at all. An existing v1 install imports its files once,
automatically.

**Explicitly not in scope:**

- **Secrets.** `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
  `DATABASE_URL`, and `NOTIFY_THRESHOLD` stay in `.env`. Credentials do not
  belong in the database or in an HTTP response, and moving them would drag
  write-only fields, masking, and an authentication story into a release that
  otherwise needs none.
- **Verdict band thresholds.** `toVerdict()` in `src/classifier/rubric.ts`
  holds the STRONG/MAYBE cutoffs (75 and 50). They stay in code. The bands
  define what STRONG *means* across the tool's whole history, whereas weights
  only affect scores computed after the change; making the cutoffs editable
  would retroactively alter how every stored score reads.
- **Settings history and rollback.** One mutable row plus a version counter, not
  a revision log. See *Versioning* below for the accepted cost.
- **Rescoring.** Editing the rubric does not re-run the classifier over stored
  postings. Old scores keep their old version tag and are badged in the UI.
- **Authentication.** See *Security* below.

## Versioning

`scores.rubric_version` exists so a 78 scored under one rubric is not silently
compared to a 78 scored under another. Once the CV and profile are editable too,
that column has to mean something broader: three of the four documents feed the
classifier — the CV and rubric directly, the profile through the timezone that
`buildPrompt` passes in — so any of them changing makes future scores
incomparable to past ones.

`app_settings.version` is a single monotonic integer covering all three. It
increments on every save of the CV, profile, or rubric — including the rubric
weights, which change every computed total. It does **not** increment when
sources change, because which boards are polled does not affect how a vacancy is
judged.

On the scores side the migration is one line:

```sql
ALTER TABLE scores RENAME COLUMN rubric_version TO settings_version;
```

The column stays `text`; new rows write `String(version)`. Rows written by v1
keep the `'1'` they got from the old file header — the same shape, so there is no
backfill and no data loss.

**Accepted cost:** with no revision history, a score tagged `settings_version: 7`
records *that* it was judged under a different configuration than version 8, but
not *what* version 7 said. Reconstructing the exact CV and rubric behind an old
score is not possible. This is a deliberate trade for a single-user tool; the
alternative is an immutable revision table and a pointer, which can be added
later without invalidating anything here.

## Data model

Two new tables replace four files.

```sql
CREATE TYPE source_kind AS ENUM ('ats', 'djinni', 'dou');

app_settings                      -- singleton: exactly one row, enforced
  id           boolean     PRIMARY KEY DEFAULT true CHECK (id)
  cv             text        NOT NULL
  rubric_body    text        NOT NULL
  rubric_weights jsonb       NOT NULL     -- $type<RubricWeights>()
  profile        jsonb       NOT NULL     -- $type<Profile>()
  version      integer     NOT NULL DEFAULT 1
  updated_at   timestamptz NOT NULL DEFAULT now()

sources
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid()
  kind       source_kind NOT NULL
  board      text        NULL             -- greenhouse|lever|ashby, ats only
  slug       text        NULL             -- ats only
  url        text        NULL             -- djinni/dou only
  enabled    boolean     NOT NULL DEFAULT true
  created_at timestamptz NOT NULL DEFAULT now()
  CHECK ((kind = 'ats') = (board IS NOT NULL AND slug IS NOT NULL))
  CHECK ((kind = 'ats') = (url IS NULL))
  UNIQUE NULLS NOT DISTINCT (kind, board, slug, url)
```

**`app_settings` is one row, not a key/value table.** The three documents are
singletons that always load together. One row gives them one atomic write, one
shared version counter, and real typed columns through Drizzle's
`$type<Profile>()`. A key/value table would force all three into untyped jsonb
and turn "bump the version once per save" into a multi-row problem.

**`sources` is flat even though `SourcesSchema` is grouped.** The v1 schema is
`{ats: [{board, slug}], djinni: [url], dou: [url]}`. A flat table is what the CRUD
view and the per-row enable toggle need — and that toggle is new; v1 can only
remove a source, not pause one. A `toSourcesConfig(rows)` helper regroups the
enabled rows back into the existing shape, so **`buildSources()` and all three
adapters are untouched by this release**.

`UNIQUE NULLS NOT DISTINCT` requires Postgres 15 or later; the stack is on 17.
It makes seeding idempotent through `ON CONFLICT DO NOTHING`, since without it
the `NULL` columns would let duplicate rows through. If the installed Drizzle
version's `unique()` builder does not expose `nullsNotDistinct()`, the
constraint is written by hand into the generated migration — `drizzle-kit`
emits reviewable SQL, which the v1 spec already relies on.

**A source's identity is immutable.** `PATCH` toggles `enabled` and nothing
else; correcting a mistyped slug or URL means deleting the row and adding it
again. Editing identity in place would silently orphan every posting whose
stable id was derived from the old `board:slug`, which is a far worse outcome
than retyping one field.

Migrations are generated with `drizzle-kit generate`, as in v1.

## Backend

### What is removed

- `src/config/config.module.ts` and `src/config/app-config.service.ts` — deleted.
- The `SOURCES` DI provider token — deleted.
- `CONFIG_DIR` and the `./config:/config:ro` mount on `worker` — removed once the
  import has run.

### What survives

- `src/config/schema.ts` moves to `src/settings/schema.ts` **unchanged**.
  `ProfileSchema` and `SourcesSchema` stop validating parsed YAML and start
  validating JSON request bodies. Same schemas, same guarantees, new input. This
  is the main reason the refactor is cheaper than it appears.
- `src/config/load.ts` moves to `src/settings/import.ts`. `loadConfig()` is no
  longer part of the runtime path; it is called only by the one-shot seeder.

### The snapshot

```ts
interface AppSettings {
  cv: string;
  rubric: {
    version: string;                           // String(row.version)
    body: string;
    weights: RubricWeights;                    // Record<keyof SubScores, number>
  };
  profile: Profile;
  sources: SourcesConfig;                      // regrouped from enabled rows
}
```

Near-identical to v1's `AppConfig`, deliberately: `buildPrompt()` reads only
`rubric.body` (`prompt.ts:28`), so widening `Rubric` is backward-compatible
there, and `buildSources()`, `applyHardFilters()`, and the score-writing path
keep their current signatures.

The one exception is `weightedTotal()`. See *Rubric weights* below.

### New module: `src/settings/`

| File | Responsibility |
|---|---|
| `settings.repository.ts` | Drizzle queries; the `version = version + 1` update; source CRUD |
| `settings.service.ts` | `load(): Promise<AppSettings>` — composes the row and enabled sources |
| `settings.controller.ts` | The eight endpoints below |
| `settings.schema.ts` | `ProfileSchema`, `SourcesSchema`, `SourceInputSchema` |
| `import.ts` | One-shot file import, seeder only |
| `settings.module.ts` | Wiring; depends on `DatabaseModule` and nothing else |

### Changes to existing v1 modules

- **`pipeline.service.ts:37`** — `run()` calls `settings.load()` once at the top and
  threads the snapshot into hard filters, the classifier, and source
  construction. One read per 30-minute tick, so a run can never observe settings
  changing under it mid-flight, and the next tick picks up an edit with no
  restart.
- **`sources.module.ts:11-13`** — the `SOURCES` token is deleted. Today it is a
  `useFactory` that calls `buildSources(cfg.sources)` at DI time and is injected
  into `pipeline.service.ts:38` as a `JobSource[]`. `PipelineService` calls
  `buildSources(settings.sources)` per run instead.
- **`classifier.service.ts:26`** — stops injecting `AppConfigService`;
  `classify(posting, settings)` takes the snapshot as an argument. This removes a
  dependency rather than adding one, and eliminates the
  `configStub as unknown as AppConfigService` cast in
  `classifier.service.spec.ts:29` and `pipeline.service.spec.ts:53`.
- **`classifier/rubric.ts`** — `WEIGHTS` is renamed `DEFAULT_WEIGHTS` and kept
  only as the seeder's starting value. `weightedTotal(subscores)` becomes
  `weightedTotal(subscores, weights)`; its one caller,
  `classifier.service.ts:62`, passes `settings.rubric.weights`. `toVerdict()` is
  unchanged.

- **`notify`** — `notifyThresholdFor(providerId)` lives on
  `app-config.service.ts:23` but only ever reads environment variables, which are
  not moving. `AppConfigService` is being deleted, so it relocates to the notify
  module; its one caller, `pipeline.service.ts:96`, injects it from there.

`ApiRoot` gains `SettingsModule`. Because that module is DB-backed and has no
filesystem dependency, the `api` service still needs no `/config` mount and
cannot throw at boot over a missing file.

### Rubric weights

The five weights currently live in `src/classifier/rubric.ts` as a `const`
summing to 100, and `weightedTotal()` divides the accumulated product by a
hardcoded `100`. That divisor is only correct while the weights sum to exactly
100 — an invariant that cannot survive user editing.

**Totals are normalized by the actual sum rather than by 100:**

```ts
export function weightedTotal(s: SubScores, w: RubricWeights): number {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const key of Object.keys(w) as (keyof SubScores)[]) acc += s[key].score * w[key];
  return Math.round(acc / sum);
}
```

Only the *relative* weights have ever mattered mathematically, so normalizing
lets a weight be raised without rebalancing the other four, keeps every total in
0–100 so the verdict bands and the dashboard's near-miss band stay meaningful,
and removes a "must total 100" validation rule from the form. `35/20/15/20/10`
and `70/40/30/40/20` are the same rubric, which is correct.

**The dimension keys are fixed, not editable.** They are pinned by the
classifier's Zod output schema — `coreStack`, `seniority`, `domain`,
`logistics`, `growth`. Weights are a fixed-key map of five numbers; adding a
sixth dimension would mean changing the output schema and the prose anchors
together, which is a different and larger change.

```ts
const RubricWeightsSchema = z.object({
  coreStack: z.number().int().min(0).max(1000),
  seniority: z.number().int().min(0).max(1000),
  domain:    z.number().int().min(0).max(1000),
  logistics: z.number().int().min(0).max(1000),
  growth:    z.number().int().min(0).max(1000),
}).refine(w => Object.values(w).some(n => n > 0), 'at least one weight must be above zero');
```

The `refine` is load-bearing: all-zero weights would divide by zero and yield
`NaN`, which would be stored as a total and silently corrupt the score row. A
matching `CHECK` on the column enforces the same floor at the database level.

### Incomplete-settings guard

A fresh install has a seeded row with an empty CV and no sources. Rather than
classify against an empty CV and produce noise, `run()` checks first: if
`cv.trim()` is empty, or no source is enabled, it writes a `run_log` row with
`error: 'settings incomplete: <what>'` and returns without calling the model.

This reuses the existing health mechanism — the condition surfaces in the
dashboard's source-health panel with no new plumbing, and gives the first-run
experience something honest to display.

### REST API

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/settings` | — | `{cv, rubricBody, rubricWeights, profile, version, updatedAt}` |
| PUT | `/api/settings/cv` | `{cv}` | bumps `version` |
| PUT | `/api/settings/rubric` | `{body, weights}` | validated by `RubricWeightsSchema`; bumps `version` |
| PUT | `/api/settings/profile` | `Profile` | validated by `ProfileSchema`; bumps `version` |
| GET | `/api/sources` | — | all rows, enabled and disabled |
| POST | `/api/sources` | `SourceInput` | 201; 409 on duplicate |
| PATCH | `/api/sources/:id` | `{enabled}` | Toggle only; 404 on unknown id |
| DELETE | `/api/sources/:id` | — | 204; 404 on unknown id |

Three separate PUTs rather than one combined endpoint: it matches a per-section
Save button in the UI, and makes "one version bump per save" fall out of the
design instead of requiring diff logic to decide whether a bump is warranted.

Validation runs through the `ZodValidationPipe` v1 already has.
`SourceInputSchema` is a discriminated union on `kind`, mirroring the two `CHECK`
constraints so the API and the database reject exactly the same inputs.

`POST /api/sources` maps the Postgres unique violation (SQLSTATE `23505`) to a
409 with the conflicting source named, rather than letting a 500 escape.

### Error body

The dashboard client reads `body.error` for failure detail
(`dashboard/src/api/client.ts:8-9`), but NestJS returns
`{message, error, statusCode}` — so a validation failure renders as the literal
string "Bad Request". With 400s now carrying per-field Zod issues, that becomes
load-bearing. This release pins one error body across every endpoint:

```json
{ "statusCode": 400, "error": "Bad Request", "message": "profile.minSalaryUsd: must be a positive integer" }
```

and the dashboard client reads `message`.

## Dashboard

### Navigation

A two-tab toggle held in `useState` — Postings / Settings. Not `react-router`:
that is a dependency and a build-config change to switch between two components,
against a spec whose stated position is plain `fetch` and plain CSS until a
library earns its place.

### The Settings screen

Four sections, one per document, each owning its own Save button:

- **Profile** — chip input for excluded locations, chip input for employment
  types, nullable number for minimum salary, timezone select. Employment types
  are chips with suggestions rather than a fixed checkbox set, because
  `ProfileSchema` types them as `z.array(z.string())` — free strings, not an
  enum.
- **Sources** — a table of all rows showing kind, identity (board + slug, or
  url), an enable/disable toggle, and delete. Below it an add form whose fields
  swap on the selected `kind`.
- **CV** — markdown textarea.
- **Rubric** — markdown textarea for the prose anchors, plus five number
  inputs for the weights. Each input shows its **effective percentage**
  (`weight / sum`) beside the raw number, live, so the meaning of a change is
  visible without mental arithmetic and without the form demanding a total of
  100. The current `version` is displayed alongside. Save is blocked while every
  weight is zero, matching the schema's `refine`.

Save buttons are dirty-tracked and disabled when nothing has changed. Saving,
saved, and error states are local to each section. No optimistic updates: PUT,
then refetch. On failure the form stays dirty and keeps the user's input.

### Two touches that make the version counter visible

Both use data already on hand:

- The postings table badges any score whose `settings_version` differs from the
  current one as *scored under older settings*.
- When the incomplete-settings guard is active, the Postings screen shows a
  "finish setup" banner linking to Settings. A fresh install therefore lands on
  an empty postings table that says what to do next — this is what makes the tool
  configurable from the browser rather than merely editable there.

### Concurrent edits

Two browser tabs editing the same document will clobber each other,
last-write-wins. Accepted: single user, loopback-bound. An `If-Match` on
`version` would fix it and can be added without changing the schema.

## Security

The API binds `127.0.0.1:8080` in every compose service, so it is reachable only
from the host; VPS access is over an SSH tunnel. Turning a read-only surface into
a write surface therefore exposes nothing new to the network, and no
authentication is added. Secrets stay in `.env` and never cross the API boundary,
so the worst case for an attacker who already has host access is editing a CV
they could read from disk anyway.

This holds only while the bind stays on loopback. **Exposing port 8080 publicly
requires authentication first** — the same condition the v1 spec already places
on adding a TLS-terminating proxy.

## Migration and first run

Seeding runs inside the existing `migrate` one-shot service, immediately after
`drizzle-kit migrate`. That reuses v1's race-free pattern: `worker` and `api`
both declare `depends_on: {migrate: {condition: service_completed_successfully}}`,
so neither can seed concurrently.

1. If `app_settings` already has a row, do nothing and exit 0.
2. Otherwise, if `/config` is mounted and readable, import through
   `loadConfig()`. Weights are **not** in `rubric.md` and never were, so a v1
   import takes them from `DEFAULT_WEIGHTS` — an upgrading install keeps exactly
   the scoring behaviour it had.
3. Otherwise insert built-in defaults — the placeholder CV and rubric text v1
   ships, plus `DEFAULT_WEIGHTS`.
4. Sources insert with `ON CONFLICT DO NOTHING`.

The whole step is idempotent, so it is safe on every `docker compose up`.

**Upgrading from v1:** `git pull && docker compose up -d --build`. The files are
imported on the first boot. Once `/api/settings` shows the expected content, the
`./config:/config:ro` mount and the `CONFIG_DIR` environment variable can be
deleted from `docker-compose.yml`; the directory itself can be kept as a backup
or removed.

**Fresh install:** `cp .env.example .env`, fill in the keys, `docker compose up -d`,
open the dashboard, and complete setup in the Settings tab. No config file is
ever touched.

The v1 README's "Tuning the rubric" section, which instructs the reader to edit
`config/rubric.md` and bump its `version:` header, is rewritten to point at the
Settings tab.

## Error handling

- **Settings read failure in the worker** writes a `run_log` row and returns; the
  next 30-minute tick retries. Identical in shape to a failing adapter, so there
  is no new failure mode to reason about.
- **Validation failures** return 400 with the offending field named, rendered
  inline by the form section that owns it.
- **Duplicate source** returns 409 naming the conflict.
- **Save failures** leave the form dirty and the input intact.

## Testing

| Suite | Runner | Coverage |
|---|---|---|
| Backend unit | Jest + `supertest` | Settings controllers against a stubbed repository; `toSourcesConfig()` regrouping and its enabled-filter; `SourceInputSchema` rejecting a `djinni` row carrying a `slug`; the incomplete-settings guard writing a `run_log` row instead of classifying; `weightedTotal()` normalizing a non-100 sum, and proportional weights (`35/20/15/20/10` vs `70/40/30/40/20`) producing identical totals; `RubricWeightsSchema` rejecting all-zero weights |
| Backend integration | Vitest, throwaway Postgres schema | Repository CRUD; `version` incrementing atomically under concurrent updates; the unique violation mapping to 409; the seeder run twice producing exactly one row |
| Dashboard | Vitest + Testing Library | Profile validation and save; source add, toggle, delete; dirty-state button disabling; error rendering from `message`; the first-run banner; effective-percentage recomputation as a weight changes, and Save disabled on all-zero weights |

The pipeline tests that currently build a `configStub` cast to
`AppConfigService` are rewritten to pass a plain `AppSettings` object, which is
simpler than what they replace. The existing `rubric.spec.ts` cases keep their
expected totals by passing `DEFAULT_WEIGHTS` explicitly, so the normalization
change is provably behaviour-preserving for the shipped defaults.

## Decisions and trade-offs

| Decision | Rationale | Cost accepted |
|---|---|---|
| Built after v1, not folded into it | v1 ships sooner, and real use reveals which settings actually get tuned | The YAML and markdown loaders are written, then demoted to import-only |
| Version counter, not a revision log | Single-user tool; a counter answers "are these scores comparable" | Cannot reconstruct what an old settings version actually said |
| All four documents move | Partial migration would leave two editing workflows in place | Four editors instead of one generic one |
| Secrets stay in `.env` | Credentials do not belong in a database or an HTTP response | First-run still requires editing one file |
| Rubric weights editable, verdict bands not | Weights affect only future scores; bands change how every stored score reads | Reweighting can cluster results just under a fixed cutoff, with no way to move the line |
| Weights normalized, not validated to 100 | Only relative weights matter; removes a rebalancing chore from every edit | Two different-looking weight sets can be the same rubric |
| Dimension keys fixed | They are pinned by the classifier's Zod output schema | Adding a sixth dimension is a separate, larger change |
| Per-run DB read, no cache | One read per 30-minute tick is free; a cache spanning two containers needs LISTEN/NOTIFY | Four v1 modules are rewired |
| `AppSettings` keeps `AppConfig`'s shape | `buildPrompt`, `buildSources`, `applyHardFilters` and the adapters stay untouched | The snapshot carries a `rubric.version` string that is really a stringified integer |
| Flat `sources` table | The CRUD view and the enable toggle need rows, not a grouped blob | A regrouping helper between the table and `buildSources()` |
| Forms for profile and sources, textareas for CV and rubric | Structured data cannot be mistyped into the hard filters; prose stays prose | Four bespoke editors rather than one reusable text editor |
| Seed inside `migrate` | Reuses the existing race-free one-shot service | The importer ships in the runtime image although it runs once |
| No authentication | Loopback-only bind; secrets never cross the API | Blocks public exposure until auth is added |
| Two-tab `useState`, no router | Two screens do not justify a routing dependency | A third screen may warrant revisiting |
| Last-write-wins across tabs | Single user | Two open tabs can clobber each other |

## Out of scope

- Secrets management from the UI
- Editable verdict band thresholds and near-miss window
- Adding or removing rubric dimensions
- Settings revision history and rollback
- Triggering a rescore after a settings change
- Authentication and public exposure
- Optimistic concurrency control on saves
