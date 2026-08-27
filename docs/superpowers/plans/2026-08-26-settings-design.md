# Settings Page Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the four Settings sections against the delivered design, as CSS Modules on the substrate `develop` already provides, and retire the last of the legacy global stylesheet.

**Architecture:** `tokens.css` owns `:root` and is extended only with the ramp steps the design uses. `settings.module.css` keeps its role as the Settings surface's shared vocabulary and grows the designed control styles. `SettingsSection` — a new presentational component with its own module — owns the four-state save machine once; the four section components render their fields inside it. `SourceForm` takes its own module because its styling is substantial enough that folding it into the shared file would recreate the global stylesheet under a new name.

**Tech Stack:** React 19, TypeScript, Vite, CSS Modules, Vitest + Testing Library + jsdom. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-settings-design.md`

**Prior art:** This design was implemented once already, on `feature/custom-sources`, against a global stylesheet and an App-owned shell that `develop` has since replaced. That branch is pushed, and its tip is **`96423c2`**. Its component logic, its copy and its tests are correct and reviewed; only their styling mechanism is wrong. Most tasks below therefore start by reading a file out of that commit — `git show 96423c2:<path>` — and converting it. **Read it; do not cherry-pick it.** The conversions are listed per task and they are not mechanical.

## Global Constraints

- **No backend change.** Nothing under `backend/` is modified by any task.
- **No new dependencies.**
- **`tokens.css` is the only file that may define `:root` custom properties or style bare element selectors.** Everything else is a CSS Module. This is `develop`'s stated rule and this work does not bend it.
- **Never reintroduce a global class.** `src/styles.css` is being deleted, not extended.
- **Light schema only.**
- **Colour is never the only carrier of meaning.**
- **Magenta (`--color-accent-2*`) appears only where something failed or cannot be undone:** the one-way-door block, an invalid field, the Delete control, the Unsaved chip, error alerts. Nowhere else.
- **Labels are content, not decoration.** Every input sits in a `.field` with a real `<label>` whose `htmlFor` names a real form control. A `<div>` is labelled with `role="group"` + `aria-labelledby`, never `htmlFor`.
- **No optimistic updates.** Save, then refetch, and only on success. A failed save keeps the section dirty with every typed value. No section is unmounted mid-edit.
- **Copy is verbatim.** Where this plan or `96423c2` gives a string, use it exactly — including `●`, `✓`, `·`, `—` and curly apostrophes.
- **Ink tokens over ad-hoc alpha.** Use `--ink-70`, `--ink-62`, `--ink-55`, `--ink-50`, `--ink-35`, `--ink-20`, `--ink-12`, `--ink-10`, `--ink-05`, `--ink-035`. Where the design's measured value has no token, keep an explicit `color-mix()` in the module and comment why.
- **Monospace is `var(--font-mono)`**, never a hand-written stack.
- **Tests address a section with `within(screen.getByRole('region', { name }))`.** Four buttons on the page read "Save"; the region tells them apart. A section's `aria-labelledby` landmark also answers to `getByLabelText`, so scope any query that would otherwise be ambiguous.
- **Under Vitest, CSS Modules resolve through a proxy returning the key**, so `s.rowDisabled === "rowDisabled"`. Assert against the imported binding (`String(s.x)`), never an authored class string.
- **Test commands:** `cd dashboard && npx vitest run` for everything, `npx vitest run tests/<file>` for one. `npx tsc --noEmit` must stay clean.
- **Baseline:** 185/185 passing at `cbd27b5`. Every task ends green — there is no expected-red window in this plan.

---

### Task 1: The section state machine, and the vocabulary it needs

**Files:**
- Modify: `dashboard/src/styles/tokens.css` (ramp steps only)
- Modify: `dashboard/src/components/settings.module.css` (shared control vocabulary)
- Create: `dashboard/src/components/SettingsSection.tsx`
- Create: `dashboard/src/components/SettingsSection.module.css`
- Test: `dashboard/tests/SettingsSection.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, and every later task depends on these exact names:

```ts
export interface SectionState {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

interface Props {
  id: string;                 // 'cv' — ids the heading, which labels the region
  title: string;
  blurb: string;
  version: number;
  state: SectionState;
  onSave?: () => void;        // absent ⇒ no chip and no Save button
  note?: string;              // only for a section without onSave
  disabledReason?: string | null;  // disables Save and prints the reason
  children: ReactNode;
}
```

Plus these classes in `settings.module.css`, used by Tasks 2–6: `.button`, `.buttonPrimary`, `.buttonSecondary`, `.buttonBare`, `.input`, `.inputMono`, `.textarea`, `.tag`, `.tagAccent`, `.tagAccent2`.

- [ ] **Step 1: Add the ramp steps the design uses**

`tokens.css` carries only the ramp steps Postings needed. The Settings design uses more. Add them in their ramps, in order, keeping the file's existing formatting. Values are from the design system and are not to be adjusted:

```css
  --color-accent-200: #cbeeff;
  --color-accent-300: #99e0ff;
  --color-accent-400: #62c5ee;
  --color-accent-500: #38a6cf;
  --color-accent-600: #1186ac;
  --color-accent-900: #0a303e;

  --color-accent-2-200: #ffdee6;
  --color-accent-2-300: #ffc0d0;
  --color-accent-2-400: #ff90b1;
  --color-accent-2-500: #ff458e;
  --color-accent-2-600: #d82071;
```

The ramps are generated in OKLCH on one shared lightness scale, so the same step of any role matches the others in visual value. Do not hand-tune an entry to taste.

- [ ] **Step 2: Add the shared control vocabulary**

Append to `dashboard/src/components/settings.module.css`. These are the styles every section needs; anything used by exactly one component belongs in that component's own module instead.

```css
/* ── Controls ─────────────────────────────────────────────────────────
   The Settings surface's shared control vocabulary. A rule that only one
   component uses belongs in that component's module, not here. */

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: var(--font-heading);
  font-weight: 600;
  /* 14px matches .input — the two sit side by side in the section header. */
  font-size: 14px;
  line-height: 1.2;
  color: var(--color-text);
  background: transparent;
  border: 1px solid transparent;
  padding: var(--space-2) 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.button:disabled { opacity: 0.45; cursor: not-allowed; }

.buttonPrimary { background: var(--color-accent); color: var(--color-bg); }
.buttonPrimary:hover { background: var(--color-accent-600); }
.buttonPrimary:active { background: var(--color-accent-700); }

.buttonSecondary { border-color: var(--color-divider); }
.buttonSecondary:hover { background: var(--ink-05); }
.buttonSecondary:active { background: var(--ink-12); }

/* A button that is only its text — chip removal, Edit/Delete, the
   disclosure line — where a button box would be noise on an open page. */
.buttonBare {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.input {
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  font: inherit;
  font-size: 14px;
  color: var(--color-text);
  caret-color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
}
/* Measured, not eyeballed: the browser default gray misses 4.5:1 on the
   surface fill, and there is no --ink-65. opacity:1 defeats Firefox's fade. */
.input::placeholder {
  color: color-mix(in srgb, var(--color-text) 65%, transparent);
  opacity: 1;
}
.input:hover { border-color: color-mix(in srgb, var(--color-text) 45%, transparent); }
.input:focus-visible { border-color: var(--color-accent); outline-offset: 0; }
.input[aria-invalid='true'] { border-color: var(--color-accent-2); }

.inputMono { font-family: var(--font-mono); font-size: 13px; }

.textarea { min-height: 90px; resize: vertical; }

.tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  border-radius: calc(var(--radius-md) * 0.75);
}
.tagAccent { background: var(--color-accent-100); color: var(--color-accent-800); }
.tagAccent2 { background: var(--color-accent-2-100); color: var(--color-accent-2-800); }
```

