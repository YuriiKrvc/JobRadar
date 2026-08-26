# Settings page — visual design implementation

**Date:** 2026-08-26
**Status:** approved, ready for planning
**Source design:** `docs/dashboard design/Settings - design doc.html` (main checkout)

## Problem

The dashboard has never been designed. `dashboard/src/styles.css` is 45 lines of
placeholder CSS: system sans, three background tints for verdict rows, borders in
`#ddd`. Every screen the user reads is functional and unfinished.

A design now exists. It was produced from `docs/design-brief.md` and delivered as
two bundled interactive prototypes — one per page — each carrying its markup, a
working state machine, the design-system stylesheet and the webfonts. This spec
covers the **Settings** page and the shared chrome it sits in. The Postings page
has its own design doc and gets its own spec later.

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
  ten Source Serif 4 woff2 subsets.
- The **design-system stylesheet and the written design doc** are in a *different*
  place: a JSON-encoded HTML string on the ~47k-character line. Decode that string
  and the Broadsheet `styles.css` is inline in its `<style>`, followed by the prose
  document ("The workshop") with the rationale, the eleven-field table, the
  accessibility contract and four open questions.

Anyone implementing this should recover both before starting; the prose carries
intent the markup cannot.

## Decisions taken before this spec

Four questions were settled with the user up front:

1. **Scope: design system + shell + Settings.** Port the tokens and shell now.
   Postings keeps its current markup and inherits the new typography and palette;
   it will read plainer than its own design doc until that page is done.
2. **Sources keeps immediate writes.** The mock gives Sources the same dirty chip
   and Save button as the other three sections. That is fiction — each
   toggle/add/edit/delete is its own API call and none bumps the scoring version.
   Sources gets the section header without chip or Save button.
3. **Vendor the webfont.** Source Serif 4 woff2 subsets are extracted from the
   bundle into the repo and `@font-face`'d locally. No font CDN.
4. **The design doc's four open questions are out of scope.** Recorded at the
   bottom of this spec as future work.

## Non-goals

- No backend change. No new endpoint, no new response field, no migration.
  Everything the design displays is already fetched or derivable client-side.
- No Postings redesign beyond what inheriting the tokens does for free.
- No routing library, no state library, no CSS framework, no CSS-in-JS.
- None of the four open questions (delete confirmation, remembered disclosure,
  per-source last-run line, weight what-if).

## Design system

