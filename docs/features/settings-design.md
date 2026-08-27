# Settings page — visual design

## The problem

A source is eleven fields, eight of them CSS selectors copied out of devtools,
and boards break their markup routinely. Before this work the Settings tab was
the pre-Broadsheet screen: colours had been swapped for tokens when the global
stylesheet was retired during the Postings redesign, but the layout — one
always-visible add form below a checkbox-and-text table, no grouping, no
disclosure — was untouched. The design doc that drove this work put it
plainly: this stopped being a setup screen and became the hardest design
problem in the product, so the whole page had to be built for someone
returning six months later with no memory of what "Item" meant.

Six tasks rebuilt the four sections (CV, Profile, Sources, Rubric) against the
delivered mock, as CSS Modules over the token file the Postings redesign
introduced. This one retires the last of the pre-Modules global stylesheet and
records what shipped.

## The section state machine, and the one section that opts out

`SettingsSection` (`dashboard/src/components/SettingsSection.tsx`) owns a
single four-state machine — clean / dirty / saving / saved / error — and
renders it once: a header row with an `<h2>`, a blurb, a state chip and a Save
button, then a rule, then a `role="alert"` failure block, then whatever the
section passes as children. It renders as a `<section>` named by its own
heading via `aria-labelledby`, which gives it the implicit ARIA role
`region`. That naming is not decoration: with four buttons on the page reading
"Save", the region is what lets a screen reader — and a test — address one of
them. Tests select a section with
`within(screen.getByRole('region', { name: '…' }))` rather than by DOM
position.

Three of the four sections — CV, Profile, Rubric — pass `onSave` and get the
full chip-plus-button treatment: a magenta `● Unsaved` chip on any edit inside
that section, `Saving…` while the request is in flight (the editor is never
unmounted, so a slow save cannot eat what is being typed), a cyan
`✓ Saved · v{N}` chip after, and on failure a dirty section that keeps every
typed value.

**Sources is the documented exception**, and the reason is a fact about the
API, not a styling choice: every source write — `POST`, `PUT`, `PATCH`,
`DELETE` — is its own immediate request, and none of them bumps
`app_settings.version`. The delivered mock gives Sources the same dirty chip
and Save button as the other three, which would be fiction here — a Save
button implies a batch write that does not exist. `SettingsSection` renders
without `onSave`; instead it takes a `note` prop and prints one line under the
blurb explaining that sources save as you go and do not change the scoring
version. This divergence from the mock is called out explicitly because it is
easy to miss reading the design doc alone, and `CLAUDE.md` now states it in
the same terms.

## Profile: two conflicts resolved against the mock

The mock renders four fixed employment-type toggle buttons with
`aria-pressed`. `ProfileSchema` types `allowedEmploymentTypes` as `string[]`, not an
enum, so a fixed set of four buttons would silently drop any value outside
them on the next save — a real loss for something like `b2b`, a value the
schema allows but the mock's four toggles don't name. `ProfileForm.tsx` keeps the four known
values (full-time, part-time, contract, internship) as `aria-pressed` toggles,
renders any other stored value as a removable chip beside them, and keeps an
add input for a fifth value the toggles don't name. The mock's shape, without
the data loss.

The mock's timezone control is a three-option select; `ProfileSchema` types it
as a free string. The implementation keeps the existing text input rather than
narrowing what a user can store.

Below both columns sits the one-way-door block, the only warning of its kind
in the product: removing a blocked word does not bring back the postings it
already rejected, because a rejection writes a score row and the dedup gate is
"has a score row" — the posting is never reconsidered unless the board relists
it. Magenta appears exactly twice in the whole product: this block, and a
near-miss posting row — so that when it appears, it means something.

## Sources: one form, two callers, and a warning kept from the old copy

`SourcesTable.tsx` is a five-column table — On, Name, Listing URL, Edit,
Delete — with the On column now a `role="switch"` button carrying
`aria-checked` and `aria-label="Enable {name}"`, writing immediately on click
rather than requiring the row to be opened first. A `+ Add a source` row at
the foot of the table opens `SourceForm` in an expanded row, and the same
component handles both add and edit, so the two forms can never drift apart
the way two independent implementations eventually would.