- [ ] **Step 3: Write the failing tests**

Create `dashboard/tests/SettingsSection.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsSection } from '../src/components/SettingsSection';

const CLEAN = { dirty: false, saving: false, saved: false, error: null };

function renderSection(overrides: Partial<React.ComponentProps<typeof SettingsSection>> = {}) {
  return render(
    <SettingsSection
      id="cv" title="CV" blurb="The text every posting is scored against."
      version={12} state={CLEAN} onSave={() => {}} {...overrides}
    >
      <p>fields</p>
    </SettingsSection>,
  );
}

it('names its region by its heading so one section can be addressed among four', () => {
  renderSection();
  const region = screen.getByRole('region', { name: 'CV' });
  expect(within(region).getByText('The text every posting is scored against.')).toBeInTheDocument();
  expect(within(region).getByText('fields')).toBeInTheDocument();
});

it('clean: the button reads Saved and is disabled, with no chip', () => {
  renderSection();
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  expect(screen.queryByText(/Unsaved/)).toBeNull();
});

it('dirty: an Unsaved chip appears and the button reads Save', () => {
  renderSection({ state: { ...CLEAN, dirty: true } });
  expect(screen.getByText('● Unsaved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('saving: the button reads Saving… and is disabled, with no dirty chip', () => {
  renderSection({ state: { ...CLEAN, dirty: true, saving: true } });
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  // The section is no longer waiting for the user; it is waiting for the server.
  expect(screen.queryByText('● Unsaved')).toBeNull();
});

it('saved: the chip carries the version the save produced', () => {
  renderSection({ state: { ...CLEAN, saved: true }, version: 13 });
  expect(screen.getByText('✓ Saved · v13')).toBeInTheDocument();
});

it('error: an alert says nothing was written and the edits are still here', () => {
  renderSection({ state: { ...CLEAN, dirty: true, error: 'The scoring service returned 500.' } });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Save failed.');
  expect(alert).toHaveTextContent('The scoring service returned 500.');
  expect(alert).toHaveTextContent('Nothing was written and your edits are still here — try again.');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('calls onSave when the button is pressed', async () => {
  const onSave = vi.fn();
  renderSection({ state: { ...CLEAN, dirty: true }, onSave });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledOnce();
});

it('disabledReason disables the button and prints the reason beside it', async () => {
  // Never a disabled control with no explanation, and never an enabled one
  // that silently does nothing.
  const onSave = vi.fn();
  renderSection({
    state: { ...CLEAN, dirty: true },
    onSave,
    disabledReason: 'All weights are zero.',
  });
  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  expect(screen.getByText('All weights are zero.')).toBeInTheDocument();
  await userEvent.click(save);
  expect(onSave).not.toHaveBeenCalled();
});

it('without onSave there is no chip and no button, and the note explains why', () => {
  renderSection({
    onSave: undefined,
    title: 'Sources',
    blurb: 'Boards polled every 30 minutes.',
    note: 'Sources save as you go and do not change the scoring version.',
    state: { ...CLEAN, dirty: true, saved: true },
  });
  const region = screen.getByRole('region', { name: 'Sources' });
  expect(within(region).queryByRole('button')).toBeNull();
  expect(within(region).queryByText('● Unsaved')).toBeNull();
  expect(within(region).getByText('Sources save as you go and do not change the scoring version.'))
    .toBeInTheDocument();
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SettingsSection.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/components/SettingsSection"`.

- [ ] **Step 5: Write the component**

Create `dashboard/src/components/SettingsSection.tsx`:

```tsx
import type { ReactNode } from 'react';
import shared from './settings.module.css';
import s from './SettingsSection.module.css';

export interface SectionState {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

interface Props {
  id: string;
  title: string;
  blurb: string;
  version: number;
  state: SectionState;
  /**
   * Absent means the section has nothing to save. Sources is the only such
   * section: each row write is its own request and none of them bumps the
   * scoring version, so a Save button there would be a lie.
   */
  onSave?: () => void;
  /** Only for a section without onSave: why it has no Save button. */
  note?: string;
  /** Disables Save and prints why. Never a disabled control with no reason. */
  disabledReason?: string | null;
  children: ReactNode;
}

export function SettingsSection(
  { id, title, blurb, version, state, onSave, note, disabledReason, children }: Props,
) {
  const { dirty, saving, saved, error } = state;
  const blocked = Boolean(disabledReason);

  return (
    <section className={s.section} aria-labelledby={`${id}-title`}>
      <div className={s.head}>
        <h2 id={`${id}-title`} className={s.title}>{title}</h2>
        <p className={s.blurb}>{blurb}</p>

        {onSave && dirty && !saving && (
          <span className={`${shared.tag} ${shared.tagAccent2}`}>● Unsaved</span>
        )}
        {onSave && saved && !dirty && !saving && (
          <span className={`${shared.tag} ${shared.tagAccent}`}>✓ Saved · v{version}</span>
        )}
        {onSave && (
          <button
            type="button"
            className={`${shared.button} ${shared.buttonPrimary} ${s.save}`}
            disabled={!dirty || saving || blocked}
            onClick={onSave}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      {note && <p className={s.note}>{note}</p>}
      {blocked && <p className={s.note}>{disabledReason}</p>}

      <div className={s.rule} />

      {error && (
        <div role="alert" className={s.error}>
          <strong>Save failed.</strong> {error} Nothing was written and your edits
          are still here — try again.
        </div>
      )}

      {children}
    </section>
  );
}
```

- [ ] **Step 6: Write the section's module**

Create `dashboard/src/components/SettingsSection.module.css`:

