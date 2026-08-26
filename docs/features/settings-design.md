# Settings page visual design

## The problem

The dashboard had never been designed. `dashboard/src/styles.css` was 45 lines
of placeholder CSS — system sans, three background tints for verdict rows,
borders in `#ddd`. Settings is where that showed most: a source is eleven
fields, eight of them CSS selectors copied out of devtools, and the form had
no structure to tell a required field from an optional one, or to explain what
any of them matched. The spec's framing: *"This stopped being a setup screen
and became the hardest design problem in the product — so the whole page is
built for someone returning six months later with no memory of what 'Item'
meant."*

A delivered design ("Broadsheet") fixed the visual language for the whole
dashboard and, for Settings specifically, restructured the source form and
table around that returning-user problem. This doc records what was built
against `docs/superpowers/specs/2026-08-26-settings-design.md` — read that
spec for the full rationale; this is the shorter record of what landed and
where it diverges from the delivered mock.

## The design system port

The Broadsheet system is ported into `dashboard/src/styles.css` as plain
global CSS — tokens in `:root`, then component classes (`.btn`, `.input`,
`.field`, `.tag`, `.table`). No CSS-in-JS, no framework: the source system is
built for "plain CSS on plain HTML," and the dashboard already had no build
step beyond Vite. Print-only treatment from the source stylesheet (`.cmyk`,
`.halftone`, plate numerals) is dropped — neither dashboard page uses it.
`.card` and `.elev-*` are also not ported: sections are separated by
whitespace and a hairline, not cards, so the page reads as an open broadsheet.

Source Serif 4 is self-hosted under `dashboard/public/fonts/` rather than
pulled from a font CDN, because the dashboard must not depend on one. Twelve
woff2 files carry the eighteen `@font-face` rules the source stylesheet
declares (400/600/400-italic × latin, latin-ext, cyrillic, cyrillic-ext,
greek, vietnamese — cyrillic matters because company names and locations are
frequently Ukrainian). `dashboard/scripts/extract-design-fonts.py` pulled
those twelve files out of the delivered design bundle; the script is kept in
the repo as the provenance record for twelve binaries nobody can review by
eye.

Two token values are measured, not chosen, and must not be "tidied" back to
defaults: `.input::placeholder` is 65% ink with `opacity: 1` (the browser
default misses 4.5:1 contrast on the surface fill, and Firefox fades
placeholders further on top of that), and `.btn` is set to 14px to match
`.input`'s 14px because the two controls sit side by side in the source form
and the table.

## The section state machine, and why Sources is exempt

`SettingsSection` (`dashboard/src/components/SettingsSection.tsx`) owns the
save state machine once: clean / dirty / saving / saved / error, rendered as a
header row (heading, blurb, state chip, Save button), a rule, a failure block,
then the section's own fields. Every section renders as `role="region"` named
by its own heading (`aria-labelledby`) — with four buttons on the page reading
"Save," the region is what lets a screen reader, and a test, address one
section among four.

CV, Profile and Rubric each own a dirty-tracked Save button and error state,
matching the three separate document `PUT`s that back them — that pairing is
what makes "one version bump per save" fall out of the design instead of
needing diff logic against the previous snapshot.

**Sources does not get a Save button**, and that is a deliberate divergence
from the delivered mock. The mock renders Sources with the same dirty chip and
Save button as the other three sections; that is fiction, because a source
write is not deferred. Toggling a switch is a `PATCH`, editing a source is a
`PUT`, adding one is a `POST`, deleting one is a `DELETE` — each fires
immediately, and none of them touches `app_settings.version`. A Save button
on that section would promise a batched write that does not exist, so the
implementation renders the same header (headline, blurb, rule) with no chip
and no button, plus a line saying sources save as you go and do not change
the scoring version.

## The source form: four required, six named-but-collapsed

The always-visible add form is gone. A `+ Add a source` row at the foot of the
sources table opens the same `SourceForm` component in an expanded row,
whether adding or editing — one form, two callers, so add and edit can never
drift apart. Editing happens in place rather than delete-and-re-add, because
deleting a source would not lose its postings (`postings.source` is a name
snapshot) but would lose its tuned selectors with no way back.

Four required fields — Name, Listing URL, Item, Link — are always visible
under a `REQUIRED` label. The six optional selectors (title, company,
location, employment type, description, description container) sit behind
one disclosure line, and that line **names all six** rather than saying
"more options." The point of naming them is that a field a user cannot see
still needs to exist for them, in a form this dense — hiding the fields is
fine, hiding that they exist is not.

The submit button stays disabled until all four required fields are non-blank
and prints what's still missing beside it ("Still needed: Item, Link") — a
disabled button never appears with no explanation.

A `409` from the two unique constraints (`name`, `url`) renders inline as a
`role="alert"` naming what collided, marks the offending field with
`aria-invalid` and a magenta border, and keeps every typed value. The backend
already distinguishes the two constraints by reading `constraint_name`; the
client maps that to the field.

## Two conflicts resolved against the mock