`SourceForm` (its own module, not folded into the shared `settings.module.css`
vocabulary, because its layout — the required block, the disclosure, the
per-field help — is substantial enough to stand alone) shows four required
fields — Name, Listing URL, Item, Link — under a `REQUIRED` label, and
collapses the six optional selectors behind one `aria-expanded` disclosure
line. That line names all six ("title, company, location, employment type,
description, description container") rather than just saying "optional
fields", because the whole point of the disclosure is to keep eleven fields
from reading as a wall without hiding that they exist.

Submit stays disabled until all four required fields are non-blank, with a
live reason printed beside it — "Still needed: Item, Link" — so a disabled
button never appears with no explanation. A 409 from the backend's two unique
constraints (`sources_name_uniq`, `sources_url_uniq`) is read by
`constraint_name` and rendered as an inline `role="alert"` naming what
collided and with which source, with the offending field marked
`aria-invalid` plus a magenta border plus the same sentence — three carriers
for one piece of information, matching the page's accessibility contract.

The Description container field's help text is the one deliberate deviation
from the mock's copy: the mock's version is a one-liner, but the longer
warning already in the codebase is kept, because it records a real incident —
verification against a live board produced `hard-filter:salary` rejections on
three good postings when a missing `detail` selector let the whole page's
text (including the board's own salary-filter widget) stand in for the
description. A shorter line would have let that regression happen silently
again.

## CV and Rubric

CV is treated as the document it is: a 340px-minimum markdown textarea,
`spellcheck="false"`, with a live character and word count. Rubric is two
columns — instructions on the left, five weight rows on the right, each with a
bar filled to that weight's share of the running sum. The share is printed
because weights normalise by their actual sum, not by 100
(`classifier/rubric.ts`), so "35" alone tells you nothing about a rubric
weighted `35/20/15/20/10` versus one weighted `70/40/30/40/20` — the share is
the only honest reading. All-zero weights raise an inline `role="alert"` and
disable Save with the reason printed beside it, rather than waiting for the
server's rejection.

## The styling substrate

Styling is CSS Modules over one global token file, a rule this work consumed
rather than set: `src/styles/tokens.css` is the only place permitted to
define `:root` custom properties or style bare element selectors, and every
component carries a sibling `Foo.module.css`. `components/settings.module.css`
holds the vocabulary shared across the whole Settings surface — `field`,
`actions`, `state`, the control styles — while `SettingsSection` and
`SourceForm` earn modules of their own: folding their layout into the shared
file would have recreated exactly the global stylesheet this work retires,
just under a new name.

Two values in the port are measured, not chosen, and are called out in
`CLAUDE.md` so a future pass doesn't "clean them up": the placeholder colour
sits at 65% ink with `opacity: 1` because the browser's default placeholder
opacity misses 4.5:1 contrast against the surface fill, and Firefox fades
placeholders further on top of that; the button font-size is pinned to 14px to
match the input control sitting beside it, rather than inheriting whatever a
parent sets.

Under Vitest, CSS Modules resolve through a proxy that returns the class key
unchanged, so `s.rowDisabled` evaluates to the string `"rowDisabled"` in
tests. Assertions therefore compare against the imported binding, never
against an authored class string — a test that hardcodes `"rowDisabled"`
would pass today and silently stop meaning anything the day the class is
renamed.

## `src/styles.css`: the deletion

`src/styles.css` was the last of the pre-CSS-Modules global stylesheet,
already dead weight before this task: `main.tsx` has loaded only
`styles/tokens.css` since the Postings redesign, and no other file imported
`styles.css`. Confirmed before deleting it:

```
$ grep -rn "styles.css" src/ index.html
(no output)
$ grep -rnoE 'className="[^"{]+"' src/ | sort -u
(no output)
```

No import referenced it and no component still used a bare string
`className`, so every rule it held had already been ported to a `.module.css`
by one of the six preceding tasks (or, in the case of the pieces the Postings
redesign owned, before this work started). Deleting it needed no code change
elsewhere.

## Files touched

**New in this work's six preceding tasks, ported into their own modules:**

| File | Role |
|---|---|
| `dashboard/src/components/SettingsSection.tsx` + `.module.css` | the four-state save machine, `role="region"` |
| `dashboard/src/components/SourceForm.tsx` + `.module.css` | required/optional split, disclosure, gated submit, 409 field marking |
| `dashboard/src/components/settings.module.css` | shared field/actions/state/chips/table vocabulary |
| `dashboard/src/components/ProfileForm.tsx` | two-column layout, employment-type toggles + chips + add input, one-way-door block |
| `dashboard/src/components/ChipInput.tsx` | restyled chips, `placeholder` prop |
| `dashboard/src/components/SourcesTable.tsx` | five-column table, `role="switch"`, `+ Add a source` row |
| `dashboard/src/components/DocumentEditor.tsx` | CV treatment, character/word count |
| `dashboard/src/components/RubricEditor.tsx` | two columns, share bars, running sum, all-zero alert |
| `dashboard/src/pages/SettingsPage.tsx` | version line, section composition |

**This task:**

| File | Change |
|---|---|
| `dashboard/src/styles.css` | deleted |
| `CLAUDE.md` | dashboard section — Sources' Save-button exemption, the styling substrate paragraph |
| `docs/features/settings-design.md` | this file |

Not touched, because `develop` already provided them before this work began:
`styles/tokens.css`, `Masthead.tsx`, `SetupBanner.tsx`,
`context/DashboardData.tsx`, routing, and anything under
`components/postings/`. Backend: untouched throughout — no endpoint, response
shape, schema or migration changed.

## How to verify it works

Automated, from `dashboard/`:

```bash
npx vitest run       # 20 test files, 225 tests, all passing as of this commit
npx tsc --noEmit      # clean
npm run build         # clean
```

Manual — the only check a test can't make, since a CSS deletion is invisible
to jsdom and a mocked CSS Modules proxy can't show you a layout:

1. Run `npm run dev` against a running API (`docker compose up -d` from
   `backend/`, pointed at a scratch database — never the real one), and open
   `/settings`.
2. Confirm the page is *styled*: a stack of unstyled controls (default
   browser form fields, no spacing, no serif headings) would mean a rule this
   work depended on was actually still living in the deleted `styles.css`.
3. Edit the CV, Profile or Rubric section. Each should show a magenta
   `● Unsaved` chip on the first keystroke and a cyan `✓ Saved · v{N+1}` chip
   after Save, with the masthead's version number incrementing exactly once
   per save.
4. Confirm Sources has no Save button and no chip — only the note that
   sources save as you go.
5. Open `+ Add a source`, leave Item and Link blank, and confirm Save is
   disabled with "Still needed: Item, Link" printed beside it. Fill in a name
   that collides with an existing source and confirm the 409 marks the Name
   field with a magenta border and names the collision.
6. Tab through the page and confirm every control shows a visible cyan focus
   ring, and that the two-column sections (Profile, Rubric) wrap to a single
   column somewhere around 610–700px viewport width.

### Verification limits

The manual walkthrough above was not performed as part of this task: doing so
needs a running API, and the API needs Postgres, and this task was scoped to
avoid starting Docker services or touching any database — the compose stack
in this environment points at a real install's data. The automated numbers
above were captured directly; the visual walkthrough is left for whoever next
touches this page, or for a deliberate manual pass against a scratch database.

## The spec

`docs/superpowers/specs/2026-08-26-settings-design.md`. Four open questions
from the design doc were scoped out and are recorded there as future work:

1. Should the optional-selectors disclosure stay open once opened, remembered
   per session?
2. Deleting a source has no confirmation. It does not destroy posting
   history — `postings.source` is a name snapshot, so a deleted source's
   postings survive — but it does destroy eleven tuned selectors with no
   undo, so it may deserve the one-way-door treatment Profile's blocklists
   get.
3. A per-source "last run" line inside the edit form would put a failure and
   its cause in one place. The health endpoint already returns the data.
4. Beside each weight, how many current postings would change verdict band
   if it moved? Derivable client-side from the sub-scores, but the
   sub-scores are not yet in the API response — a Postings-page question.