```css
/* Sections are separated by whitespace and one hairline, never by cards:
   the page stays an open broadsheet. */
.section { padding: var(--space-6) 0 0; }

.head {
  display: flex;
  align-items: baseline;
  gap: 13px;
  flex-wrap: wrap;
}

.title { font-size: 26px; margin: 0; }

.blurb {
  margin: 0;
  flex: 1;
  min-width: 180px;
  font-size: 12.5px;
  color: var(--ink-50);
}

.save { margin-left: auto; }

.note { margin: 6px 0 0; font-size: 12.5px; color: var(--ink-55); }

.rule { height: 1px; margin-top: 11px; background: var(--ink-20); }

.error {
  margin-top: 13px;
  padding: 11px 14px;
  font-size: 13.5px;
  line-height: 1.5;
  background: var(--color-accent-2-100);
  color: var(--color-accent-2-800);
}

/* Every section wraps its fields in this, so the gap under the rule is one
   value rather than four. */
.body { padding-top: 17px; }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/SettingsSection.test.tsx
```

Expected: PASS, 9 tests.

- [ ] **Step 8: Run the full suite and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/styles/tokens.css dashboard/src/components/settings.module.css dashboard/src/components/SettingsSection.tsx dashboard/src/components/SettingsSection.module.css dashboard/tests/SettingsSection.test.tsx
git commit -m "feat(dashboard): the settings section state machine"
```

Expected: 194/194 passing (185 + 9), `tsc` clean.

---

### Task 2: The CV section

**Files:**
- Modify: `dashboard/src/components/DocumentEditor.tsx`
- Modify: `dashboard/src/pages/SettingsPage.tsx`
- Modify: `dashboard/src/components/settings.module.css`
- Modify: `dashboard/tests/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `SettingsSection`, `SectionState` (Task 1); `shared.textarea`, `shared.input` (Task 1).
- Produces: `DocumentEditor` gains `blurb: string` and `version: number` alongside its existing `id`, `label`, `initial`, `onSave`, `onSaved`. Its Save button is the section's, labelled "Save" / "Saving…" / "Saved". `rows` goes away — the height is CSS now.

**Port source:** `git show 96423c2:dashboard/src/components/DocumentEditor.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/SettingsPage.test.tsx`. Add `within` to the `@testing-library/react` import if it is not already there.

```tsx
  it('carries the section blurb and a live character and word count', async () => {
    render(<Harness />);
    const cv = within(await screen.findByRole('region', { name: 'CV' }));
    expect(cv.getByText('The text every posting is scored against.')).toBeInTheDocument();
    // 'existing cv' — 11 characters, 2 words.
    expect(cv.getByText('11 characters · 2 words')).toBeInTheDocument();

    await userEvent.type(cv.getByLabelText(/^cv/i), '!');
    expect(cv.getByText('12 characters · 2 words')).toBeInTheDocument();
  });

  it('counts an empty CV as zero words, not one', async () => {
    // ''.split(/\s+/) is [''], length 1 — the classic off-by-one.
    render(<Harness />);
    const cv = within(await screen.findByRole('region', { name: 'CV' }));
    await userEvent.clear(cv.getByLabelText(/^cv/i));
    expect(cv.getByText('0 characters · 0 words')).toBeInTheDocument();
  });

  it('turns off spellcheck: a CV is not prose the browser should second-guess', async () => {
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');
    const cv = within(screen.getByRole('region', { name: 'CV' }));
    expect(cv.getByLabelText(/^cv/i)).toHaveAttribute('spellcheck', 'false');
  });
```

Then rescope this file's existing CV queries. The section's `aria-labelledby` landmark answers to `getByLabelText` as well, so a bare `/^cv$/i` becomes ambiguous once the region exists:

- `screen.getByRole('button', { name: /save cv/i })` → `within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ })`
- `screen.getByLabelText(/^cv$/i)` → `within(screen.getByRole('region', { name: 'CV' })).getByLabelText(/^cv/i)`

Leave the Profile and Rubric queries in this file alone — Tasks 3 and 4 own them, and they still pass until then.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SettingsPage.test.tsx
```

Expected: FAIL — no element with role `region` and name `CV`.

- [ ] **Step 3: Rewrite DocumentEditor**

Read `git show 96423c2:dashboard/src/components/DocumentEditor.tsx` and port it. It is already correct in behaviour; convert it:

- `import css from './settings.module.css'` and `import s from './SettingsSection.module.css'` for `s.body`. (`css` for the shared module, `s` for a component's own — the convention `SettingsPage.tsx` already uses.)
- `className="input doc-editor-area"` → `` className={`${css.input} ${css.textarea} ${css.cvArea}`} `` — the CV rules are small and belong in the shared module.
- `className="settings-section-body"` → `s.body`.
- `className="doc-editor-meta"` / `"doc-editor-count"` → `css.cvMeta` / `css.cvCount`.

Keep unchanged, because each encodes a fixed bug: the `useEffect` that re-seeds from `initial`; `disabled={save.saving}` on the textarea; and the success-only refetch (`if (await save.run(value)) onSaved();`) — reloading on failure is exactly the path that silently overwrites a rejected edit.

Keep the label sentence verbatim; it is the field's accessible name and the tests match its prefix:

```tsx
          <label htmlFor={id}>
            CV — markdown. The single most important input: every score is a
            comparison against this text.
          </label>
```

- [ ] **Step 4: Add the CV styles**

Append to `dashboard/src/components/settings.module.css`:

```css
/* ── CV ───────────────────────────────────────────────────────────────── */
.cvMeta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 7px;
}
.cvMeta label { margin: 0; font-size: 12px; font-weight: 400; color: var(--ink-70); }
.cvCount { font-size: 11.5px; color: var(--ink-50); }
.cvArea {
  min-height: 340px;
  padding: 15px 17px;
  font-size: 14px;
  line-height: 1.6;
  font-family: var(--font-body);
}
```

Note `.cvMeta label` overrides the `.section label { font-weight: 600 }` rule the shared module already carries.

- [ ] **Step 5: Wire it up in SettingsPage**

In `dashboard/src/pages/SettingsPage.tsx`, replace the `DocumentEditor` element:

```tsx
      <DocumentEditor
        id="cv"
        label="CV"
        blurb="The text every posting is scored against."
        version={s.version}
        initial={s.cv}
        onSave={(v) => saveCv(v)}
        onSaved={settings.reload}
      />
```

and give the version line the design's full sentence:

```tsx
      <p className={css.version}>
        Scoring settings version {s.version} — changes apply on the next run.
        Saving does not rescore what is already here; those rows are marked
        stale instead.
      </p>
```

- [ ] **Step 6: Run the tests and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/components/DocumentEditor.tsx dashboard/src/pages/SettingsPage.tsx dashboard/src/components/settings.module.css dashboard/tests/SettingsPage.test.tsx
git commit -m "feat(dashboard): the CV section, with its live character and word count"
```

Expected: everything green.

---

### Task 3: The Profile section and the one-way door