Ported into `dashboard/src/styles.css` as plain global CSS — which is what the
Broadsheet system is built for ("plain CSS on plain HTML: no JavaScript, no build
step"). Everything print-treatment in the source stylesheet — `.cmyk`,
`.halftone`, the plate numerals and headlines, `print-plates.js` — is dropped;
neither JobRadar page uses any of it.

### Tokens

```css
:root {
  --color-bg: #f3f2f2;
  --color-surface: #eae9e9;
  --color-text: #201e1d;
  --color-accent: #0088b0;      /* cyan */
  --color-accent-2: #d6006c;    /* magenta */
  --color-divider: color-mix(in srgb, #201e1d 16%, transparent);

  --color-neutral-100: #f8f4f4; --color-neutral-200: #eae7e7;
  --color-neutral-300: #d7d3d3; --color-neutral-400: #bab6b6;
  --color-neutral-500: #9b9797; --color-neutral-600: #7d7979;
  --color-neutral-700: #605d5d; --color-neutral-800: #444141;
  --color-neutral-900: #2d2b2b;

  --color-accent-100: #e9f8ff; --color-accent-200: #cbeeff;
  --color-accent-300: #99e0ff; --color-accent-400: #62c5ee;
  --color-accent-500: #38a6cf; --color-accent-600: #1186ac;
  --color-accent-700: #006786; --color-accent-800: #004961;
  --color-accent-900: #0a303e;

  --color-accent-2-100: #fff1f4; --color-accent-2-200: #ffdee6;
  --color-accent-2-300: #ffc0d0; --color-accent-2-400: #ff90b1;
  --color-accent-2-500: #ff458e; --color-accent-2-600: #d82071;
  --color-accent-2-700: #aa0b56; --color-accent-2-800: #790e3d;
  --color-accent-2-900: #4b1528;

  --font-heading: "Source Serif 4", system-ui, sans-serif;
  --font-heading-weight: 600;
  --font-body: "Source Serif 4", system-ui, sans-serif;

  --space-1: 5px;  --space-2: 10px; --space-3: 15px;
  --space-4: 20px; --space-6: 30px; --space-8: 40px;

  --radius-sm: 1px; --radius-md: 2px; --radius-lg: 4px;

  --shadow-sm: 0 1px 2px color-mix(in srgb, #2d2b2b 14%, transparent);
  --shadow-md: 0 3px 10px color-mix(in srgb, #2d2b2b 16%, transparent);
  --shadow-lg: 0 12px 32px color-mix(in srgb, #2d2b2b 22%, transparent);
}
```

The ramps are generated in OKLCH on one shared lightness scale, so the same step
of any role matches the others in visual value. Do not hand-tune individual
entries.

`color-scheme: light dark` is removed. The brief specifies a light schema only
and every token above is a light-theme value; leaving the declaration in lets the
browser paint dark form controls on a paper ground.

### Base and components

Base: `body` at 15px/1.55 in the body serif on `--color-bg`; headings in the
heading serif at 42/32/25/20/16/13 with `line-height: 1.12` and
`letter-spacing: -0.015em`; `h6` small-caps; `:focus-visible` a 2px cyan outline
at 2px offset; `::selection` cyan at 30%.

Component classes ported as-is: `.hr`, `.btn` with `.btn-primary` /
`.btn-secondary` / `.btn-ghost`, `.field > label`, `.input` (including
`textarea.input`), `.tag` with `.tag-accent` / `.tag-accent-2` / `.tag-neutral`,
`.table`. `.card` and `.elev-*` are deliberately **not** ported: the design doc is
explicit that sections are separated by whitespace and a single hairline, never
by cards, so the page stays an open broadsheet and there is nothing to card.

Two properties carry weight and must be preserved verbatim rather than
approximated:

- `.input::placeholder` is `color-mix(in srgb, var(--color-text) 65%, transparent)`
  with `opacity: 1`. The value is measured: the browser default gray misses 4.5:1
  on the surface fill; 65% ink measures 4.8:1 and `opacity: 1` defeats Firefox's
  default placeholder fade.
- `.btn` is 14px to match `.input`'s 14px, because the two sit side by side.

### Typeface

Twelve Source Serif 4 woff2 files, carrying the eighteen `@font-face` rules the
source stylesheet declares (400, 600 and 400-italic × latin, latin-ext,
cyrillic, cyrillic-ext, greek, vietnamese), are extracted from the bundle into
`dashboard/public/fonts/` and declared with the same `unicode-range` blocks the
source stylesheet uses, so the browser fetches only the subsets a page needs.
Cyrillic is included: company names and locations are frequently Ukrainian.

## The shell

`App.tsx` gains the masthead the design places above both pages:

- "JobRadar" in the heading serif at 22px, `letter-spacing: -0.02em`.
- The tagline — "Stop scrolling job boards. Read the shortlist." — at 11px,
  uppercase, `letter-spacing: .09em`, at 50% ink. Hidden below 820px.
- The two tabs right-aligned, 15px, each with a 2px bottom rule that is cyan when
  selected and transparent otherwise, and cyan text when selected. `role="tablist"`
  and `aria-selected` stay exactly as they are.
- A 3px ink rule under the whole row.
- A meta strip beneath it at 11px uppercase, 60% ink, three items spread across
  the width: today's date; a run summary built from data already in `App` — the
  newest `run_log` timestamp in `/api/health` (or "never" when there are none) and
  the number of postings currently fetched; and "Scoring settings v{N}".

The first-run banner keeps its current trigger — any `settings` row in
`/api/health` with `status: error`, not just "settings incomplete" — and takes the
magenta block treatment: `--color-accent-2-100` ground, 4px `--color-accent-2`
left rule, text in `--color-accent-2-900`, its "Finish setup" control as
`.btn .btn-primary`.

Page padding is `0 34px`; the Settings section is capped at `max-width: 900px`.

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
| Dirty | `● Unsaved` in `.tag .tag-accent-2`, button reads "Save" | Set by any edit inside that section only. |
| Saving | Button reads "Saving…", disabled | No optimistic update, and the editor is never unmounted, so a slow save cannot eat what is being typed. |
| Saved | `✓ Saved · v{N}` in `.tag .tag-accent` | The version increments once; affected Postings rows go stale. |
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
  Keep the text input, styled `.input`.

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
a `.btn-secondary` Cancel.

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
| `dashboard/public/fonts/*.woff2` | new — twelve Source Serif 4 files extracted from the design bundle |
| `dashboard/src/styles.css` | rewritten — tokens, `@font-face`, base, ported component classes, page-specific classes |
| `dashboard/src/App.tsx` | masthead, tabs, rule, meta strip, magenta first-run banner |
| `dashboard/src/components/SettingsSection.tsx` | new — header, blurb, state chip, Save button, rule, failure block |
| `dashboard/src/components/SettingsPage.tsx` | version line, section composition |
| `dashboard/src/components/ProfileForm.tsx` | two-column layout, employment-type toggles, one-way-door block |
| `dashboard/src/components/ChipInput.tsx` | restyled chips; behaviour unchanged |
| `dashboard/src/components/SourcesTable.tsx` | five-column table, `role="switch"`, row tint, `+ Add a source` row |
| `dashboard/src/components/SourceForm.tsx` | required/optional split, disclosure, help rewrite, gated submit, 409 field marking |
| `dashboard/src/components/DocumentEditor.tsx` | CV treatment, character and word count |
| `dashboard/src/components/RubricEditor.tsx` | two columns, share bars, running sum, all-zero alert |
| `dashboard/tests/*` | updated for the switch, the add-row, the disclosure, the label changes; new tests per below |
| `CLAUDE.md` | the dashboard section: Sources is not a dirty-tracked Save section |
| `docs/features/settings-design.md` | new feature doc |

Backend: untouched. No endpoint, response shape, schema or migration changes.

## Verification

- `cd dashboard && npx vitest run` — the twelve existing suites, four of them
  updated in this work.
- New tests: the section state machine's four states; the disabled Save carrying
  its reason; `aria-expanded` on the optional-selectors disclosure; `role="switch"`
  toggling a source; the `+ Add a source` row opening the same form; a 409 marking
  the colliding field with `aria-invalid` while keeping typed values; the all-zero
  weights alert; the live weight shares against a non-100 sum.
- Manual: `cd dashboard && npm run dev` against a running API. Confirm each
  section saves independently and bumps the version exactly once; confirm a failed
  save keeps the form dirty with its content; confirm the fonts load from
  `/fonts/` with no network request to a CDN; confirm keyboard traversal reaches
  every control with a visible focus ring; confirm the page does not fall apart at
  820px, where the tagline hides and the two-column sections wrap to one.

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
