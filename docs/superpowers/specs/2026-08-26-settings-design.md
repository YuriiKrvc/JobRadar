# Settings page — visual design implementation

**Date:** 2026-08-26 (rebased onto `develop`'s architecture, same day)
**Status:** approved, ready for planning
**Source design:** `docs/dashboard design/Settings - design doc.html` (page 2 of 2)
**Sibling spec:** `docs/superpowers/specs/2026-08-26-postings-redesign-design.md`

This spec was first written against a dashboard that kept one global
stylesheet and did its own shell work inside `App.tsx`. While it was being
implemented, the Postings redesign landed on `develop` and replaced both:
`src/styles/tokens.css` now owns every `:root` custom property, every
component carries a sibling `Foo.module.css`, and the masthead and setup
banner are components of their own. The Postings spec scopes Settings out
explicitly — "page 2 of the design doc, a follow-up task that also depends on
the unimplemented custom-sources feature" — so this is that follow-up, and
the sections below are rebased onto what `develop` now provides.

What changed in the rebase: the design-system and shell sections, which
described work that is already done. What did not: every decision about the
Settings surface itself, which is the part `develop` deliberately left alone.

## Problem

A design was produced from `docs/design-brief.md` and delivered as two bundled
interactive prototypes — one per page — each carrying its markup, a working
state machine, the design-system stylesheet and the webfonts. Page 1, Postings,
has landed: it brought routing, the token file, the CSS Modules substrate, the
masthead and the setup banner with it.

Page 2 is Settings, and it is still the pre-Broadsheet screen. Its colours were
swapped for tokens when the global stylesheet was retired, and nothing else —
`settings.module.css` says as much in its own header: "Layout is deliberately
unchanged from the pre-Broadsheet sheet — page 2 of the design doc redesigns
this surface, and that is a separate task." This spec is that task.

Settings is where the design has the most to fix. A source is eleven fields,
eight of them CSS selectors copied out of devtools, and boards break their markup
routinely. The design doc's framing: *"This stopped being a setup screen and
became the hardest design problem in the product — so the whole page is built for
someone returning six months later with no memory of what 'Item' meant."*

## Reading the design doc

The delivered `.html` is a self-extracting bundle: assets are gzipped, base64'd
and stored in a JSON map on one long line, keyed by UUID. To recover them:

- The **bundle map** is the line longer than 100k characters. Each entry is
  `{mime, compressed, data}`; base64-decode, then gunzip when `compressed`.
  It yields the prototype markup and logic (`text/html`, ~79KB), the runtime, and
  twelve Source Serif 4 woff2 subsets (unused here — see decision 3).
- The **design-system stylesheet and the written design doc** are in a *different*
  place: a JSON-encoded HTML string on the ~47k-character line. Decode that string
  and the Broadsheet `styles.css` is inline in its `<style>`, followed by the prose
  document ("The workshop") with the rationale, the eleven-field table, the
  accessibility contract and four open questions.

Anyone implementing this should recover both before starting; the prose carries
intent the markup cannot.

## Decisions taken before this spec

Four questions were settled with the user up front:

1. **Scope: the Settings surface only.** The design system and the shell are
   already on `develop` and are not re-done here. What remains is the four
   sections and the styling substrate they own.
2. **Sources keeps immediate writes.** The mock gives Sources the same dirty chip
   and Save button as the other three sections. That is fiction — each
   toggle/add/edit/delete is its own API call and none bumps the scoring version.
   Sources gets the section header without chip or Save button.
3. **The webfont is `@fontsource/source-serif-4`**, imported by `tokens.css`.
   The earlier decision to vendor woff2 subsets extracted from the design
   bundle is withdrawn: `develop` already solved this with a dependency, and
   two mechanisms for one typeface is one too many.
4. **The design doc's four open questions are out of scope.** Recorded at the
   bottom of this spec as future work.

## Non-goals

- No backend change. No new endpoint, no new response field, no migration.
  Everything the design displays is already fetched or derivable client-side.
- No Postings redesign beyond what inheriting the tokens does for free.
- No routing library, no state library, no CSS framework, no CSS-in-JS.
- None of the four open questions (delete confirmation, remembered disclosure,
  per-source last-run line, weight what-if).

## Styling substrate

`develop` settled this, and the Postings spec states the rule: `tokens.css` is
"the only place in the dashboard that may define `:root` custom properties or
style bare element selectors — everything else is a CSS Module." This work
consumes that; it does not re-litigate it.

**What already exists and must not be duplicated:**

- `src/styles/tokens.css` — the Broadsheet palette (paper `#f3f2f2`, ink
  `#201e1d`, cyan `#0088b0`, magenta `#d6006c`, the three 100–900 ramps,
  process yellow), the space, radius and shadow scales, the
  `@fontsource/source-serif-4` imports, and a thin base layer of `body`, link
  colour and focus ring. Imported once in `main.tsx`.
- `src/components/settings.module.css` — the Settings surface's shared
  vocabulary (`page`, `section`, `field`, `actions`, `state`, `chips`, `chip`,
  `table`, `rowDisabled`, `version`, `fieldHelp`), described in its own header
  comment as one scoped module for the six components that make up the page,
  "rather than six near-identical ones". Its layout is the pre-Broadsheet
  layout with the colours swapped for tokens — deliberately, pending this work.
- `Masthead.tsx`, `SetupBanner.tsx` and `pages/PostingsPage.tsx`, with their
  own modules.

**What this work adds:** the Settings surface's own styling, as CSS Modules.
`settings.module.css` keeps the shared vocabulary and grows the designed
layout; a section whose styling is substantial enough to stand alone —
`SettingsSection`, `SourceForm` — takes a sibling module of its own rather
than swelling the shared one. Variants are class names chosen in the component
(`s.invalid`, `s.editing`), never style props. Light only.

**What this work finishes:** `src/styles.css` is the legacy global sheet, and
its own header says it is being "retired in stages", with the remaining
Settings rules due to "move into per-component CSS Modules". Those rules
(`.source-form`, `.field-help`, `.selectors`, `.chips`, `.chip`,
`.settings-actions` and the rest) belong to components this work rewrites, so
the file goes with them. Deleting it is part of the definition of done; if
anything in it turns out to belong to a component outside this work's scope,
that rule moves to that component's module rather than keeping the file alive.

There is no font work, no token work, and no design-system port in this spec.

## The shell

Already built, and out of scope: `Masthead.tsx` carries the brand, the
tagline, the route links, the ink rule and the meta strip; `SetupBanner.tsx`
carries the not-scoring banner. Routing is `react-router-dom` v7 with real
paths, and `context/DashboardData.tsx` owns the fetches that `App` used to.

Two consequences for this work:

- `pages/SettingsPage.tsx` is the page component, and it takes its settings
  state from `useDashboardData()` rather than from a prop. The reasons the
  old comments give still hold and must survive: the page gates on `data`,
  never on `loading`, so a reload triggered by one section's save cannot
  unmount the other three mid-edit; and the state is owned above the page so
  the Postings route's stale badge sees a save immediately.
- The masthead already shows "Scoring settings v{N}". The version line above
  the four sections stays as well — it carries the sentence the masthead
  cannot, that saving does not rescore what is already there.

## Section state machine

The rule the page is built on: four sections, four API writes, four dirty states,
four error states — *"So the page cannot be one form. Each section is a headline,
a rule, its own state chip and its own button; nothing spans the boundary, and no
global 'Save all' exists to imply otherwise."*

A new `SettingsSection` component owns that machine in one place. It renders a
header row — `<h2>` at 26px, a blurb at 12.5px in 50% ink, the state chip, the
Save button — then a 1px rule, then the failure block, then its children.

| State | What shows | Rule |
|---|---|---|
| Clean | Button reads "Saved", disabled | Nothing to write; the button never invites a no-op. |
| Dirty | a magenta `● Unsaved` chip, button reads "Save" | Set by any edit inside that section only. |
| Saving | Button reads "Saving…", disabled | No optimistic update, and the editor is never unmounted, so a slow save cannot eat what is being typed. |
| Saved | a cyan `✓ Saved · v{N}` chip | The version increments once; affected Postings rows go stale. |
| Error | `role="alert"` block: what failed, that nothing was written, that the values are still here | The section stays dirty and keeps every typed value. |

The failure block reads: **Save failed.** *{message}* Nothing was written and your
edits are still here — try again.

Each section renders as `role="region"` named by its own heading
(`aria-labelledby`). With four buttons reading "Save" on one page, the region is
what lets a screen-reader user — and a test — address one section among four.

Section headlines and blurbs:

| Section | Headline | Blurb |
|---|---|---|
| Profile | Profile & hard filters | Postings failing these never reach the model. |
| Sources | Sources | Boards polled every 30 minutes. |
| CV | CV | The text every posting is scored against. |
| Rubric | Rubric & weights | How the model is told to judge. |

Above all four, one line: "Scoring settings version {N} — changes apply on the
next run. Saving does not rescore what is already here; those rows are marked
stale instead."

**Sources is the documented exception.** It renders the same header — headline,
blurb, rule — with no state chip and no Save button, because it has nothing to
save: each row write is its own request and none of them bumps the scoring
version. A line under the blurb says so: sources save as you go and do not change
the scoring version. This is a deliberate divergence from the mock, and
`CLAUDE.md` must be amended, since it currently claims all four sections have
their own dirty-tracked Save button.

## Section 1 — Profile and the one-way door

Layout: a left column (`flex: 1; min-width: 290px`) holding excluded locations
and employment types; a right column (`width: 250px`) holding minimum salary and
timezone; then, full width, the two blocked-word lists side by side, then the
one-way-door block.

Excluded locations and both blocked-word lists are the same `ChipInput` — the
design doc is explicit that no second list-of-strings control was invented. It is
restyled, not replaced: chips become square-ish (`--radius-sm`) on
`--color-surface` instead of pills, each with its `×` button keeping
`aria-label="Remove php"`. Its existing duplicate hint stays; the mock silently
drops a repeat, which is worse.

Each blocked list carries its own help text explaining **when in the pipeline** it
is checked — titles before the job page is downloaded, so a rejection also saves a
request; descriptions after — *"because that is the difference the user cannot
infer."* The current copy already says this and is kept.

Two resolved conflicts with the mock:

- **Employment types.** The mock renders four fixed toggle buttons with
  `aria-pressed`. `ProfileSchema` types these as free strings, so a fixed set would
  silently drop a custom value on save. Implementation renders the four known
  values (full-time, part-time, contract, internship) as toggles, renders any
  value outside that set as a removable chip beside them, and keeps an add input.
  The design's shape, without the data loss.
- **Timezone.** The mock is a three-option select; the schema is a free string.
  Keep the text input.

Minimum salary keeps `placeholder="No minimum"` — blank means no floor, and the
label says so.

The one-way-door block is the only warning of its kind in the product and gets
weight to match: `--color-accent-2-100` ground, 4px `--color-accent-2` left rule,
a small-caps `ONE-WAY DOOR` label in the heading serif, and 14px/1.55 body text at
`max-width: 66ch`:

> Removing a blocked word does not bring back the postings it already rejected.
> Those were rejected at fetch time and will not be seen again unless the board
> re-lists them. Add words narrowly.

Magenta appears exactly twice in JobRadar — here, and on a near-miss posting row —
*"so when it appears it means something."* Nothing else on this page may use it
except invalid-field marking and the Delete control, both of which are also
failure semantics.

## Section 2 — Sources

### The table

Five columns, `table-layout: fixed`: On (56px) | Name (150px) | Listing URL |
Edit (66px) | Delete (70px). Eleven fields must not be the resting state.

- **On** is a `role="switch"` button with `aria-checked` and
  `aria-label="Enable {name}"` — a 38×20 track with a 14px knob that slides 16px,
  cyan when on and `--color-neutral-300` when off. It writes immediately: *"turn
  this board off for a week"* is the common act and must not require opening
  anything. This replaces the current checkbox.
- **Name** is in the heading serif at 14px/600, because it is the identity that
  appears on every posting and in the health panel.
- **Listing URL** is quiet — 12.5px at 60% ink, truncated with an ellipsis, not
  monospace.
- **Edit** is a cyan text button with `aria-expanded`, reading "Edit" / "Close".
- **Delete** is a text button in `--color-accent-2-700`.

Disabled rows render at `opacity: 0.5`. The row being edited tints
`rgba(0,136,176,.06)` so it is obvious which board is open. An empty table shows
"No sources configured — add one below."

### One form, two callers

The always-visible add form below the table goes away. A `+ Add a source` row sits
at the foot of the table (a `colspan=5` cell) and opens the **same** `SourceForm`
in an expanded row — *"one form, two callers, so the two can never drift apart."*
Editing must happen in place because repairing selectors by delete-and-re-add
would throw away the board's posting history.

The expanded panel sits on `--color-surface` and opens with its title — "New
source" or "Editing {name}" — and one line: every field except Name and Listing
URL is a CSS selector, read against the page it names; copy them from devtools.

### Required, then optional behind one line

Four required fields are always visible under a small-caps `REQUIRED` label, each
label carrying a magenta asterisk: Name (190px), Listing URL (330px), Item (250px),
Link (250px).

The six optional selectors collapse behind one disclosure line with
`aria-expanded`, and that line **names all six**: "Six optional selectors — title,
company, location, employment type, description, description container." The
disclosure hides the inputs, never the existence of the fields. *"That is what
keeps eleven fields from reading as a wall."* Its open label is "Hide the six
optional selectors", and the revealed group is introduced by "Optional — each has
a sensible fallback".

Help text under every field is two clauses: what it matches, and what happens if
it is left blank. Two fields name their page explicitly — Item and Link are read
against the listing page, Description container against the posting's own page —
*"because that is the confusion that costs an afternoon."* Selector inputs are
monospace; Name and URL are not, so the shape of the form tells you which is
which.

| Field | Key | Required | Read against | Help promises |
|---|---|---|---|---|
| Name | `name` | yes, unique | — | Becomes the posting's source label and the health panel's name. |
| Listing URL | `url` | yes, unique | — | The page that lists the openings; fetched every tick. |
| Item | `selectors.item` | yes | listing page | Each posting block. Everything below is read inside one block. |
| Link | `selectors.link` | yes | item block | The anchor whose href is the posting URL. |
| Title | `selectors.title` | no | item block | Absent: the link's own text is used. |
| Company | `selectors.company` | no | item block | Absent: the source's Name is used. |
| Location | `selectors.location` | no | item block | Absent: the posting shows no location. |
| Employment type | `selectors.employmentType` | no | item block | Feeds the employment-type hard filter. Absent: that filter cannot reject this source. |
| Description | `selectors.description` | no | listing page | On the listing page, if the blurb is there. |
| Description container | `selectors.detail` | no | posting page | Read on the posting's own page, not the listing. **Kept from current copy:** left empty, the whole page becomes the description — navigation, footers and any salary widget included, and a board's own salary filter can then trip the minimum-salary rule and reject good postings. |

The last row is a deliberate deviation: the mock's one-liner drops a warning that
cost real debugging time and is recorded in `CLAUDE.md`.

Below the optional selectors sit the two per-source blocklists as chips on the
paper ground, with the line: these are added to the global blocklists in Profile
for this source — they never subtract from them.

### Submit, and collisions

The submit button stays disabled until all four required fields are non-blank,
with a live reason beside it — "Still needed: Item, Link" — *"never a disabled
button with no explanation."* Labels are "Add source" / "Save this source", beside
a secondary-styled Cancel.

A 409 renders an inline `role="alert"` naming what collided and with which source
— "a source with this name already exists (Stripe). Nothing was saved; your values
are still here." — marks that one field with `aria-invalid` and a magenta border,
and keeps every typed value. The backend already distinguishes the two constraints
by reading `constraint_name`, so the client maps its message to the field.

Blank optional selectors must still be stripped before submit: the backend's
`SelectorsSchema` requires `min(1)` on any value it receives. That behaviour
exists and must survive the rework.

## Sections 3 and 4 — CV and Rubric

**CV** is one field treated as the document it is: a `textarea.input` at
`min-height: 340px`, 14px/1.6 in the body serif, generous padding,
`spellcheck="false"`, with a live character and word count on the right of the
line above it. One sentence sits above: markdown, the single most important input
— every score is a comparison against this text. No preview pane and no sectioned
editor: pasting and editing prose is the whole job.

**Rubric** is two columns: the instructions textarea (`min-height: 210px`) on the
left, and on the right a 320px column of five weight rows — a label (82px), a
right-aligned integer input (56px), an 8px bar filled to that weight's share in
cyan on a 10%-ink track, and the share percentage in the heading serif (44px).
The column header carries the running sum: "Weights — normalised by their sum
({N}), so only the ratios matter." The share, not the raw number, is the only
honest reading of "35".

All-zero weights raise an inline `role="alert"` — "All weights are zero — the
rubric would score nothing. Set at least one above zero." — rather than waiting
for the server to reject the save.

## Accessibility contract

Non-negotiable, and mostly already true. Colour may never be the only carrier of
meaning.

| Requirement | How it is met |
|---|---|
| Real labels | Every input sits in a `.field` with a `<label>`. The tests select by label text, so labels are content, not decoration. |
| Errors | `role="alert"` on every save failure, on the 409, and on the all-zero weights warning. |
| Invalid fields | `aria-invalid` **plus** a magenta border **plus** a sentence — three carriers. |
| Toggles | `role="switch"` + `aria-checked` + an `aria-label` naming the board. |
| Disclosure | `aria-expanded` on the optional-selectors line and on every Edit button. |
| Chip removal | Each `×` is a button with `aria-label="Remove php"`. |
| Disabled state | Never silent: the reason is printed beside the button. |
| Tabs | `role="tablist"` / `aria-selected` as today. |
| Focus | The design system's 2px cyan `:focus-visible` ring at 2px offset, never removed. |

## Files touched

| File | Change |
|---|---|
| `dashboard/src/components/SettingsSection.tsx` + `.module.css` | new — header, blurb, state chip, Save button, rule, failure block |
| `dashboard/src/pages/SettingsPage.tsx` | version line, section composition |
| `dashboard/src/components/settings.module.css` | the shared vocabulary grows the designed layout |
| `dashboard/src/components/ProfileForm.tsx` | two-column layout, employment-type toggles and add input, one-way-door block |
| `dashboard/src/components/ChipInput.tsx` | designed chips, `placeholder` prop; commit behaviour unchanged |
| `dashboard/src/components/SourcesTable.tsx` | five-column table, `role="switch"`, row tint, `+ Add a source` row |
| `dashboard/src/components/SourceForm.tsx` + `.module.css` | required/optional split, disclosure, help rewrite, gated submit, 409 field marking |
| `dashboard/src/components/DocumentEditor.tsx` | CV treatment, character and word count |
| `dashboard/src/components/RubricEditor.tsx` | two columns, share bars, running sum, all-zero alert |
| `dashboard/src/styles.css` | **deleted** — the last of the legacy global sheet goes with the components that owned it |
| `dashboard/tests/*` | updated for the switch, the add row, the disclosure, the label changes; new tests per below |
| `CLAUDE.md` | the dashboard section: Sources is not a dirty-tracked Save section |
| `docs/features/settings-design.md` | new feature doc |

Not touched, because `develop` already provides them: `styles/tokens.css`,
`Masthead.tsx`, `SetupBanner.tsx`, `context/DashboardData.tsx`, routing, and
anything under `components/postings/`.

Backend: untouched. No endpoint, response shape, schema or migration changes.

## Verification

- `cd dashboard && npx vitest run` — every suite, including the ones this work
  rewrites. `npx tsc --noEmit` and `npm run build` clean.
- New tests: the section state machine's four states; the disabled Save
  carrying its reason; `aria-expanded` on the optional-selectors disclosure;
  `role="switch"` toggling a source; the `+ Add a source` row opening the same
  form; a 409 marking the colliding field with `aria-invalid` while keeping
  typed values; the all-zero weights alert; the live weight shares against a
  non-100 sum; a custom employment type surviving a save round trip.
- Tests address a section with `within(screen.getByRole('region', { name }))`.
  Four buttons on the page read "Save", and the region is what tells them
  apart — for a screen reader and for the suite alike.
- Under Vitest, CSS Modules resolve through a proxy that returns the key, so
  `s.rowDisabled` is `"rowDisabled"`. Assert against the imported binding, never
  against an authored class string.
- Manual, and the only check no test can make: `npm run dev` against a running
  API, then walk `/settings`. Each of CV, Profile and Rubric shows `● Unsaved`
  on the first keystroke and `✓ Saved · v{N+1}` after, with the masthead version
  incrementing exactly once per save. Sources has no Save button. A failed save
  keeps the section dirty with its text. `+ Add a source` opens the form inside
  the table, and a duplicate name marks the Name field. Every control takes a
  visible cyan focus ring. At 820px the tagline hides; the two-column sections
  wrap around 610–700px.

## Open questions, recorded as future work

From the design doc, all out of scope here:

1. Should the optional selectors stay open once opened, remembered per session?
2. Deleting a source has no confirmation. It does not destroy posting history in
   this codebase — `postings.source` is a name snapshot, so a deleted source's
   postings survive — but it does destroy eleven tuned selectors with no undo, so
   it may deserve the one-way-door treatment.
3. A per-source "last run" line inside the edit form would put a failure and its
   cause in one place. The health endpoint already returns the data.
4. Beside each weight, how many current postings would change band if it moved?
   Derivable client-side from the sub-scores — but the sub-scores are not yet in
   the API response, which is a Postings-page question.