**Files:**
- Modify: `dashboard/src/components/ProfileForm.tsx`
- Modify: `dashboard/src/components/ChipInput.tsx`
- Modify: `dashboard/src/components/settings.module.css`
- Modify: `dashboard/src/pages/SettingsPage.tsx`
- Modify: `dashboard/tests/ProfileForm.test.tsx`
- Modify: `dashboard/tests/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `SettingsSection` (Task 1).
- Produces: `ProfileForm` gains `version: number` beside `initial` and `onSaved`. `ChipInput` gains `placeholder?: string`. `ProfileInput`'s shape does not change.

**Port source:** `git show 96423c2:dashboard/src/components/ProfileForm.tsx` — including its final fix, which gave the toggle group `role="group"` + `aria-labelledby` after an orphaned `<label htmlFor>` pointing at a `<div>` was caught in review. Do not reintroduce the orphan.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/ProfileForm.test.tsx`. The file's existing fixture and `api` import are already there; reuse them rather than adding a second set.

```tsx
it('toggles a known employment type on and off with aria-pressed', async () => {
  render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time'] }} version={1} onSaved={() => {}} />);

  expect(screen.getByRole('button', { name: 'full-time' })).toHaveAttribute('aria-pressed', 'true');
  const contract = screen.getByRole('button', { name: 'contract' });
  expect(contract).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(contract);
  expect(screen.getByRole('button', { name: 'contract' })).toHaveAttribute('aria-pressed', 'true');
});

it('gives the employment-type toggles a real accessible group name', () => {
  // htmlFor cannot bind to a div; the group needs naming another way, or a
  // screen reader announces four bare buttons with no context.
  render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
  const group = screen.getByRole('group', { name: 'Allowed employment types' });
  expect(within(group).getAllByRole('button')).toHaveLength(4);
});

it('keeps an employment type that is not one of the four known values', async () => {
  // ProfileSchema types these as free strings. A fixed set of toggles would
  // drop a custom value on the next save without saying so.
  const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
  render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time', 'b2b'] }} version={1} onSaved={() => {}} />);

  expect(screen.getByText('b2b')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'contract' }));
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

  await waitFor(() => expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ allowedEmploymentTypes: ['full-time', 'b2b', 'contract'] }),
  ));
});

it('adds a custom employment type through the add input', async () => {
  // Removable-but-not-addable would be the same silent loss, moved from
  // save-time to add-time.
  const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
  render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);

  await userEvent.type(screen.getByLabelText(/add an employment type/i), 'b2b{Enter}');
  expect(screen.getByText('b2b')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

  await waitFor(() => expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ allowedEmploymentTypes: ['b2b'] }),
  ));
});

it('refuses an employment type that is already present', async () => {
  render(<ProfileForm initial={{ ...BASE, allowedEmploymentTypes: ['full-time'] }} version={1} onSaved={() => {}} />);
  await userEvent.type(screen.getByLabelText(/add an employment type/i), 'full-time{Enter}');

  expect(screen.getByRole('status')).toHaveTextContent(/already/i);
  expect(screen.getAllByText('full-time')).toHaveLength(1);
});

it('shows the one-way-door warning about removing a blocked word', () => {
  render(<ProfileForm initial={BASE} version={1} onSaved={() => {}} />);
  expect(screen.getByText('ONE-WAY DOOR')).toBeInTheDocument();
  expect(screen.getByText(/Removing a blocked word does not bring back the postings it already rejected/))
    .toBeInTheDocument();
});

it('offers no salary floor by default and sends null for a blank field', async () => {
  const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
  render(<ProfileForm initial={{ ...BASE, minSalaryUsd: 70000 }} version={1} onSaved={() => {}} />);

  const salary = screen.getByLabelText(/minimum salary/i);
  expect(salary).toHaveAttribute('placeholder', 'No minimum');
  await userEvent.clear(salary);
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

  // Blank means no floor, which is null — not 0, which ProfileSchema rejects.
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ minSalaryUsd: null })));
});
```

Add `version={1}` to every existing `render(<ProfileForm …>)` call in the file, and change its save-button queries from `{ name: /save profile/i }` to `{ name: /^Save/ }`. Add `within` and `waitFor` to the imports if missing.

In `dashboard/tests/SettingsPage.test.tsx`, change `screen.getByRole('button', { name: /save profile/i })` to `within(screen.getByRole('region', { name: 'Profile & hard filters' })).getByRole('button', { name: /^Save/ })`. Leave the rubric queries — Task 4 owns them.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/ProfileForm.test.tsx
```

Expected: FAIL — no `group` named "Allowed employment types", no `ONE-WAY DOOR`.

- [ ] **Step 3: Rewrite ProfileForm**

Read `git show 96423c2:dashboard/src/components/ProfileForm.tsx` and port it, converting `className="x"` to `className={css.x}` against the module. Add the add-input, which that version gained late:

```tsx
const KNOWN_EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'internship'];
```

```tsx
  const [typeDraft, setTypeDraft] = useState('');
  const [typeHint, setTypeHint] = useState<string | null>(null);
  const custom = draft.allowedEmploymentTypes.filter((t) => !KNOWN_EMPLOYMENT_TYPES.includes(t));

  function toggleEmployment(type: string) {
    set('allowedEmploymentTypes', draft.allowedEmploymentTypes.includes(type)
      ? draft.allowedEmploymentTypes.filter((t) => t !== type)
      : [...draft.allowedEmploymentTypes, type]);
  }

  function commitEmployment(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = typeDraft.trim();
    if (next === '') return;
    // Clear only on a successful add: clearing first made a rejected duplicate
    // look like silent data loss. Same rule as ChipInput.
    if (draft.allowedEmploymentTypes.includes(next)) {
      setTypeHint(`"${next}" is already in the list.`);
      return;
    }
    setTypeHint(null);
    setTypeDraft('');
    set('allowedEmploymentTypes', [...draft.allowedEmploymentTypes, next]);
  }
