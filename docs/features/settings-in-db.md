# Settings in the database

**Spec:** `docs/superpowers/specs/2026-08-25-settings-in-db-design.md`
**Plan:** `docs/superpowers/plans/2026-08-25-settings-in-db.md`

## The problem

v1 kept every tunable in four files mounted read-only at `/config` — `cv.md`,
`profile.yaml`, `rubric.md`, `sources.yaml` — read once at worker boot. Changing
any of them meant an SSH session, an editor, and `docker compose restart worker`.

That is the wrong loop for the things most likely to change. Adding a company to
watch, pausing a noisy source, raising the salary floor, and tightening a rubric
anchor are all week-to-week adjustments. The dashboard was already open in a
browser tab and already showed the consequences of these settings; it is now
where they are changed.

## What was built

Two tables replace the four files:

- **`app_settings`** — a singleton row (`id boolean PRIMARY KEY CHECK (id)`)
  holding the CV, rubric body, rubric weights, profile, and a `version` counter.
- **`sources`** — one row per board, with an `enabled` flag. New in this release:
  v1 could only *remove* a source, never pause one.

`SettingsService.load()` composes them into an immutable `AppSettings` snapshot.
`PipelineService.run()` reads it once at the top of each 30-minute tick and
threads it into hard filters, the classifier, and source construction. Eight REST
endpoints and a second dashboard tab sit on top.

## Design decisions, and what was rejected

**One row, not a key/value table.** The three documents are singletons that
always load together. One row gives them one atomic write, one shared version
counter, and real typed columns through Drizzle's `$type<Profile>()`. A key/value
table would have forced all three into untyped jsonb and turned "bump the version
once per save" into a multi-row problem.

**A flat `sources` table, though `SourcesSchema` is grouped.** The CRUD view and
the per-row toggle need rows, not a grouped blob. A `toSourcesConfig(rows)` helper
regroups the enabled rows back into v1's shape — which is why `buildSources()` and
all three adapters are untouched by this release.

**A version counter, not a revision log.** `scores.rubric_version` became
`scores.settings_version`, because three of the four documents feed the classifier
and any of them changing makes future scores incomparable to past ones. The
counter answers "are these two scores comparable" — which is the question that
matters — but it cannot reconstruct what version 7 actually *said*. Accepted for
a single-user tool; an immutable revision table can be added later without
invalidating anything here.

**Weights normalised by their actual sum, not validated to 100.** `weightedTotal`
divided by a hardcoded `100`, correct only while the weights summed to 100 — an
invariant that cannot survive user editing. Only *relative* weights ever mattered
mathematically, so `35/20/15/20/10` and `70/40/30/40/20` are the same rubric. This
removes a rebalancing chore from every edit and a "must total 100" rule from the
form. `RubricWeightsSchema` refuses all-zero weights, which would divide by zero
and store `NaN` as a total.

**Weights editable, verdict bands not.** `toVerdict()` keeps its hardcoded 75/50.
Weights only affect scores computed after a change; the bands define what STRONG
*means* across the tool's entire history, so making them editable would
retroactively alter how every stored score reads.

**Dimension keys fixed.** `coreStack`, `seniority`, `domain`, `logistics`,
`growth` are pinned by the classifier's Zod output schema. A sixth dimension would
mean changing that schema and the prose anchors together — a larger change.

**A source's identity is immutable.** `PATCH` toggles `enabled` and nothing else.
Editing a slug in place would silently orphan every posting whose stable id came
from the old `board:slug`; retyping one field is the better outcome.

**Secrets stay in `.env`.** `ANTHROPIC_API_KEY`, the Telegram credentials,
`DATABASE_URL`, and `NOTIFY_THRESHOLD` never enter the database or an HTTP
response. Moving them would have dragged write-only fields, masking, and an
authentication story into a release that otherwise needs none.

**No authentication, and that is a constraint, not an omission.** The API binds
`127.0.0.1:8080` in every compose service, so turning a read-only surface into a
write surface exposed nothing new to the network. This holds *only* while the bind
stays on loopback — publishing port 8080 requires auth first.

**Two-tab `useState`, not `react-router`.** A dependency and a build-config change
to switch between two components. A third screen may warrant revisiting.

**Per-run DB read, no cache.** One read per 30-minute tick is free, and a cache
spanning the `worker` and `api` containers would need LISTEN/NOTIFY.

## Files

**Backend, created:** `src/settings/` — `schema.ts`, `import.ts`,
`settings.repository.ts`, `settings.service.ts`, `to-sources-config.ts`,
`settings.controller.ts`, `sources.controller.ts`, `settings.module.ts`,
`seed.ts`; `src/notify/notify.config.ts`.

**Backend, deleted:** `src/config/` in full — `app-config.service.ts`,
`config.module.ts`, and the `SOURCES` DI token. `schema.ts` and `load.ts` moved to
`settings/` rather than being rewritten, which is the main reason the refactor was
cheaper than it looked: `ProfileSchema` and `SourcesSchema` stopped validating
parsed YAML and started validating JSON request bodies, unchanged.

**Backend, modified:** `db/schema.ts` (two tables, the `source_kind` enum, the
column rename), `classifier/rubric.ts` (`WEIGHTS` → `DEFAULT_WEIGHTS`,
`weightedTotal` takes weights), `classifier/classifier.service.ts` (takes the
snapshot as an argument instead of injecting `AppConfigService`),
`pipeline/pipeline.service.ts`, `sources/sources.module.ts` (`SOURCES` array →
`BUILD_SOURCES` factory), `main.ts`, `worker.main.ts`, `once.ts`.

**Dashboard, created:** `api/settings.ts`, `hooks/useSave.ts`,
`components/SettingsPage.tsx`, `ProfileForm.tsx`, `SourcesTable.tsx`,
`RubricEditor.tsx`, `ChipInput.tsx`, `DocumentEditor.tsx`.

**Dashboard, modified:** `App.tsx` (tabs, settings state, first-run banner),
`api/client.ts` (reads `message`, not `error`), `PostingsTable.tsx` (stale badge).

Note that `classifier.service.ts` and `pipeline.service.ts` *lost* a dependency
here. The `configStub as unknown as AppConfigService` casts in their tests are
gone, replaced by a plain `AppSettings` object.

## How to verify it works

```bash
cd backend && npm test          # 21 suites, 139 tests
cd dashboard && npm test        # 11 files, 90 tests
```

Integration tests need a live database:

```bash
cd backend && docker compose up -d db
export DATABASE_URL_TEST=postgres://jobradar:jobradar@localhost:5433/jobradar
npm run test:integration
```

End to end, on a fresh install:

1. `cd backend && cp .env.example .env`, fill in the keys, `docker compose up -d --build`.
2. Open the dashboard. The Postings table is empty and shows a "finish setup"
   banner — the incomplete-settings guard has written a `run_log` row reading
   `settings incomplete: <what>` rather than classifying against an empty CV.
3. Switch to Settings, paste a CV, add a source, save. `curl -s
   localhost:8080/api/settings` reflects it, and `version` has incremented for the
   CV save but not for the source.
4. `docker compose run --rm worker node dist/once.js` scores against the new
   settings with no restart.
5. Change a rubric weight and save. New scores carry the new `settings_version`;
   the postings table badges the older ones.

Upgrading from a v1 install: back up `config/`, `git rm -r --cached config`,
commit, pull, then bring the stack up. The `migrate` service imports the files
once. **Verify `/api/settings` shows your real CV, not the placeholder, before
deleting the backup** — see the README's upgrade section for why that ordering
matters.