- **Employment types.** The mock renders four fixed toggle buttons. But
  `ProfileSchema` types employment types as free strings, so a fixed set would
  silently drop a custom value like `b2b` on save. The implementation keeps
  the four known values (full-time, part-time, contract, internship) as
  `aria-pressed` toggles, and renders any value outside that set as a
  removable chip beside them with an add input — the mock's shape, without
  the data loss.
- **Timezone.** The mock is a three-option select; `ProfileSchema` types it as
  a free string. Kept as a styled `.input` text field for the same reason.

## One deviation kept from the old copy

The mock's help text for the `detail` selector ("Description container") is a
one-liner. The implementation keeps the longer warning that was already in
the codebase: left empty, the whole page's text becomes the description —
navigation, footers, and any salary widget included — and a board's own
salary-filter UI can then trip the minimum-salary hard filter and reject good
postings. This cost real debugging time against DOU (see
`docs/features/custom-sources.md`), and the mock's shorter copy would have
thrown that warning away.

## Files touched

| File | Change |
|---|---|
| `dashboard/public/fonts/*.woff2` | new — twelve Source Serif 4 files |
| `dashboard/scripts/extract-design-fonts.py` | new — extraction script, kept as provenance |
| `dashboard/src/styles.css` | rewritten — tokens, `@font-face`, base, component classes |
| `dashboard/src/App.tsx` | masthead, tabs, rule, meta strip, magenta first-run banner |
| `dashboard/src/components/SettingsSection.tsx` | new — header, blurb, state chip, Save button, failure block |
| `dashboard/src/components/SettingsPage.tsx` | version line, section composition |
| `dashboard/src/components/ProfileForm.tsx` | two-column layout, employment-type toggles, one-way-door block |
| `dashboard/src/components/ChipInput.tsx` | restyled chips; behaviour unchanged |
| `dashboard/src/components/SourcesTable.tsx` | five-column table, `role="switch"`, row tint, `+ Add a source` row |
| `dashboard/src/components/SourceForm.tsx` | required/optional split, disclosure, help rewrite, gated submit, 409 field marking |
| `dashboard/src/components/DocumentEditor.tsx` | CV treatment, character and word count |
| `dashboard/src/components/RubricEditor.tsx` | two columns, share bars, running sum, all-zero alert |
| `dashboard/tests/*` | updated for the switch, the add-row, the disclosure, the label changes; new coverage per section |
| `CLAUDE.md` | dashboard section: Sources save exception, design-system paragraph |

Backend: untouched. No endpoint, response shape, schema or migration changes.

## How to verify it works

**Automated**, run from `dashboard/`:

```bash
cd dashboard && npx vitest run && npm run build
```

At the time this was written: `npx vitest run` passed 132 tests across 13
suites (`PostingsTable`, `useApi`, `ChipInput`, `App`, `RubricEditor`,
`SourceForm`, `ProfileForm`, `SettingsPage`, `SourcesTable`,
`settings-client`, `useSave`, `SettingsSection`, `client`), and `npm run
build` (`tsc -b && vite build`) succeeded, producing
`dist/assets/index-*.css` (~19.7kB) and `dist/assets/index-*.js` (~218kB).

**Manual**, against a running instance — this was not driven as part of
landing this doc, since it touches the user's real compose stack and database;
run it yourself before relying on the deploy:

```bash
cd backend && docker-compose up -d db && docker-compose run --rm migrate && docker-compose up -d api
cd ../dashboard && npm run dev
```

Then walk the Settings tab and confirm:

- Each of CV, Profile and Rubric shows `● Unsaved` on the first keystroke,
  `Saving…` while in flight, then `✓ Saved · v{N+1}` — and the version in the
  masthead increments **once** per save.
- Sources has no Save button and no chip, and its "sources save as you go"
  note is visible.
- A failed save (stop the API mid-edit) leaves the section dirty, keeps the
  typed text, and prints the alert.
- `+ Add a source` opens the form inside the table; adding a source with a
  name that already exists prints the 409 and marks the Name field.
- The optional selectors are collapsed for a new source and open for a source
  that already has one set.
- Fonts load from `/fonts/` — check the network panel for zero requests to
  any font CDN.
- Tab through the page: every control takes a visible cyan focus ring.
- Narrow the window to 800px: the tagline hides, the two-column sections wrap
  to one, and nothing overflows horizontally.

## Open questions, carried over as future work

From `docs/superpowers/specs/2026-08-26-settings-design.md`, all out of scope
here:

1. Should the optional selectors stay open once opened, remembered per
   session?
2. Deleting a source has no confirmation. It does not destroy posting history
   in this codebase — `postings.source` is a name snapshot, so a deleted
   source's postings survive — but it does destroy eleven tuned selectors with
   no undo, so it may deserve the one-way-door treatment Profile's blocklists
   get.
3. A per-source "last run" line inside the edit form would put a failure and
   its cause in one place. The health endpoint already returns the data.
4. Beside each weight, how many current postings would change band if it
   moved? Derivable client-side from the sub-scores, but the sub-scores are
   not yet in the API response — a Postings-page question.