```

and render the group as:

```tsx
          <div className={css.field}>
            {/* htmlFor cannot bind to a div, so the group is named with
                aria-labelledby instead of an orphaned label. */}
            <span id="employment-types-label" className={css.groupLabel}>
              Allowed employment types
            </span>
            <div className={css.toggles} role="group" aria-labelledby="employment-types-label">
              {KNOWN_EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t} type="button" className={css.toggle}
                  aria-pressed={draft.allowedEmploymentTypes.includes(t)}
                  disabled={save.saving}
                  onClick={() => toggleEmployment(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* A value outside the four known ones is legal — ProfileSchema
                types these as free strings — so it is shown and removable
                rather than silently dropped on the next save. */}
            {custom.length > 0 && (
              <ul className={css.chips}>
                {custom.map((t) => (
                  <li key={t} className={css.chip}>
                    {t}
                    <button type="button" className={css.buttonBare} aria-label={`Remove ${t}`}
                      disabled={save.saving} onClick={() => toggleEmployment(t)}>×</button>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="employment-type-add" className={css.visuallyHidden}>
              Add an employment type
            </label>
            <input
              id="employment-type-add" className={`${css.input} ${css.chipInput}`}
              value={typeDraft} placeholder="Add a type, then Enter" disabled={save.saving}
              onChange={(e) => { setTypeDraft(e.target.value); setTypeHint(null); }}
              onKeyDown={commitEmployment}
            />
            {typeHint && <p className={css.state} role="status">{typeHint}</p>}
          </div>
```

The rest of the section — the two-column grid, the salary and timezone column, the two blocklists, the one-way-door block — ports directly from `96423c2` with class conversion. Keep verbatim: the value-keyed re-seed effect and its eslint-disable comment (`initial` is a fresh object on every fetch, so identity-keying would reset the form whenever a sibling section saved); the null-not-zero salary handling; and the success-only refetch.

`ProfileForm`'s props gain `version: number`, and `SettingsPage` passes `<ProfileForm initial={s.profile} version={s.version} onSaved={settings.reload} />`.

- [ ] **Step 4: Give ChipInput its placeholder and designed chips**

In `dashboard/src/components/ChipInput.tsx`: add `placeholder?: string` to `Props`, pass `placeholder={placeholder ?? 'Type and press Enter'}` to the input with `className={`${s.input} ${s.chipInput}`}`, and give the `×` buttons `className={s.buttonBare}`. Leave `commit`, the duplicate hint, the `help` paragraph and the suggestions datalist exactly as they are — the mock silently drops a duplicate, which is worse than what already exists.

- [ ] **Step 5: Add the profile styles**

Append to `dashboard/src/components/settings.module.css`, and replace the existing `.chips` / `.chip` rules with these (the pill radius becomes the design's square-ish chip):

```css
/* ── Profile ──────────────────────────────────────────────────────────── */
.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.profileGrid { display: flex; gap: 34px; flex-wrap: wrap; }
.profileCol { flex: 1; min-width: 290px; }
.profileAside { width: 250px; flex: none; }
.profileBlocklists { width: 100%; display: flex; gap: 34px; flex-wrap: wrap; padding-top: 22px; }

/* The blocklist headings ARE their inputs' labels — one string, one node. */
.profileBlocklists > .profileCol > .field > label {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text);
  margin-bottom: 5px;
}

.groupLabel { display: block; font-size: 12px; margin-bottom: 5px; color: var(--ink-70); }

.toggles { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 7px; }
.toggle {
  font-size: 13px;
  padding: 5px 11px;
  cursor: pointer;
  background: transparent;
  color: var(--ink-70);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-md);
}
.toggle[aria-pressed='true'] {
  background: var(--color-accent-100);
  color: var(--color-accent-800);
  border-color: var(--color-accent-300);
}

.chipInput { width: 220px; max-width: 100%; min-height: 32px; font-size: 13px; }

/* The only warning of its kind in the product, and it gets weight to match.
   Magenta appears exactly twice in JobRadar — here and on a near-miss row. */
.oneWayDoor {
  width: 100%;
  margin-top: var(--space-4);
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 14px 17px;
  background: var(--color-accent-2-100);
  border-left: 4px solid var(--color-accent-2);
}
.oneWayDoorLabel {
  flex: none;
  padding-top: 2px;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--color-accent-2-800);
}
.oneWayDoor p {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  max-width: 66ch;
  text-wrap: pretty;
  color: var(--color-accent-2-900);
}
```

and replace the chip rules:

```css
.chips { display: flex; flex-wrap: wrap; gap: 7px; list-style: none; padding: 0; margin: 0 0 7px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  padding: 4px 9px;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}
.chip button { color: var(--ink-50); font-size: 14px; line-height: 1; }
```

- [ ] **Step 6: Run the tests and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/components/ProfileForm.tsx dashboard/src/components/ChipInput.tsx dashboard/src/components/settings.module.css dashboard/src/pages/SettingsPage.tsx dashboard/tests/ProfileForm.test.tsx dashboard/tests/SettingsPage.test.tsx
git commit -m "feat(dashboard): the profile section and its one-way-door warning"
```

---

### Task 4: The Rubric section

**Files:**
- Modify: `dashboard/src/components/RubricEditor.tsx`
- Modify: `dashboard/src/pages/SettingsPage.tsx`
- Modify: `dashboard/src/components/settings.module.css`
- Modify: `dashboard/tests/RubricEditor.test.tsx`
- Modify: `dashboard/tests/SettingsPage.test.tsx`
- Modify: `dashboard/tests/App.test.tsx`

**Interfaces:**
- Consumes: `SettingsSection` with `disabledReason` (Task 1).
- Produces: `RubricEditor` gains `version: number`. Weight labels become the prose forms "Core stack", "Seniority", "Domain", "Logistics", "Growth".

**Port source:** `git show 96423c2:dashboard/src/components/RubricEditor.tsx`, and its all-zero test from `git show 96423c2:dashboard/tests/RubricEditor.test.tsx`.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/RubricEditor.test.tsx`:

```tsx
it('labels the weights in prose and shows each share of the running sum', () => {
  render(<RubricEditor initialBody="body" version={3} onSaved={() => {}} initialWeights={{
    coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
  }} />);

  expect(screen.getByLabelText('Core stack')).toHaveValue(35);
  expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
  expect(screen.getByText(/normalised by their sum \(100\)/)).toBeInTheDocument();
});

it('normalises by the actual sum, not by 100', () => {
  // 70/40/30/40/20 is the same rubric as 35/20/15/20/10: only ratios matter.
  render(<RubricEditor initialBody="body" version={3} onSaved={() => {}} initialWeights={{
    coreStack: 70, seniority: 40, domain: 30, logistics: 40, growth: 20,
  }} />);

  expect(screen.getByText(/normalised by their sum \(200\)/)).toBeInTheDocument();
  expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
  expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
});

it('raises an alert for all-zero weights instead of waiting for the server', () => {
  render(<RubricEditor initialBody="body" version={3} onSaved={() => {}} initialWeights={{
    coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0,
  }} />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'All weights are zero — the rubric would score nothing. Set at least one above zero.',
  );
});

it('disables Save with its reason rather than accepting a click that does nothing', async () => {
  // RubricWeightsSchema refuses all-zero weights — dividing by zero would
  // store NaN as a total. The guard must be visible, not silent.
  const save = vi.spyOn(api, 'saveRubric').mockResolvedValue(4);
  render(<RubricEditor initialBody="body" version={3} onSaved={() => {}} initialWeights={{
    coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
  }} />);

  for (const label of ['Core stack', 'Seniority', 'Domain', 'Logistics', 'Growth']) {
    const input = screen.getByLabelText(label);
    await userEvent.clear(input);
    await userEvent.type(input, '0');
  }

  const saveButton = screen.getByRole('button', { name: /^Save/ });
  expect(saveButton).toBeDisabled();
  await userEvent.click(saveButton);
  expect(save).not.toHaveBeenCalled();
});
```

Add `version={3}` to every existing `render(<RubricEditor …>)` in the file, change its save-button queries to `{ name: /^Save/ }`, and change every weight query from the camelCase key (`'growth'`) to its prose label (`'Growth'`).

Two other files carry stale queries this task invalidates:

- `dashboard/tests/SettingsPage.test.tsx`: `screen.getByLabelText('growth')` → `screen.getByLabelText('Growth')`.
- `dashboard/tests/App.test.tsx`: any `{ name: /save rubric/i }` → `within(screen.getByRole('region', { name: 'Rubric & weights' })).getByRole('button', { name: /^Save/ })`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/RubricEditor.test.tsx
```

Expected: FAIL — no label `Core stack`.

- [ ] **Step 3: Rewrite RubricEditor**

Read `git show 96423c2:dashboard/src/components/RubricEditor.tsx` and port it with class conversion. Its `DIMENSIONS` becomes label tuples and `sum` destructures them:

```tsx
const DIMENSIONS: [keyof RubricWeights, string][] = [
  ['coreStack', 'Core stack'],
  ['seniority', 'Seniority'],
  ['domain', 'Domain'],
  ['logistics', 'Logistics'],
  ['growth', 'Growth'],
];
```

```tsx
  const sum = DIMENSIONS.reduce((a, [k]) => a + weights[k], 0);
```

The all-zero guard moves from a locally-disabled button to the section's `disabledReason`, because `SettingsSection` owns `disabled` now and knows only `!dirty || saving`:

```tsx
      disabledReason={allZero ? 'All weights are zero — set at least one above zero to save.' : null}
```

Keep the `if (allZero) return;` line in `onSave` as well. Defence in depth costs one line, and the test above proves the guard rather than merely proving the button is disabled.

Keep verbatim: both value-keyed re-seed effects and their eslint-disable comment, and `step={1}` on the weight inputs so the browser rejects `3.5` in the field rather than letting `RubricWeightsSchema.int()` turn it into a 400.

`RubricEditor`'s props gain `version: number`; `SettingsPage` passes `version={s.version}`.

- [ ] **Step 4: Add the rubric styles**

Append to `dashboard/src/components/settings.module.css`, and delete the old `.weights` / `.weight` / `.pct` rules it replaces:

```css
/* ── Rubric ───────────────────────────────────────────────────────────── */
.rubricGrid { display: flex; gap: 30px; flex-wrap: wrap; }
.rubricBody { flex: 1; min-width: 320px; }
.rubricArea {
  min-height: 210px;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.6;
  font-family: var(--font-body);
}
.rubricWeights { width: 320px; flex: none; }
.rubricWeightsHead { margin: 0 0 11px; font-size: 12px; color: var(--ink-70); }
.rubricWeight { display: flex; align-items: center; gap: 11px; margin-bottom: 9px; }
.rubricWeight > label { width: 82px; flex: none; margin: 0; font-size: 13px; font-weight: 400; color: var(--color-text); }
.rubricWeight > input { width: 56px; min-height: 30px; padding: 3px 7px; font-size: 13px; text-align: right; }
.rubricBar { flex: 1; min-width: 44px; height: 8px; background: var(--ink-10); }
.rubricBar > div { height: 8px; background: var(--color-accent); }
.rubricShare {
  width: 44px;
  flex: none;
  text-align: right;
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 13px;
}
.rubricZero { margin-top: 9px; font-size: 12.5px; color: var(--color-accent-2-800); }
```

- [ ] **Step 5: Run the tests and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/components/RubricEditor.tsx dashboard/src/pages/SettingsPage.tsx dashboard/src/components/settings.module.css dashboard/tests/RubricEditor.test.tsx dashboard/tests/SettingsPage.test.tsx dashboard/tests/App.test.tsx
git commit -m "feat(dashboard): the rubric section with live weight shares"
```

---

### Task 5: The source form

**Files:**
- Modify: `dashboard/src/components/SourceForm.tsx`
- Create: `dashboard/src/components/SourceForm.module.css`
- Modify: `dashboard/tests/SourceForm.test.tsx`
- Modify: `dashboard/tests/SourcesTable.test.tsx` (its `fillRequired` helper only)

**Interfaces:**
- Consumes: `ChipInput`'s `placeholder` (Task 3); the shared control vocabulary (Task 1).
- Produces:

```ts
interface Props {
  initial?: SourceInput;
  formTitle: string;          // 'New source' | 'Editing Acme'
  submitLabel: string;        // 'Add source' | 'Save this source'
  saving: boolean;
  error: string | null;
  onSubmit: (input: SourceInput) => void;
  onCancel?: () => void;
}
```

Field labels lose their `(required)` suffix: `Item`, `Link`, `Description container`.

**Port source:** `git show 96423c2:dashboard/src/components/SourceForm.tsx` — the whole `FIELDS` table, the disclosure, the gated submit and the collision matcher, all reviewed and correct. Convert its classes, and swap its hand-written `ui-monospace,Menlo,monospace` for `var(--font-mono)` via `shared.inputMono`.

**Note what you are replacing.** The `SourceForm` on this branch still carries string class names — `source-form`, `field-help`, `selectors` — that resolve to nothing: `src/styles.css` defines them but no module imports it, so the file never loads. The form renders unstyled today. This task is the first time it has been styled since the CSS Modules migration, which is worth knowing when you compare before and after by eye.

Two details in that version are load-bearing and were each the subject of a review finding:

- **The required asterisk is CSS `::after` content, not a DOM text node**, with `aria-required` on the input. A `<span>*</span>` inside the `<label>` makes the accessible name `"Name *"` and breaks every exact `getByLabelText('Name')`.
- **The collision matcher tests the backend's two full sentences**, not a bare `/\bname\b/`. Confirm them first:

```bash
cd backend && grep -n "already uses" src/settings/sources.controller.ts
```

They are `Another source already uses that name` and `Another source already uses that URL` — note the capital URL. Read them; do not modify anything under `backend/`.

- [ ] **Step 1: Write the failing tests**

Port the test file wholesale: `git show 96423c2:dashboard/tests/SourceForm.test.tsx` is the reviewed version and covers the disclosure, the gated submit's reason line, both collision cases, the unrelated-error case, `aria-required`, and the blank-selector stripping. Add `formTitle="New source"` to renders that lack it, and keep all three blank-selector tests — including the one for a selector the user *clears*, which is the case that actually bit: the backend's `SelectorsSchema` puts `.min(1)` on every value it receives, so `detail: ''` turns a routine re-tune into a 400.

`SourceForm`'s `formTitle` is required, and `SourcesTable` does not pass it until Task 6 — so add it to both existing call sites here, or the branch goes red on `tsc` and the suite between the two tasks. In `dashboard/src/components/SourcesTable.tsx`:

```tsx
                        <SourceForm
                          key={r.id}
                          initial={toInput(r)}
                          formTitle={`Editing ${r.name}`}
                          submitLabel="Save source"
```

```tsx
      <SourceForm
        formTitle="New source"
        submitLabel="Add source"
```

Task 6 rewrites this file wholesale; these two lines are scaffolding to keep every commit green.

In `dashboard/tests/SourcesTable.test.tsx`, update the helper to the new labels:

```tsx
async function fillRequired() {
  await userEvent.type(screen.getByLabelText('Name'), 'Beta');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://beta.com/jobs');
  await userEvent.type(screen.getByLabelText('Item'), 'li.job');
  await userEvent.type(screen.getByLabelText('Link'), 'a');
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SourceForm.test.tsx
```

Expected: FAIL — no label `Item`, no disclosure button.

- [ ] **Step 3: Rewrite SourceForm**

Port from `96423c2` with class conversion into a new `SourceForm.module.css`, using `shared` for `.input`, `.inputMono`, `.button`, `.buttonPrimary`, `.buttonSecondary`, `.buttonBare`, `.field`, `.chips`, `.chip`.

The disclosure line names all six optional selectors, so it hides the inputs and never the fact that the fields exist:

```tsx
const OPTIONAL_LABEL = 'Six optional selectors — title, company, location, '
  + 'employment type, description, description container';
```

and it opens from the start when an existing source already uses one of them — hiding the field that needs repairing behind a line is exactly what the disclosure must not do:

```tsx
  const [optionalOpen, setOptionalOpen] = useState(
    OPTIONAL.some((f) => ((initial?.selectors[f.key as keyof Selectors] ?? '') !== '')),
  );
```

Keep the `detail` help text from `96423c2` in full. It is longer than the mock's one-liner on purpose: left empty, the whole page becomes the description — navigation, footers and any salary widget included — and a board's own salary filter then trips the minimum-salary rule and rejects good postings. That cost real debugging time and is recorded in `CLAUDE.md`.

The 409 alert appends the reassurance every other failure on the page carries: `Nothing was saved and your values are still here — try again.`

- [ ] **Step 4: Write the module**

Create `dashboard/src/components/SourceForm.module.css`:

```css
.form { padding: 18px 20px; background: var(--color-surface); }

.head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.head h4 { margin: 0; font-size: 17px; }
.head p { margin: 0; font-size: 12.5px; max-width: 60ch; text-wrap: pretty; color: var(--ink-62); }

.group {
  margin: 18px 0 10px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-50);
}

.fields { display: flex; flex-wrap: wrap; gap: 18px 22px; }
.field { margin: 0; }
.help {
  margin: 5px 0 0;
  font-size: 11.5px;
  line-height: 1.45;
  max-width: 44ch;
  text-wrap: pretty;
  color: var(--ink-62);
}

/* Generated content, not a text node: a "*" inside the label would make the
   field's accessible name "Name *" and break exact label queries. */
.required > label::after { content: ' *'; color: var(--color-accent-2-700); }

.disclosure {
  margin-top: var(--space-4);
  font-size: 13px;
  color: var(--color-accent-700);
  border-bottom: 1px solid currentColor;
}

.optional { padding-top: 16px; }

.blocklists { display: flex; gap: 30px; flex-wrap: wrap; padding-top: 20px; }
.blocklists > div { flex: 1; min-width: 280px; }
.blocklistsNote {
  margin: 11px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  max-width: 70ch;
  text-wrap: pretty;
  color: var(--ink-62);
}

.error {
  margin-top: 18px;
  padding: 11px 14px;
  font-size: 13.5px;
  line-height: 1.5;
  background: var(--color-accent-2-100);
  color: var(--color-accent-2-800);
}

.actions { display: flex; align-items: center; gap: 12px; margin-top: var(--space-4); flex-wrap: wrap; }
/* Never a disabled button with no explanation. */
.missing { margin: 0; font-size: 12.5px; color: var(--ink-55); }
```

The blocklist chips sit on the panel's surface fill, so they need the paper ground to stay legible — set `background: var(--color-bg)` on them from this module.

- [ ] **Step 5: Run the tests and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/components/SourceForm.tsx dashboard/src/components/SourceForm.module.css dashboard/tests/SourceForm.test.tsx dashboard/tests/SourcesTable.test.tsx
git commit -m "feat(dashboard): required and optional selectors, gated submit, marked collisions"
```

---

### Task 6: The sources table

**Files:**
- Modify: `dashboard/src/components/SourcesTable.tsx`
- Modify: `dashboard/src/components/settings.module.css`
- Modify: `dashboard/src/pages/SettingsPage.tsx`
- Modify: `dashboard/tests/SourcesTable.test.tsx`

**Interfaces:**
- Consumes: `SettingsSection` (Task 1), `SourceForm` with `formTitle` (Task 5).
- Produces: `SourcesTable` gains `version: number`; `SettingsPage` passes `<SourcesTable version={s.version} />`.

**Port source:** `git show 96423c2:dashboard/src/components/SourcesTable.tsx` and `git show 96423c2:dashboard/tests/SourcesTable.test.tsx`.

- [ ] **Step 1: Write the failing tests**

Port the reviewed test file from `96423c2`, which covers the `role="switch"` toggle, the `+ Add a source` row, in-place editing titled with the board, one-expanded-row-at-a-time, and the absent Save button. Two adjustments for this branch:

- `render(<SourcesTable />)` becomes `render(<SourcesTable version={3} />)`.
- The disabled-row assertion asserts against the imported module binding, because CSS Modules hash the name and Vitest's proxy returns the key:

```tsx
expect(cell.closest('tr')).toHaveClass(String(s.rowDisabled));
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SourcesTable.test.tsx
```

Expected: FAIL — no `switch` role, no `+ Add a source` button.

- [ ] **Step 3: Rewrite SourcesTable**

Port from `96423c2` with class conversion. The shape:

- A five-column fixed-layout table: On (56px) | Name (150px) | Listing URL | Edit (66px) | Delete (70px). Eleven fields must not be the resting state.
- The On control is a `role="switch"` button with `aria-checked` and `aria-label={`Enable ${name}`}`, writing immediately — "turn this board off for a week" is the common act and must not require opening anything.
- One `Open` state, `string | 'new' | null`, so two eleven-field forms can never be open at once.
- The `+ Add a source` row at the foot of the table opens the **same** `SourceForm` as any row's Edit — one component, two callers, so add and edit cannot drift apart. Editing is in place because repairing selectors by delete-and-re-add would throw away the board's posting history.
- `SettingsSection` with **no `onSave`**, plus `note="Sources save as you go and do not change the scoring version."`

Keep verbatim: `key={r.id}` on the edit form (it remounts on identity change so the draft is re-seeded from the row actually clicked); close-only-on-success for both add and edit; and reload-only-on-success for toggle and delete.

- [ ] **Step 4: Add the table styles**

Append to `dashboard/src/components/settings.module.css`, replacing the existing `.table` and `.addSource` rules:

```css
/* ── Sources table ────────────────────────────────────────────────────── */
.table { width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed; }
.table th {
  text-align: left;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-62);
  padding: var(--space-2);
  border-bottom: 1px solid var(--color-divider);
}
.table td { padding: var(--space-2); border-bottom: 1px solid var(--ink-05); vertical-align: top; }

.colOn { width: 56px; }
.colName { width: 150px; }
.colEdit { width: 66px; }
.colDelete { width: 70px; }

/* The open row tints so it is obvious which board is being edited. */
.rowEditing { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }

/* The name is the identity that lands on every posting and in the health
   panel, so it is set in the heading serif. */
.sourceName { font-size: 14px; font-family: var(--font-heading); font-weight: 600; }
.sourceUrl {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-62);
}

.linkCyan { font-size: 12.5px; color: var(--color-accent-700); border-bottom: 1px solid currentColor; }
.linkMagenta { font-size: 12.5px; color: var(--color-accent-2-700); }

.formCell { padding: 0 0 22px; border-bottom: 0; }
.addCell { padding-top: 14px; border-bottom: 0; }
.addLine { font-family: var(--font-heading); font-weight: 600; font-size: 14.5px; color: var(--color-accent-700); }

.switch {
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 20px;
  padding: 2px;
  cursor: pointer;
  background: var(--color-neutral-300);
  border: 1px solid var(--color-divider);
  border-radius: 10px;
}
.switch[aria-checked='true'] { background: var(--color-accent); }
.switchKnob { width: 14px; height: 14px; border-radius: 50%; background: var(--color-neutral-100); }
.switch[aria-checked='true'] .switchKnob { margin-left: 16px; background: var(--color-bg); }
```

- [ ] **Step 5: Run the tests and commit**

```bash
cd dashboard && npx vitest run && npx tsc --noEmit
git add dashboard/src/components/SourcesTable.tsx dashboard/src/components/settings.module.css dashboard/src/pages/SettingsPage.tsx dashboard/tests/SourcesTable.test.tsx
git commit -m "feat(dashboard): the sources table with in-place add and edit"
```

---

### Task 7: Retire the legacy stylesheet, then close the documentation

**Files:**
- Delete: `dashboard/src/styles.css`
- Modify: `CLAUDE.md`
- Create: `docs/features/settings-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [ ] **Step 1: Confirm nothing still leans on the legacy sheet**

```bash
cd dashboard && cat src/styles.css
grep -rn "styles.css" src/ index.html
grep -rnoE 'className="[^"{]+"' src/ | sort -u
```

The second command returns nothing today: no module imports `styles.css`, so it has been dead weight since the CSS Modules migration — which is why anything still naming its classes renders unstyled. The third finds surviving string `className`s; after six tasks of conversion there should be none. If one remains, it belongs to a component outside this work's scope: move that rule into that component's own module rather than keeping the file alive.

- [ ] **Step 2: Delete it and confirm nothing broke**

```bash
cd dashboard && git rm src/styles.css
npx vitest run && npx tsc --noEmit && npm run build
```

Expected: all green. There is no import to remove — `main.tsx` loads `styles/tokens.css` only. Record the real test count; the feature doc states it.

A CSS deletion is invisible to jsdom, so also confirm by eye: `npm run dev`, open `/settings`, and check the page is styled rather than a stack of unstyled controls.

- [ ] **Step 3: Amend CLAUDE.md**

In the `dashboard/` section, the sentence claiming all four Settings sections have their own dirty-tracked Save button is now false. Replace that clause with:

```markdown
The Settings tab has four sections (CV, profile, sources, rubric). CV, profile
and rubric each have their own dirty-tracked Save button and their own error
state, matching the three separate document `PUT`s — that is what makes "one
version bump per save" fall out of the design instead of needing diff logic.
**Sources is the exception**: each row write (`POST`, `PUT`, `PATCH`, `DELETE`)
is its own immediate request and none of them bumps `app_settings.version`, so
the section renders the same header with no dirty chip and no Save button. A
Save button there would imply a batch write that does not exist.
```

Add, in the same section, a paragraph recording the styling substrate:

```markdown
Styling is CSS Modules over one global token file. `src/styles/tokens.css` is
the only place that may define `:root` custom properties or style bare element
selectors; every component carries a sibling `Foo.module.css`.
`components/settings.module.css` is the Settings surface's shared vocabulary —
`field`, `actions`, `state`, the control styles — while `SettingsSection` and
`SourceForm` take their own modules, because folding their layout into the
shared file would recreate the global stylesheet under a new name. The legacy
`src/styles.css` is gone. Two values in the port are measured rather than
chosen and must not be "tidied": the placeholder colour at 65% ink with
`opacity: 1` (the browser default misses 4.5:1 on the surface fill, and
Firefox fades placeholders further), and the button font-size at 14px to match
the input beside it. Each settings section renders as `role="region"` named by
its heading — with four buttons reading "Save" on one page, the region is what
disambiguates them, for a screen reader and for the tests alike. Under Vitest,
CSS Modules resolve through a proxy returning the key, so assertions compare
against the imported binding, never an authored class string.
```

- [ ] **Step 4: Write the feature doc**

Create `docs/features/settings-design.md`, following the register of `docs/features/custom-sources.md`: the problem (an undesigned write surface where a source is eleven fields of devtools output); the section state machine and why Sources is exempt; the four-required/six-optional disclosure and why the line names all six; the gated submit and the 409 field marking; the two conflicts resolved against the mock (employment types kept as free strings with toggles *and* an add input, timezone kept as free text) and the one deviation kept from the old copy (the longer `detail` warning); the styling substrate and why `SettingsSection` and `SourceForm` earn their own modules; the files touched; and how to verify — the commands from Step 2 plus the manual walkthrough from the spec's Verification section, phrased as instructions for a human, not as something already performed.

Link the spec at `docs/superpowers/specs/2026-08-26-settings-design.md` and carry over its four open questions as future work.

- [ ] **Step 5: Commit**

```bash
git add -A dashboard/src CLAUDE.md docs/features/settings-design.md
git commit -m "docs: record the settings page design and retire the legacy stylesheet"
```

---

## Self-review notes

- **Spec coverage:** styling substrate → Tasks 1 and 7; section state machine → Task 1; CV → Task 2; Profile and the one-way door → Task 3; Rubric → Task 4; source form → Task 5; sources table → Task 6; accessibility contract → asserted across Tasks 1, 3, 5, 6; `styles.css` deletion → Task 7; docs → Task 7. The shell needs no task: `Masthead` and `SetupBanner` are already on `develop`.
- **No expected-red window.** Unlike the previous run, each task leaves the suite green: `SettingsPage.test.tsx`'s per-section queries are updated by the task that converts that section, and Task 4 picks up the two stale queries in `App.test.tsx` and `SettingsPage.test.tsx` that its label rename invalidates.
- **Naming consistency:** `SectionState` is `dirty`/`saving`/`saved`/`error` everywhere; `SettingsSection` takes `id`/`title`/`blurb`/`version`/`state`/`onSave`/`note`/`disabledReason`; `SourceForm` takes `formTitle` in both callers; every section component takes `version`.
- **Port provenance:** every task that ports names the exact commit, `96423c2`, and the exact path. That branch is pushed, so the source survives independently of any local state.
