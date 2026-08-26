# Settings Page Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard the Broadsheet design system, the designed shell, and the fully redesigned Settings page, without changing a line of backend code.

**Architecture:** The design system lands as plain global CSS in `dashboard/src/styles.css` plus self-hosted webfonts under `dashboard/public/fonts/`. A new presentational `SettingsSection` component owns the four-state save machine (clean / dirty / saving / saved / error) in one place; the four existing section components keep their own `useSave` state and render their fields inside it. Sources is the documented exception — same header, no chip, no Save button, because its writes are immediate.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library + jsdom. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-settings-design.md`

## Global Constraints

- **No backend change.** No endpoint, response shape, Zod schema or migration is touched by any task in this plan.
- **No new dependencies.** No CSS framework, no CSS-in-JS, no router, no state library, no icon package. Plain CSS on plain HTML is what the design system is built for.
- **Light schema only.** `color-scheme: light dark` is removed from `styles.css`. Every token is a light-theme value.
- **Colour is never the only carrier of meaning.** Every state that uses cyan or magenta also carries text, an ARIA attribute, or both.
- **Magenta (`--color-accent-2`) appears only where something failed or cannot be undone:** the one-way-door block, an invalid field, the Delete control, the Unsaved chip, error alerts. Nowhere else.
- **Labels are content, not decoration.** Every input sits in a `.field` with a real `<label>`; tests select by label text.
- **No optimistic updates.** Save, then refetch. On failure the section stays dirty and keeps every typed value. A section is never unmounted while a save or reload is in flight.
- **Copy is verbatim.** Where this plan gives a string in quotes, use that string exactly — the wording is the design.
- **Test command:** `cd dashboard && npx vitest run` for everything, `npx vitest run tests/<file>` for one suite.
- **Source design:** `/Users/ykravchenko/www/JobRadar/docs/dashboard design/Settings - design doc.html` in the **main checkout**, not this worktree.

---

### Task 1: Vendor the webfonts and port the design system

**Files:**
- Create: `dashboard/scripts/extract-design-fonts.py`
- Create: `dashboard/public/fonts/*.woff2` (12 files, written by the script)
- Create: `dashboard/src/fonts.css` (written by the script)
- Modify: `dashboard/src/styles.css` (whole file)

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties and component classes every later task uses — `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, `--color-accent-2`, `--color-divider`, the `--color-neutral-*` / `--color-accent-*` / `--color-accent-2-*` 100–900 ramps, `--font-heading`, `--font-heading-weight`, `--font-body`, `--space-1..8`, `--radius-sm|md|lg`, `--shadow-sm|md|lg`; and the classes `.hr`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.field`, `.input`, `.tag`, `.tag-accent`, `.tag-accent-2`, `.tag-neutral`, `.table`.

**Note on testing:** this task has no unit test. It ships CSS and binary font assets; the meaningful checks are that the extraction is reproducible, the build succeeds, and the existing suites still pass. Steps 3, 6 and 7 are that verification. Every later task is test-driven.

- [ ] **Step 1: Write the extraction script**

The design doc is a self-extracting bundle. Two different lines matter: the asset map (>100k chars) holding gzipped base64 assets keyed by UUID, and a JSON-encoded HTML string (~47k chars) whose inline `<style>` is the Broadsheet stylesheet, with `url("<uuid>")` references into that map. The script joins the two and emits real files. It is kept in the repo because it is the provenance record for twelve binary assets nobody can review by eye.

Create `dashboard/scripts/extract-design-fonts.py`:

```python
#!/usr/bin/env python3
"""Extract the Source Serif 4 webfonts and their @font-face rules from the
delivered design doc.

The design doc is a self-extracting bundle. Assets live gzipped and base64'd in
a JSON map on one very long line, keyed by UUID. The Broadsheet stylesheet lives
somewhere else entirely: a JSON-encoded HTML string on a shorter long line, with
url("<uuid>") references into that map.

Run from the dashboard directory:

    python3 scripts/extract-design-fonts.py \
      "/Users/ykravchenko/www/JobRadar/docs/dashboard design/Settings - design doc.html"

Writes public/fonts/*.woff2 and src/fonts.css.
"""
import base64, gzip, json, os, re, sys

SRC = sys.argv[1]
FONT_DIR = 'public/fonts'
OUT_CSS = 'src/fonts.css'

lines = open(SRC, encoding='utf-8').read().split('\n')

assets, page = {}, None
for line in lines:
    s = line.strip()
    if len(s) > 100000:
        assets = json.loads(re.search(r'\{.*\}', s).group(0))
    elif 40000 < len(s) < 100000 and s.startswith('"'):
        page = json.loads(s[:-1] if s.endswith(',') else s)

if not assets or page is None:
    sys.exit('could not find both the asset map and the stylesheet page')

css = re.search(r'<style>(.*?)</style>', page, re.S).group(1)
faces = re.findall(r'@font-face \{.*?\}', css, re.S)
if not faces:
    sys.exit('no @font-face rules found')

os.makedirs(FONT_DIR, exist_ok=True)

# Name each file after the face that references it: the subset comes from the
# CSS comment above the rule, the style and weight from the rule itself.
subsets = re.findall(r'/\* ([a-z-]+) \*/\s*@font-face', css)
out, written = [], {}
for face, subset in zip(faces, subsets):
    uuid = re.search(r'url\("([a-f0-9-]{36})"\)', face).group(1)
    style = re.search(r'font-style: (\w+)', face).group(1)
    weight = re.search(r'font-weight: (\d+)', face).group(1)
    name = f'source-serif-4-{subset}-{weight}{"-italic" if style == "italic" else ""}.woff2'

    if uuid not in written:
        entry = assets[uuid]
        raw = base64.b64decode(entry['data'])
        if entry.get('compressed'):
            raw = gzip.decompress(raw)
        open(os.path.join(FONT_DIR, name), 'wb').write(raw)
        written[uuid] = name
    out.append(face.replace(f'url("{uuid}")', f'url("/fonts/{written[uuid]}")'))

header = ('/* Source Serif 4, extracted from the delivered design doc by\n'
          '   scripts/extract-design-fonts.py. Do not edit by hand.\n'
          '   Self-hosted on purpose: the dashboard must not depend on a font CDN. */\n\n')
open(OUT_CSS, 'w', encoding='utf-8').write(header + '\n\n'.join(out) + '\n')
print(f'{len(written)} woff2 files -> {FONT_DIR}, {len(out)} @font-face rules -> {OUT_CSS}')
```

- [ ] **Step 2: Run the script**

```bash
cd dashboard && python3 scripts/extract-design-fonts.py \
  "/Users/ykravchenko/www/JobRadar/docs/dashboard design/Settings - design doc.html"
```

Expected: `12 woff2 files -> public/fonts, 18 @font-face rules -> src/fonts.css`.

- [ ] **Step 3: Verify the extraction**

```bash
cd dashboard && ls public/fonts | head && head -20 src/fonts.css && file public/fonts/*.woff2 | grep -c Web
```

Expected: twelve `source-serif-4-*.woff2` files; `src/fonts.css` opens with the generated header and `@font-face` rules whose `src:` is `url("/fonts/source-serif-4-latin-400.woff2")` and which keep their `unicode-range`; `file` reports all twelve as Web Open Font Format.

- [ ] **Step 4: Replace styles.css with the ported design system**

Replace the whole of `dashboard/src/styles.css`. Everything print-treatment in the source stylesheet (`.cmyk`, `.halftone`, plate numerals and headlines) is dropped — neither JobRadar page uses any of it — as are `.card` and `.elev-*`, because the design separates sections with whitespace and a hairline, never cards.

```css
@import './fonts.css';

/* ── Broadsheet tokens ──────────────────────────────────────────────────
   Ported from the delivered design system. The 100–900 ramps are generated
   in OKLCH on one shared lightness scale, so the same step of any role
   matches the others in visual value — do not hand-tune single entries. */
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

/* ── base ─────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; background: var(--color-bg); color: var(--color-text);
  font-family: var(--font-body); font-size: 15px; line-height: 1.55; font-weight: 400;
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 var(--space-2);
}
h1 { font-size: 42px; } h2 { font-size: 32px; } h3 { font-size: 25px; }
h4 { font-size: 20px; } h5 { font-size: 16px; }
h6 { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
p { margin: 0 0 var(--space-3); }
a { color: var(--color-accent); text-underline-offset: 3px; }
a:hover { color: var(--color-accent-700); }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
::selection { background: color-mix(in srgb, var(--color-accent) 30%, transparent); }
.text-muted { color: color-mix(in srgb, var(--color-text) 55%, transparent); }

/* ── rules ────────────────────────────────────────────────────────────── */
.hr { height: 1px; border: 0; margin: var(--space-4) 0; background: var(--color-divider); }

/* ── buttons ──────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer; text-decoration: none;
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  /* 14px matches .input's 14px — the two sit side by side. */
  font-size: 14px; line-height: 1.2; color: var(--color-text);
  background: transparent; border: 1px solid transparent;
  padding: var(--space-2) calc(var(--space-3) * 1.2);
  border-radius: var(--radius-md);
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--color-accent); color: var(--color-bg); }
.btn-primary:hover { background: var(--color-accent-600); }
.btn-primary:active { background: var(--color-accent-700); }
.btn-secondary { border-color: var(--color-divider); }
.btn-secondary:hover { background: color-mix(in srgb, var(--color-text) 7%, transparent); }
.btn-secondary:active { background: color-mix(in srgb, var(--color-text) 14%, transparent); }
.btn-ghost { color: var(--color-accent); padding-inline: var(--space-1); }
.btn-ghost:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.btn-ghost:active { background: color-mix(in srgb, var(--color-accent) 18%, transparent); }

/* A button that is only its text: the prototype's .jr-x. Used for chip
   removal, Edit/Delete and the disclosure line, where a button box would be
   noise on an open broadsheet. */
.btn-bare {
  appearance: none; background: none; border: 0; padding: 0; margin: 0;
  font: inherit; color: inherit; cursor: pointer; text-align: left;
}

/* ── forms ────────────────────────────────────────────────────────────── */
.field > label {
  display: block; font-size: 12px; margin-bottom: 5px;
  color: color-mix(in srgb, var(--color-text) 70%, transparent);
}
.input {
  width: 100%; min-height: 36px; padding: 6px 10px; font: inherit;
  font-size: 14px; color: var(--color-text); caret-color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
/* Measured, not eyeballed: the browser default gray misses 4.5:1 on the
   surface fill; 65% ink measures 4.8:1. opacity:1 defeats Firefox's fade. */
.input::placeholder { color: color-mix(in srgb, var(--color-text) 65%, transparent); opacity: 1; }
.input:hover { border-color: color-mix(in srgb, var(--color-text) 45%, transparent); }
.input:focus-visible { border-color: var(--color-accent); outline-offset: 0; }
.input[aria-invalid='true'] { border-color: var(--color-accent-2); }
textarea.input { min-height: 90px; resize: vertical; }
.input-mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }

/* ── tags ─────────────────────────────────────────────────────────────── */
.tag {
  display: inline-flex; align-items: center; font-size: 11px;
  letter-spacing: 0.02em; padding: 3px 10px;
  border-radius: calc(var(--radius-md) * 0.75);
}
.tag-accent { background: var(--color-accent-100); color: var(--color-accent-800); }
.tag-accent-2 { background: var(--color-accent-2-100); color: var(--color-accent-2-800); }
.tag-neutral { background: var(--color-neutral-100); color: var(--color-neutral-800); }

/* ── tables ───────────────────────────────────────────────────────────── */
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th {
  text-align: left; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: color-mix(in srgb, var(--color-text) 60%, transparent);
  padding: var(--space-2); border-bottom: 1px solid var(--color-divider);
}
.table td {
  padding: var(--space-2);
  border-bottom: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent);
}
.table tbody tr:hover { background: color-mix(in srgb, var(--color-text) 4%, transparent); }

/* ── Postings, provisional ─────────────────────────────────────────────
   The Postings page has its own design doc and its own pass to come. These
   re-express what is there today in tokens, so the page keeps working and
   stops clashing with the new palette. */
.total { font-weight: 700; }
.row-STRONG { background: var(--color-accent-100); }
.row-MAYBE { background: color-mix(in srgb, var(--color-text) 4%, transparent); }
.row-near-miss { background: var(--color-accent-2-100); }
.badge { font-size: 11px; padding: 1px 6px; border-radius: var(--radius-sm); border: 1px solid currentColor; }
.filters { display: flex; gap: var(--space-3); align-items: center; margin: var(--space-4) 0; flex-wrap: wrap; }
.health { margin-top: var(--space-8); font-size: 13px; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.health li.error { color: var(--color-accent-2-800); }
.state { padding: var(--space-4) 0; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.stale { margin-left: var(--space-1); cursor: help; }
```

- [ ] **Step 5: Delete the leftover placeholder rules**

The old file's `.tabs`, `.tab`, `.tab-active`, `.settings*`, `.chips`, `.chip`, `.source-form`, `.add-source`, `.weights`, `.weight`, `.pct`, `.banner`, `.field-help`, `.row-disabled` rules are all replaced by later tasks, which add their own. They are already gone if you replaced the whole file in Step 4 — confirm none survive:

```bash
cd dashboard && grep -nE '^\.(tabs|tab|settings|chip|source-form|add-source|weights|weight|pct|banner)' src/styles.css
```

Expected: no output.

- [ ] **Step 6: Verify the build and the existing suites**

```bash
cd dashboard && npm run build && npx vitest run
```

Expected: the build succeeds and every existing suite passes. Nothing in this task touches markup, so a failure here means a typo in the CSS, not a behaviour change.

- [ ] **Step 7: Commit**

```bash
git add dashboard/scripts/extract-design-fonts.py dashboard/public/fonts dashboard/src/fonts.css dashboard/src/styles.css
git commit -m "feat(dashboard): port the Broadsheet design system and vendor its webfonts"
```

---

### Task 2: The SettingsSection state machine

**Files:**
- Create: `dashboard/src/components/SettingsSection.tsx`
- Test: `dashboard/tests/SettingsSection.test.tsx`

**Interfaces:**
- Consumes: the `.tag`, `.tag-accent`, `.tag-accent-2`, `.btn`, `.btn-primary` classes from Task 1.
- Produces:

```ts
export interface SectionState {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

export interface SettingsSectionProps {
  id: string;              // 'cv' — ids the heading, which labels the region
  title: string;
  blurb: string;
  version: number;
  state: SectionState;
  /** Absent means the section has nothing to save: no chip, no button. */
  onSave?: () => void;
  /** Only for a section without onSave: why it has no Save button. */
  note?: string;
  children: ReactNode;
}

export function SettingsSection(props: SettingsSectionProps): JSX.Element;
```

Every section renders as `role="region"` named by its heading, so tests and screen-reader users can address one section among four. Later tasks query with `within(screen.getByRole('region', { name: 'CV' }))` — with four "Save" buttons on the page, the region is what disambiguates them.

- [ ] **Step 1: Write the failing tests**

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
  const save = screen.getByRole('button', { name: 'Saved' });
  expect(save).toBeDisabled();
  expect(screen.queryByText(/Unsaved/)).toBeNull();
});

it('dirty: an Unsaved chip appears and the button reads Save', () => {
  renderSection({ state: { ...CLEAN, dirty: true } });
  expect(screen.getByText('● Unsaved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('saving: the button reads Saving… and is disabled', () => {
  renderSection({ state: { ...CLEAN, dirty: true, saving: true } });
  const save = screen.getByRole('button', { name: 'Saving…' });
  expect(save).toBeDisabled();
  // The dirty chip must not show while the write is in flight — the section is
  // no longer waiting for the user, it is waiting for the server.
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
  // Still dirty: a failed save must leave the section savable again.
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('calls onSave when the button is pressed', async () => {
  const onSave = vi.fn();
  renderSection({ state: { ...CLEAN, dirty: true }, onSave });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledOnce();
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

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SettingsSection.test.tsx
```

Expected: FAIL — `Failed to resolve import "../src/components/SettingsSection"`.

- [ ] **Step 3: Write the component**

Create `dashboard/src/components/SettingsSection.tsx`:

```tsx
import type { ReactNode } from 'react';

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
  children: ReactNode;
}

export function SettingsSection({ id, title, blurb, version, state, onSave, note, children }: Props) {
  const { dirty, saving, saved, error } = state;

  return (
    <section className="settings-section" aria-labelledby={`${id}-title`}>
      <div className="settings-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="settings-section-blurb">{blurb}</p>

        {onSave && dirty && !saving && (
          <span className="tag tag-accent-2">● Unsaved</span>
        )}
        {onSave && saved && !dirty && !saving && (
          <span className="tag tag-accent">✓ Saved · v{version}</span>
        )}
        {onSave && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>

      {note && <p className="settings-section-note">{note}</p>}

      <div className="settings-section-rule" />

      {error && (
        <div role="alert" className="settings-section-error">
          <strong>Save failed.</strong> {error} Nothing was written and your edits
          are still here — try again.
        </div>
      )}

      {children}
    </section>
  );
}
```

- [ ] **Step 4: Add the section styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Settings sections ────────────────────────────────────────────────
   Sections are separated by whitespace and one hairline, never by cards:
   the page stays an open broadsheet. */
.settings { max-width: 900px; }
.settings-version { margin: var(--space-4) 0 0; font-size: 14px; color: color-mix(in srgb, var(--color-text) 65%, transparent); }
.settings-section { padding: var(--space-6) 0 0; }
.settings-section-head { display: flex; align-items: baseline; gap: 13px; flex-wrap: wrap; }
.settings-section-head h2 { font-size: 26px; margin: 0; }
.settings-section-blurb { margin: 0; font-size: 12.5px; flex: 1; min-width: 180px; color: color-mix(in srgb, var(--color-text) 50%, transparent); }
.settings-section-head .btn { margin-left: auto; }
.settings-section-note { margin: 6px 0 0; font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 55%, transparent); }
.settings-section-rule { height: 1px; margin-top: 11px; background: color-mix(in srgb, var(--color-text) 20%, transparent); }
.settings-section-error {
  margin-top: 13px; padding: 11px 14px; font-size: 13.5px; line-height: 1.5;
  background: var(--color-accent-2-100); color: var(--color-accent-2-800);
}
.settings-section-body { padding-top: 17px; }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/SettingsSection.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/SettingsSection.tsx dashboard/tests/SettingsSection.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the settings section state machine"
```

---

### Task 3: The CV section

**Files:**
- Modify: `dashboard/src/components/DocumentEditor.tsx`
- Modify: `dashboard/src/components/SettingsPage.tsx`
- Modify: `dashboard/tests/SettingsPage.test.tsx`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `SettingsSection`, `SectionState` from Task 2.
- Produces: `DocumentEditor` now takes `blurb: string` and `version: number` in addition to its existing props, and renders itself inside a `SettingsSection`. Its save button is the section's, labelled "Save" / "Saving…" / "Saved" — no longer "Save CV". Tests address it through `within(screen.getByRole('region', { name: 'CV' }))`.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/SettingsPage.test.tsx`, inside the existing `describe('SettingsPage CV section')`, and add `within` to the import from `@testing-library/react`:

```tsx
  it('carries the section blurb and a live character and word count', async () => {
    render(<Harness />);
    const cv = within(await screen.findByRole('region', { name: 'CV' }));
    expect(cv.getByText('The text every posting is scored against.')).toBeInTheDocument();
    // 'existing cv' — 11 characters, 2 words.
    expect(cv.getByText('11 characters · 2 words')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^cv$/i), '!');
    expect(cv.getByText('12 characters · 2 words')).toBeInTheDocument();
  });

  it('turns off spellcheck: a CV is not prose the browser should second-guess', async () => {
    render(<Harness />);
    await screen.findByDisplayValue('existing cv');
    expect(screen.getByLabelText(/^cv$/i)).toHaveAttribute('spellcheck', 'false');
  });
```

Then update every existing query in the file that names a per-section save button. There are four kinds of change, all mechanical:

- `screen.getByRole('button', { name: /save cv/i })` becomes
  `within(screen.getByRole('region', { name: 'CV' })).getByRole('button', { name: /^Save/ })`.
- `screen.getByRole('button', { name: /save profile/i })` becomes
  `within(screen.getByRole('region', { name: 'Profile & hard filters' })).getByRole('button', { name: /^Save/ })`.
- The `'keeps an unsaved rubric weight edit…'` test's `screen.getByLabelText('growth')` becomes `screen.getByLabelText('Growth')` — Task 5 gives the weights their designed labels.
- `screen.findByText(/version 3/i)` and `/version 4/i` still pass: the version line keeps the words "version 3".

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SettingsPage.test.tsx
```

Expected: FAIL — no element with role `region` and name `CV`.

- [ ] **Step 3: Rewrite DocumentEditor**

Replace `dashboard/src/components/DocumentEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';

interface Props {
  id: string;
  label: string;
  blurb: string;
  version: number;
  initial: string;
  onSave: (value: string) => Promise<unknown>;
  onSaved: () => void;
}

export function DocumentEditor({ id, label, blurb, version, initial, onSave, onSaved }: Props) {
  const [value, setValue] = useState(initial);
  // Re-seed when a refetch brings a newer server value.
  useEffect(() => { setValue(initial); }, [initial]);

  const save = useSave<string>(onSave);
  const dirty = value !== initial;

  const words = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;

  return (
    <SettingsSection
      id={id} title={label} blurb={blurb} version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => {
        // Only a successful save may trigger a refetch. Reloading on failure
        // would clobber the just-rejected edit the user still needs to fix.
        if (await save.run(value)) onSaved();
      }}
    >
      <div className="settings-section-body">
        <div className="doc-editor-meta">
          <label htmlFor={id}>
            CV — markdown. The single most important input: every score is a
            comparison against this text.
          </label>
          <span className="doc-editor-count">{value.length} characters · {words} words</span>
        </div>
        <textarea
          id={id}
          className="input doc-editor-area"
          value={value}
          spellCheck={false}
          disabled={save.saving}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </SettingsSection>
  );
}
```

The `<label>` is the sentence itself, so the field keeps a real label and its accessible name opens with the section's own word. Update the `getByLabelText(/^cv$/i)` calls in `SettingsPage.test.tsx` to `getByLabelText(/^cv/i)` — prefix, not exact — so they still find it.

- [ ] **Step 4: Point SettingsPage at the new props**

In `dashboard/src/components/SettingsPage.tsx`, replace the `DocumentEditor` element:

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

and replace the version line with the design's full sentence:

```tsx
      <p className="settings-version">
        Scoring settings version {s.version} — changes apply on the next run.
        Saving does not rescore what is already here; those rows are marked
        stale instead.
      </p>
```

- [ ] **Step 5: Add the CV styles**

Append to `dashboard/src/styles.css`:

```css
/* ── CV ───────────────────────────────────────────────────────────────── */
.doc-editor-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 7px; }
.doc-editor-meta label { font-size: 12px; color: color-mix(in srgb, var(--color-text) 70%, transparent); margin: 0; }
.doc-editor-count { font-size: 11.5px; color: color-mix(in srgb, var(--color-text) 50%, transparent); }
.doc-editor-area { min-height: 340px; font-size: 14px; line-height: 1.6; padding: 15px 17px; font-family: var(--font-body); }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/SettingsPage.test.tsx
```

Expected: PASS. The other suites will still fail until their own tasks land — that is expected; run this one file only.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/DocumentEditor.tsx dashboard/src/components/SettingsPage.tsx dashboard/tests/SettingsPage.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the CV section, with its live character and word count"
```

---

### Task 4: The Profile section and the one-way door

**Files:**
- Modify: `dashboard/src/components/ProfileForm.tsx`
- Modify: `dashboard/src/components/ChipInput.tsx`
- Modify: `dashboard/tests/ProfileForm.test.tsx`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `SettingsSection` from Task 2.
- Produces: `ProfileForm` keeps its `{ initial, onSaved }` props and its `ProfileInput` shape unchanged. `ChipInput` keeps its full existing prop list and behaviour — only its markup classes change.

**The employment-types conflict:** the mock renders four fixed toggle buttons. `ProfileSchema` types `allowedEmploymentTypes` as free strings, so a fixed set would silently drop a custom value on save. Render the four known values as toggles **and** any value outside that set as a removable chip, keeping an add input for new ones.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/ProfileForm.test.tsx`:

```tsx
it('toggles a known employment type on and off with aria-pressed', async () => {
  const initial = { ...BASE, allowedEmploymentTypes: ['full-time'] };
  render(<ProfileForm initial={initial} onSaved={() => {}} />);

  const fullTime = screen.getByRole('button', { name: 'full-time' });
  expect(fullTime).toHaveAttribute('aria-pressed', 'true');
  const contract = screen.getByRole('button', { name: 'contract' });
  expect(contract).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(contract);
  expect(screen.getByRole('button', { name: 'contract' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'full-time' }));
  expect(screen.getByRole('button', { name: 'full-time' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps an employment type that is not one of the four known values', async () => {
  // ProfileSchema types these as free strings. A fixed set of toggles would
  // drop a custom value on the next save without saying so.
  const onSaved = vi.fn();
  const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
  const initial = { ...BASE, allowedEmploymentTypes: ['full-time', 'b2b'] };
  render(<ProfileForm initial={initial} onSaved={onSaved} />);

  expect(screen.getByText('b2b')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'contract' }));
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

  await waitFor(() => expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ allowedEmploymentTypes: ['full-time', 'b2b', 'contract'] }),
  ));
});

it('shows the one-way-door warning about removing a blocked word', () => {
  render(<ProfileForm initial={BASE} onSaved={() => {}} />);
  expect(screen.getByText('ONE-WAY DOOR')).toBeInTheDocument();
  expect(screen.getByText(/Removing a blocked word does not bring back the postings it already rejected/))
    .toBeInTheDocument();
});

it('offers no salary floor by default and sends null for a blank field', async () => {
  const save = vi.spyOn(api, 'saveProfile').mockResolvedValue(4);
  render(<ProfileForm initial={{ ...BASE, minSalaryUsd: 70000 }} onSaved={() => {}} />);

  const salary = screen.getByLabelText(/minimum salary/i);
  expect(salary).toHaveAttribute('placeholder', 'No minimum');
  await userEvent.clear(salary);
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }));

  // Blank means no floor, which is null — not 0, which ProfileSchema rejects.
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ minSalaryUsd: null })));
});
```

If `tests/ProfileForm.test.tsx` has no `BASE` fixture or no `api` import, add them at the top:

```tsx
import * as api from '../src/api/settings';

const BASE = {
  excludedLocations: [], allowedEmploymentTypes: [], minSalaryUsd: null,
  timezone: 'Europe/Kyiv', blockedTitleWords: [], blockedDescriptionWords: [],
};
```

and rename whatever fixture the file already uses to match, rather than keeping two.

Update the file's existing save-button queries from `{ name: /save profile/i }` to `{ name: /^Save/ }`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/ProfileForm.test.tsx
```

Expected: FAIL — no button named `contract`, no text `ONE-WAY DOOR`.

- [ ] **Step 3: Rewrite ProfileForm**

Replace the render body of `dashboard/src/components/ProfileForm.tsx` (keep the existing imports, the value-keyed re-seed effect, `useSave`, `dirty` and `set` exactly as they are — they encode fixes that must not regress):

```tsx
const KNOWN_EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'internship'];
```

```tsx
  const custom = draft.allowedEmploymentTypes.filter((t) => !KNOWN_EMPLOYMENT_TYPES.includes(t));

  function toggleEmployment(type: string) {
    set('allowedEmploymentTypes', draft.allowedEmploymentTypes.includes(type)
      ? draft.allowedEmploymentTypes.filter((t) => t !== type)
      : [...draft.allowedEmploymentTypes, type]);
  }

  return (
    <SettingsSection
      id="profile" title="Profile & hard filters"
      blurb="Postings failing these never reach the model."
      version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => { if (await save.run(draft)) onSaved(); }}
    >
      <div className="settings-section-body profile-grid">
        <div className="profile-col">
          <ChipInput
            id="excluded-locations" label="Excluded locations"
            help="A posting matching any of these is dropped before scoring."
            value={draft.excludedLocations}
            onChange={(v) => set('excludedLocations', v)}
            disabled={save.saving}
            placeholder="Add a location, then Enter"
          />

          <div className="field">
            <label htmlFor="employment-types">Allowed employment types</label>
            <div className="toggles">
              {KNOWN_EMPLOYMENT_TYPES.map((t) => (
                <button
                  key={t} type="button" className="toggle"
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
              <ul className="chips">
                {custom.map((t) => (
                  <li key={t} className="chip">
                    {t}
                    <button type="button" className="btn-bare" aria-label={`Remove ${t}`}
                      disabled={save.saving} onClick={() => toggleEmployment(t)}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="profile-aside">
          <div className="field">
            <label htmlFor="min-salary">Minimum salary, USD — blank means no floor</label>
            <input
              id="min-salary" className="input" type="number" min={1}
              placeholder="No minimum"
              value={draft.minSalaryUsd ?? ''}
              disabled={save.saving}
              // An empty field means "no minimum", which is null — not 0,
              // which ProfileSchema would reject as non-positive.
              onChange={(e) => set('minSalaryUsd', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label htmlFor="timezone">Timezone</label>
            {/* A free string, not a select: ProfileSchema does not enumerate
                these, and a three-option select would lose anything else. */}
            <input id="timezone" className="input" value={draft.timezone}
              disabled={save.saving}
              onChange={(e) => set('timezone', e.target.value)} />
          </div>
        </div>

        <div className="profile-blocklists">
          <div className="profile-col">
            <h5>Blocked words — titles</h5>
            <ChipInput
              id="blocked-title-words" label="Blocked words — titles" hideLabel
              help="Reject a posting outright if its title contains one of these words. Checked before the job page is downloaded, so it also saves a request. Whole words only, case-insensitive — php will not match phpstorm."
              value={draft.blockedTitleWords}
              onChange={(v) => set('blockedTitleWords', v)}
              disabled={save.saving}
              placeholder="Add a word, then Enter"
            />
          </div>
          <div className="profile-col">
            <h5>Blocked words — descriptions</h5>
            <ChipInput
              id="blocked-description-words" label="Blocked words — descriptions" hideLabel
              help="Checked after the job page is downloaded. Use it for deal-breakers in the body text, like “relocation required”. Whole words and phrases, case-insensitive."
              value={draft.blockedDescriptionWords}
              onChange={(v) => set('blockedDescriptionWords', v)}
              disabled={save.saving}
              placeholder="Add a word or phrase, then Enter"
            />
          </div>
        </div>

        <div className="one-way-door">
          <div className="one-way-door-label">ONE-WAY DOOR</div>
          <p>
            Removing a blocked word does not bring back the postings it already
            rejected. Those were rejected at fetch time and will not be seen
            again unless the board re-lists them. Add words narrowly.
          </p>
        </div>
      </div>
    </SettingsSection>
  );
```

`ProfileForm` needs `version` in its props to feed the chip:

```tsx
interface Props {
  initial: ProfileInput;
  version: number;
  onSaved: () => void;
}
```

and `SettingsPage.tsx` passes it: `<ProfileForm initial={s.profile} version={s.version} onSaved={settings.reload} />`.

- [ ] **Step 4: Give ChipInput its designed markup**

In `dashboard/src/components/ChipInput.tsx`: add `placeholder?: string` and `hideLabel?: boolean` to `Props`; render the label with `className={hideLabel ? 'visually-hidden' : undefined}` (the heading above it is the visible label, but the input must keep a programmatic one); give the `×` buttons `className="btn-bare"`; give the text input `className="input chip-input"` and `placeholder={placeholder ?? 'Type and press Enter'}`. Leave `commit`, the duplicate hint and the suggestions datalist exactly as they are — the mock silently drops a duplicate, which is worse than what is already here.

- [ ] **Step 5: Add the profile styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Profile ──────────────────────────────────────────────────────────── */
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px;
  padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.profile-grid { display: flex; gap: 34px; flex-wrap: wrap; }
.profile-col { flex: 1; min-width: 290px; }
.profile-aside { width: 250px; flex: none; }
.profile-blocklists { width: 100%; display: flex; gap: 34px; flex-wrap: wrap; padding-top: 22px; }
.profile-blocklists h5 { margin-bottom: 5px; }

.chips { display: flex; flex-wrap: wrap; gap: 7px; list-style: none; padding: 0; margin: 0 0 7px; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; font-size: 13px;
  padding: 4px 9px; background: var(--color-surface); border-radius: var(--radius-sm);
}
.chip button { color: color-mix(in srgb, var(--color-text) 50%, transparent); font-size: 14px; line-height: 1; }
.chip-input { width: 220px; min-height: 32px; font-size: 13px; }

.toggles { display: flex; flex-wrap: wrap; gap: 7px; }
.toggle {
  font-size: 13px; padding: 5px 11px; cursor: pointer; background: transparent;
  color: color-mix(in srgb, var(--color-text) 70%, transparent);
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
.toggle[aria-pressed='true'] {
  background: var(--color-accent-100); color: var(--color-accent-800);
  border-color: var(--color-accent-300);
}

/* The only warning of its kind in the product, and it gets weight to match.
   Magenta appears exactly twice in JobRadar — here and on a near-miss row. */
.one-way-door {
  width: 100%; margin-top: var(--space-4); display: flex; gap: 16px;
  align-items: flex-start; padding: 14px 17px;
  background: var(--color-accent-2-100); border-left: 4px solid var(--color-accent-2);
}
.one-way-door-label {
  flex: none; padding-top: 2px; font-family: var(--font-heading);
  font-weight: var(--font-heading-weight); font-size: 12px; letter-spacing: 0.14em;
  color: var(--color-accent-2-800);
}
.one-way-door p { margin: 0; font-size: 14px; line-height: 1.55; max-width: 66ch; text-wrap: pretty; color: var(--color-accent-2-900); }
.field-help { margin: 0 0 9px; font-size: 12.5px; line-height: 1.5; max-width: 52ch; text-wrap: pretty; color: color-mix(in srgb, var(--color-text) 65%, transparent); }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/ProfileForm.test.tsx tests/ChipInput.test.tsx tests/SettingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/ProfileForm.tsx dashboard/src/components/ChipInput.tsx dashboard/src/components/SettingsPage.tsx dashboard/tests/ProfileForm.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the profile section and its one-way-door warning"
```

---

### Task 5: The Rubric section

**Files:**
- Modify: `dashboard/src/components/RubricEditor.tsx`
- Modify: `dashboard/src/components/SettingsPage.tsx`
- Modify: `dashboard/tests/RubricEditor.test.tsx`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `SettingsSection` from Task 2.
- Produces: `RubricEditor` takes `version: number` alongside its existing `initialBody`, `initialWeights`, `onSaved`. Weight inputs are labelled "Core stack", "Seniority", "Domain", "Logistics", "Growth" — capitalised prose, not the camelCase keys. Task 3 already updated the one cross-section test that queried `'growth'`.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/RubricEditor.test.tsx`, and change every existing `getByLabelText('growth')`-style query to its capitalised label and every `{ name: /save rubric/i }` to `{ name: /^Save/ }`:

```tsx
it('labels the weights in prose and shows each share of the running sum', () => {
  render(<RubricEditor initialBody="body" initialWeights={{
    coreStack: 35, seniority: 20, domain: 15, logistics: 20, growth: 10,
  }} version={3} onSaved={() => {}} />);

  expect(screen.getByLabelText('Core stack')).toHaveValue(35);
  expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
  expect(screen.getByText(/normalised by their sum \(100\)/)).toBeInTheDocument();
});

it('normalises by the actual sum, not by 100', () => {
  // 70/40/30/40/20 is the same rubric as 35/20/15/20/10: only ratios matter.
  render(<RubricEditor initialBody="body" initialWeights={{
    coreStack: 70, seniority: 40, domain: 30, logistics: 40, growth: 20,
  }} version={3} onSaved={() => {}} />);

  expect(screen.getByText(/normalised by their sum \(200\)/)).toBeInTheDocument();
  expect(screen.getByTestId('pct-coreStack')).toHaveTextContent('35%');
  expect(screen.getByTestId('pct-growth')).toHaveTextContent('10%');
});

it('raises an alert for all-zero weights instead of waiting for the server', async () => {
  render(<RubricEditor initialBody="body" initialWeights={{
    coreStack: 0, seniority: 0, domain: 0, logistics: 0, growth: 0,
  }} version={3} onSaved={() => {}} />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'All weights are zero — the rubric would score nothing. Set at least one above zero.',
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/RubricEditor.test.tsx
```

Expected: FAIL — no label `Core stack`; the all-zero message is currently a plain `<p className="state">` with no `role="alert"`.

- [ ] **Step 3: Rewrite RubricEditor's render**

Keep the imports, both value-keyed re-seed effects, `useSave`, `sum`, `allZero` and `dirty` exactly as they are. Replace `DIMENSIONS` and the returned markup:

```tsx
const DIMENSIONS: [keyof RubricWeights, string][] = [
  ['coreStack', 'Core stack'],
  ['seniority', 'Seniority'],
  ['domain', 'Domain'],
  ['logistics', 'Logistics'],
  ['growth', 'Growth'],
];
```

The existing `sum` reduce iterates `DIMENSIONS`, so update it to destructure:

```tsx
  const sum = DIMENSIONS.reduce((a, [k]) => a + weights[k], 0);
```

```tsx
  return (
    <SettingsSection
      id="rubric" title="Rubric & weights" blurb="How the model is told to judge."
      version={version}
      state={{ dirty, saving: save.saving, saved: save.saved, error: save.error }}
      onSave={async () => { if (await save.run({ body, weights })) onSaved(); }}
    >
      <div className="settings-section-body rubric-grid">
        <div className="rubric-body">
          <div className="field">
            <label htmlFor="rubric">Scoring instructions given to the model</label>
            <textarea
              id="rubric" className="input rubric-area"
              value={body} spellCheck={false} disabled={save.saving}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div className="rubric-weights">
          {/* The sum is the denominator, not 100 — so the share beside each
              number is the only honest reading of "35". */}
          <p className="rubric-weights-head">
            Weights — normalised by their sum ({sum}), so only the ratios matter
          </p>
          {DIMENSIONS.map(([key, label]) => {
            const pct = sum === 0 ? 0 : Math.round((weights[key] / sum) * 100);
            return (
              <div className="rubric-weight" key={key}>
                <label htmlFor={`w-${key}`}>{label}</label>
                {/* step={1} so the browser rejects 3.5 in the field rather than
                    letting RubricWeightsSchema.int() turn it into a 400. */}
                <input
                  id={`w-${key}`} className="input" type="number" min={0} max={1000} step={1}
                  value={weights[key]} disabled={save.saving}
                  onChange={(e) => setWeights((w) => ({
                    ...w, [key]: e.target.value === '' ? 0 : Number(e.target.value),
                  }))}
                />
                <div className="rubric-bar"><div style={{ width: `${pct}%` }} /></div>
                <div className="rubric-share" data-testid={`pct-${key}`}>
                  {allZero ? '—' : `${pct}%`}
                </div>
              </div>
            );
          })}
          {allZero && (
            <p role="alert" className="rubric-zero">
              All weights are zero — the rubric would score nothing. Set at least
              one above zero.
            </p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
```

Add `version: number` to `Props`, and in `SettingsPage.tsx`:

```tsx
      <RubricEditor
        initialBody={s.rubricBody}
        initialWeights={s.rubricWeights}
        version={s.version}
        onSaved={settings.reload}
      />
```

The Save button's `disabled` logic moves into `SettingsSection`, which disables on `!dirty || saving`. All-zero no longer blocks the button there, so guard the save itself:

```tsx
      onSave={async () => {
        // RubricWeightsSchema refuses all-zero weights — dividing by zero would
        // store NaN as a total. Stop here rather than spending a round trip.
        if (allZero) return;
        if (await save.run({ body, weights })) onSaved();
      }}
```

- [ ] **Step 4: Add the rubric styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Rubric ───────────────────────────────────────────────────────────── */
.rubric-grid { display: flex; gap: 30px; flex-wrap: wrap; }
.rubric-body { flex: 1; min-width: 320px; }
.rubric-area { min-height: 210px; font-size: 14px; line-height: 1.6; padding: 14px 16px; font-family: var(--font-body); }
.rubric-weights { width: 320px; flex: none; }
.rubric-weights-head { margin: 0 0 11px; font-size: 12px; color: color-mix(in srgb, var(--color-text) 70%, transparent); }
.rubric-weight { display: flex; align-items: center; gap: 11px; margin-bottom: 9px; }
.rubric-weight > label { width: 82px; flex: none; font-size: 13px; margin: 0; color: var(--color-text); }
.rubric-weight > .input { width: 56px; min-height: 30px; padding: 3px 7px; font-size: 13px; text-align: right; }
.rubric-bar { flex: 1; min-width: 44px; height: 8px; background: color-mix(in srgb, var(--color-text) 10%, transparent); }
.rubric-bar > div { height: 8px; background: var(--color-accent); }
.rubric-share { width: 44px; flex: none; text-align: right; font-family: var(--font-heading); font-weight: var(--font-heading-weight); font-size: 13px; }
.rubric-zero { margin-top: 9px; font-size: 12.5px; color: var(--color-accent-2-800); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/RubricEditor.test.tsx tests/SettingsPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/RubricEditor.tsx dashboard/src/components/SettingsPage.tsx dashboard/tests/RubricEditor.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the rubric section with live weight shares"
```

---

### Task 6: The source form — required, optional, gated submit, 409s

**Files:**
- Modify: `dashboard/src/components/SourceForm.tsx`
- Modify: `dashboard/tests/SourceForm.test.tsx`
- Modify: `dashboard/tests/SourcesTable.test.tsx` (its `fillRequired` helper only)
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `ChipInput` (with `placeholder`, from Task 4).
- Produces:

```ts
interface Props {
  initial?: SourceInput;
  /** "New source" or "Editing Acme" — the panel's own heading. */
  formTitle: string;
  submitLabel: string;       // 'Add source' | 'Save this source'
  saving: boolean;
  error: string | null;
  onSubmit: (input: SourceInput) => void;
  onCancel?: () => void;
}
```

Field labels lose their `(required)` suffix — the asterisk and the REQUIRED grouping carry that now. `Item (required)` becomes `Item`, `Link (required)` becomes `Link`, and `Description container (posting page)` becomes `Description container`.

- [ ] **Step 1: Write the failing tests**

Replace the label strings throughout `dashboard/tests/SourceForm.test.tsx` (`'Item (required)'` → `'Item'`, `'Link (required)'` → `'Link'`, `'Description container (posting page)'` → `'Description container'`), add `formTitle="New source"` to every `render`, and append:

```tsx
it('shows the four required fields and hides the six optional ones behind one line', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);

  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Item')).toBeInTheDocument();
  expect(screen.queryByLabelText('Description container')).toBeNull();

  // The disclosure names all six, so it hides the inputs and never the fact
  // that the fields exist.
  const line = screen.getByRole('button', {
    name: 'Six optional selectors — title, company, location, employment type, description, description container',
  });
  expect(line).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(line);
  expect(screen.getByLabelText('Description container')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hide the six optional selectors' }))
    .toHaveAttribute('aria-expanded', 'true');
});

it('opens the optional selectors when an existing source already uses one', () => {
  // Editing a board whose detail selector is set must not hide the field that
  // needs repairing behind a line the user has to guess at.
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByLabelText('Description container')).toHaveValue('div.jd');
});

it('names what is still missing beside the disabled submit', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByText('Still needed: Name, Listing URL, Item, Link')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Name'), 'Acme');
  await userEvent.type(screen.getByLabelText('Listing URL'), 'https://acme.com/careers');
  expect(screen.getByText('Still needed: Item, Link')).toBeInTheDocument();

  await userEvent.type(screen.getByLabelText('Item'), 'li.opening');
  await userEvent.type(screen.getByLabelText('Link'), 'a.t');
  expect(screen.queryByText(/Still needed/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Add source' })).toBeEnabled();
});

it('marks the colliding field when the server reports a duplicate name', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Another source already uses that name" onSubmit={() => {}} />);

  expect(screen.getByRole('alert')).toHaveTextContent('Another source already uses that name');
  // Three carriers, never colour alone: aria-invalid, a magenta border, a sentence.
  expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Listing URL')).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).toHaveValue('Acme');
});

it('marks the URL field when the server reports a duplicate listing URL', () => {
  render(<SourceForm initial={EXISTING} formTitle="Editing Acme" submitLabel="Save this source"
    saving={false} error="Another source already uses that url" onSubmit={() => {}} />);
  expect(screen.getByLabelText('Listing URL')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
});

it('says which page each selector is read against', async () => {
  render(<SourceForm formTitle="New source" submitLabel="Add source" saving={false} error={null} onSubmit={() => {}} />);
  expect(screen.getByText(/Selects each posting block on the listing page/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Six optional selectors/ }));
  expect(screen.getByText(/Read on the posting's own page, not the listing/)).toBeInTheDocument();
});
```

Confirm the backend's 409 wording before relying on it:

```bash
cd backend && grep -n "already uses" src/api/sources.controller.ts
```

If the strings differ from `already uses that name` / `already uses that url`, use the real ones in both the tests and the matcher in Step 3.

In `dashboard/tests/SourcesTable.test.tsx`, update `fillRequired` to the new labels:

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

Replace `dashboard/src/components/SourceForm.tsx`:

```tsx
import { useState } from 'react';
import { ChipInput } from './ChipInput';
import type { Selectors, SourceInput } from '../api/types';

interface Props {
  initial?: SourceInput;
  formTitle: string;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onSubmit: (input: SourceInput) => void;
  onCancel?: () => void;
}

const EMPTY: SourceInput = {
  name: '', url: '', selectors: { item: '', link: '' },
  blockedTitleWords: [], blockedDescriptionWords: [],
};

interface FieldDef {
  key: 'name' | 'url' | keyof Selectors;
  label: string;
  required: boolean;
  mono: boolean;
  width: string;
  placeholder: string;
  /** Two clauses: what it matches, and what happens if it is left blank. */
  help: string;
}

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, mono: false, width: '190px', placeholder: 'Acme',
    help: 'Unique. Becomes the posting’s source label and the name in the health panel.' },
  { key: 'url', label: 'Listing URL', required: true, mono: false, width: '330px', placeholder: 'https://acme.com/careers',
    help: 'Unique. The page that lists the openings — fetched every tick.' },
  { key: 'item', label: 'Item', required: true, mono: true, width: '250px', placeholder: 'li.job-post',
    help: 'Selects each posting block on the listing page. Everything below is read inside one block.' },
  { key: 'link', label: 'Link', required: true, mono: true, width: '250px', placeholder: 'a[href*="/jobs/"]',
    help: 'The anchor inside the block whose href is the posting URL.' },
  { key: 'title', label: 'Title', required: false, mono: true, width: '230px', placeholder: 'h3',
    help: 'Read inside the item block. Absent: the link’s own text is used.' },
  { key: 'company', label: 'Company', required: false, mono: true, width: '230px', placeholder: '.company',
    help: 'Read inside the item block. Absent: the source’s Name is used.' },
  { key: 'location', label: 'Location', required: false, mono: true, width: '230px', placeholder: '.location',
    help: 'Read inside the item block. Absent: the posting shows no location.' },
  { key: 'employmentType', label: 'Employment type', required: false, mono: true, width: '230px', placeholder: '.job-type',
    help: 'Feeds the employment-type hard filter. Absent: that filter cannot reject this source.' },
  { key: 'description', label: 'Description', required: false, mono: true, width: '230px', placeholder: '.job-summary',
    help: 'Read on the listing page, if the blurb is there. Absent: the posting has no snippet until it is hydrated.' },
  // Longer than the design's one-liner on purpose: an empty value feeds the
  // whole page to the salary filter, and a board's own salary widget then
  // rejects good postings. That cost real debugging time.
  { key: 'detail', label: 'Description container', required: false, mono: true, width: '270px', placeholder: 'main .job-body',
    help: 'Read on the posting’s own page, not the listing. Absent: the whole page is used — navigation, footers and any salary widget included, and a board’s own salary filter can then trip the minimum-salary rule and reject good postings.' },
];

const REQUIRED = FIELDS.filter((f) => f.required);
const OPTIONAL = FIELDS.filter((f) => !f.required);

const OPTIONAL_LABEL = 'Six optional selectors — title, company, location, '
  + 'employment type, description, description container';

export function SourceForm({ initial, formTitle, submitLabel, saving, error, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<SourceInput>(initial ?? EMPTY);
  // Open from the start when an existing source already uses one of them:
  // hiding the field that needs repairing behind a line is exactly the case
  // the disclosure must not create.
  const [optionalOpen, setOptionalOpen] = useState(
    OPTIONAL.some((f) => ((initial?.selectors[f.key as keyof Selectors] ?? '') !== '')),
  );

  function valueOf(f: FieldDef): string {
    if (f.key === 'name') return draft.name;
    if (f.key === 'url') return draft.url;
    return draft.selectors[f.key as keyof Selectors] ?? '';
  }

  function setValue(f: FieldDef, value: string) {
    if (f.key === 'name') return setDraft((d) => ({ ...d, name: value }));
    if (f.key === 'url') return setDraft((d) => ({ ...d, url: value }));
    setDraft((d) => ({ ...d, selectors: { ...d.selectors, [f.key]: value } }));
  }

  // The backend distinguishes the two unique constraints by constraint_name and
  // says which one collided; map that sentence back onto the field so the
  // failure is marked where it happened, not only at the top of the form.
  const collided = error === null ? null
    : /\bname\b/i.test(error) ? 'name'
    : /\burl\b/i.test(error) ? 'url'
    : null;

  const missing = REQUIRED.filter((f) => valueOf(f).trim() === '').map((f) => f.label);

  function submit() {
    // A blank optional selector must be absent, not '': the backend's
    // SelectorsSchema requires min(1) on every value it receives.
    const selectors = Object.fromEntries(
      Object.entries(draft.selectors).filter(([, v]) => (v ?? '').trim() !== ''),
    ) as Selectors;
    onSubmit({ ...draft, name: draft.name.trim(), url: draft.url.trim(), selectors });
  }

  function renderField(f: FieldDef) {
    const invalid = collided === f.key;
    return (
      <div className="field source-field" key={f.key} style={{ width: f.width }}>
        <label htmlFor={`src-${f.key}`}>
          {f.label}{f.required && <span className="required-mark"> *</span>}
        </label>
        <input
          id={`src-${f.key}`}
          className={f.mono ? 'input input-mono' : 'input'}
          value={valueOf(f)}
          placeholder={f.placeholder}
          aria-invalid={invalid || undefined}
          disabled={saving}
          onChange={(e) => setValue(f, e.target.value)}
        />
        <p className="source-field-help">{f.help}</p>
      </div>
    );
  }

  return (
    <div className="source-form">
      <div className="source-form-head">
        <h4>{formTitle}</h4>
        <p>
          Every field below except Name and Listing URL is a CSS selector, read
          against the page it names. Copy them from devtools.
        </p>
      </div>

      <h6 className="source-form-group">Required</h6>
      <div className="source-fields">{REQUIRED.map(renderField)}</div>

      <button
        type="button" className="btn-bare source-disclosure"
        aria-expanded={optionalOpen}
        onClick={() => setOptionalOpen((o) => !o)}
      >
        {optionalOpen ? 'Hide the six optional selectors' : OPTIONAL_LABEL}
      </button>

      {optionalOpen && (
        <div className="source-optional">
          <h6 className="source-form-group">Optional — each has a sensible fallback</h6>
          <div className="source-fields">{OPTIONAL.map(renderField)}</div>

          <div className="source-blocklists">
            <ChipInput
              id="source-title-words" label="Blocked words — titles, for this source only"
              value={draft.blockedTitleWords} disabled={saving}
              placeholder="Add, then Enter"
              onChange={(v) => setDraft((d) => ({ ...d, blockedTitleWords: v }))}
            />
            <ChipInput
              id="source-desc-words" label="Blocked words — descriptions, for this source only"
              value={draft.blockedDescriptionWords} disabled={saving}
              placeholder="Add, then Enter"
              onChange={(v) => setDraft((d) => ({ ...d, blockedDescriptionWords: v }))}
            />
          </div>
          <p className="source-blocklists-note">
            These are added to the global blocklists in Profile for this source —
            they never subtract from them.
          </p>
        </div>
      )}

      {error && <div role="alert" className="source-form-error">{error}</div>}

      <div className="source-form-actions">
        <button type="button" className="btn btn-primary" disabled={missing.length > 0 || saving} onClick={submit}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        )}
        {/* Never a disabled button with no explanation. */}
        {missing.length > 0 && (
          <p className="source-form-missing">Still needed: {missing.join(', ')}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the source form styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Source form ──────────────────────────────────────────────────────── */
.source-form { padding: 18px 20px; background: var(--color-surface); }
.source-form-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.source-form-head h4 { margin: 0; font-size: 17px; }
.source-form-head p { margin: 0; font-size: 12.5px; max-width: 60ch; text-wrap: pretty; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.source-form-group { margin: 18px 0 10px; font-size: 10px; letter-spacing: 0.1em; color: color-mix(in srgb, var(--color-text) 50%, transparent); }
.source-fields { display: flex; flex-wrap: wrap; gap: 18px 22px; }
.source-field { margin: 0; }
.source-field-help { margin: 5px 0 0; font-size: 11.5px; line-height: 1.45; max-width: 44ch; text-wrap: pretty; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.required-mark { color: var(--color-accent-2-700); }
.source-disclosure { margin-top: var(--space-4); font-size: 13px; color: var(--color-accent); border-bottom: 1px solid currentColor; }
.source-optional { padding-top: 16px; }
.source-blocklists { display: flex; gap: 30px; flex-wrap: wrap; padding-top: 20px; }
.source-blocklists > .field { flex: 1; min-width: 280px; }
.source-blocklists .chip, .source-blocklists .chip-input { background: var(--color-bg); }
.source-blocklists-note { margin: 11px 0 0; font-size: 11.5px; line-height: 1.5; max-width: 70ch; text-wrap: pretty; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.source-form-error { margin-top: 18px; padding: 11px 14px; font-size: 13.5px; line-height: 1.5; background: var(--color-accent-2-100); color: var(--color-accent-2-800); }
.source-form-actions { display: flex; align-items: center; gap: 12px; margin-top: var(--space-4); flex-wrap: wrap; }
.source-form-missing { margin: 0; font-size: 12.5px; color: color-mix(in srgb, var(--color-text) 55%, transparent); }
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd dashboard && npx vitest run tests/SourceForm.test.tsx
```

Expected: PASS. `tests/SourcesTable.test.tsx` still fails — it does not yet pass `formTitle`, which Task 7 fixes.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/SourceForm.tsx dashboard/tests/SourceForm.test.tsx dashboard/tests/SourcesTable.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): required and optional selectors, gated submit, marked collisions"
```

---

### Task 7: The sources table

**Files:**
- Modify: `dashboard/src/components/SourcesTable.tsx`
- Modify: `dashboard/tests/SourcesTable.test.tsx`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: `SettingsSection` (Task 2), `SourceForm` with its `formTitle` prop (Task 6).
- Produces: `SourcesTable` takes `version: number` for the section header. `SettingsPage` passes `<SourcesTable version={s.version} />`.

- [ ] **Step 1: Write the failing tests**

In `dashboard/tests/SourcesTable.test.tsx`, change every `render(<SourcesTable />)` to `render(<SourcesTable version={3} />)`, change the toggle query from `findByLabelText('Enable Acme')` to `findByRole('switch', { name: 'Enable Acme' })`, change `{ name: 'Save source' }` to `{ name: 'Save this source' }`, and wrap the two add-form tests so they open the add row first. Then append:

```tsx
it('toggles a source with a switch, not a checkbox', async () => {
  mockFetch([ROW], () => json({ source: { ...ROW, enabled: false } }));
  render(<SourcesTable version={3} />);
  const toggle = await screen.findByRole('switch', { name: 'Enable Acme' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
});

it('opens the add form from a row in the table, not a second form below it', async () => {
  mockFetch([ROW], () => json({ source: ROW }));
  render(<SourcesTable version={3} />);
  await screen.findByText('Acme');

  // Nothing is open until asked: eleven fields must not be the resting state.
  expect(screen.queryByLabelText('Item')).toBeNull();

  const add = screen.getByRole('button', { name: '+ Add a source' });
  expect(add).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(add);

  expect(screen.getByText('New source')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel new source' })).toBeInTheDocument();
});

it('opens the edit form in place, titled with the board being edited', async () => {
  mockFetch([ROW], () => json({ source: ROW }));
  render(<SourcesTable version={3} />);
  const edit = await screen.findByRole('button', { name: 'Edit' });
  expect(edit).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(edit);
  expect(screen.getByText('Editing Acme')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
});

it('closes the add form when an edit form is opened', async () => {
  // One expanded row at a time: two open eleven-field forms is the wall the
  // design exists to avoid.
  mockFetch([ROW], () => json({ source: ROW }));
  render(<SourcesTable version={3} />);
  await userEvent.click(await screen.findByRole('button', { name: '+ Add a source' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

  expect(screen.queryByText('New source')).toBeNull();
  expect(screen.getByText('Editing Acme')).toBeInTheDocument();
});

it('has no Save button of its own: sources are written as you go', async () => {
  mockFetch([ROW], () => json({}));
  render(<SourcesTable version={3} />);
  await screen.findByText('Acme');

  const region = within(screen.getByRole('region', { name: 'Sources' }));
  expect(region.queryByRole('button', { name: /^Save$/ })).toBeNull();
  expect(region.getByText('Sources save as you go and do not change the scoring version.'))
    .toBeInTheDocument();
});
```

Add `within` to the `@testing-library/react` import.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/SourcesTable.test.tsx
```

Expected: FAIL — no `switch` role, no `+ Add a source` button.

- [ ] **Step 3: Rewrite SourcesTable**

Replace `dashboard/src/components/SourcesTable.tsx`:

```tsx
import { Fragment, useState } from 'react';
import { addSource, deleteSource, fetchSources, toggleSource, updateSource } from '../api/settings';
import { useApi } from '../hooks/useApi';
import { useSave } from '../hooks/useSave';
import { SettingsSection } from './SettingsSection';
import { SourceForm } from './SourceForm';
import type { SourceInput, SourceRow } from '../api/types';

function toInput(r: SourceRow): SourceInput {
  return {
    name: r.name, url: r.url, selectors: r.selectors,
    blockedTitleWords: r.blockedTitleWords,
    blockedDescriptionWords: r.blockedDescriptionWords,
  };
}

interface Props {
  version: number;
}

/** 'new' is the add row; a uuid is the row being edited; null is closed. */
type Open = string | 'new' | null;

export function SourcesTable({ version }: Props) {
  const sources = useApi(() => fetchSources());
  const [open, setOpen] = useState<Open>(null);

  const add = useSave<SourceInput>(addSource);
  const edit = useSave<{ id: string; input: SourceInput }>(({ id, input }) => updateSource(id, input));
  const mutate = useSave<() => Promise<unknown>>((fn) => fn());

  return (
    <SettingsSection
      id="sources" title="Sources" blurb="Boards polled every 30 minutes."
      version={version}
      // Sources has nothing to save: every row write is its own request, and
      // none of them bumps the scoring version.
      note="Sources save as you go and do not change the scoring version."
      state={{ dirty: false, saving: false, saved: false, error: null }}
    >
      <div className="settings-section-body">
        {sources.error && <p className="state" role="alert">Error: {sources.error}</p>}
        {sources.data?.length === 0 && (
          <p className="state">No sources configured — add one below.</p>
        )}

        <table className="table sources-table">
          <thead>
            <tr>
              <th className="col-on">On</th>
              <th className="col-name">Name</th>
              <th>Listing URL</th>
              <th className="col-edit" />
              <th className="col-delete" />
            </tr>
          </thead>
          <tbody>
            {(sources.data ?? []).map((r) => (
              <Fragment key={r.id}>
                <tr className={`${r.enabled ? '' : 'row-disabled'} ${open === r.id ? 'row-editing' : ''}`}>
                  <td>
                    <button
                      type="button" className="switch" role="switch"
                      aria-checked={r.enabled} aria-label={`Enable ${r.name}`}
                      onClick={async () => {
                        if (await mutate.run(() => toggleSource(r.id, !r.enabled))) sources.reload();
                      }}
                    >
                      <span className="switch-knob" />
                    </button>
                  </td>
                  <td className="source-name">{r.name}</td>
                  <td className="source-url">{r.url}</td>
                  <td>
                    <button type="button" className="btn-bare link-cyan"
                      aria-expanded={open === r.id}
                      onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn-bare link-magenta" onClick={async () => {
                      if (await mutate.run(() => deleteSource(r.id))) {
                        setOpen(null);
                        sources.reload();
                      }
                    }}>Delete</button>
                  </td>
                </tr>

                {open === r.id && (
                  <tr>
                    <td colSpan={5} className="source-form-cell">
                      <SourceForm
                        // Remount on identity change so the draft is re-seeded
                        // from the row the user actually clicked.
                        key={r.id}
                        initial={toInput(r)}
                        formTitle={`Editing ${r.name}`}
                        submitLabel="Save this source"
                        saving={edit.saving}
                        error={edit.error}
                        onCancel={() => setOpen(null)}
                        onSubmit={async (input) => {
                          // Close only on success: a rejected save must keep the
                          // form and the user's typing.
                          if (await edit.run({ id: r.id, input })) {
                            setOpen(null);
                            sources.reload();
                          }
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}

            <tr>
              <td colSpan={5} className="add-source-cell">
                <button type="button" className="btn-bare add-source-line"
                  aria-expanded={open === 'new'}
                  onClick={() => setOpen(open === 'new' ? null : 'new')}>
                  {open === 'new' ? 'Cancel new source' : '+ Add a source'}
                </button>
              </td>
            </tr>
            {open === 'new' && (
              <tr>
                <td colSpan={5} className="source-form-cell">
                  {/* The same component as the edit form above, so the two can
                      never drift apart. */}
                  <SourceForm
                    formTitle="New source"
                    submitLabel="Add source"
                    saving={add.saving}
                    error={add.error}
                    onCancel={() => setOpen(null)}
                    onSubmit={async (input) => {
                      if (await add.run(input)) {
                        setOpen(null);
                        sources.reload();
                      }
                    }}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {mutate.error && <p className="state" role="alert">{mutate.error}</p>}
      </div>
    </SettingsSection>
  );
}
```

In `SettingsPage.tsx`, pass the version: `<SourcesTable version={s.version} />`.

- [ ] **Step 4: Add the table styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Sources table ────────────────────────────────────────────────────── */
.sources-table { table-layout: fixed; }
.sources-table .col-on { width: 56px; }
.sources-table .col-name { width: 150px; }
.sources-table .col-edit { width: 66px; }
.sources-table .col-delete { width: 70px; }
.sources-table .row-disabled { opacity: 0.5; }
/* The open row tints so it is obvious which board is being edited. */
.sources-table .row-editing { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }
/* The name is the identity that lands on every posting and in the health
   panel, so it is set in the heading serif. */
.source-name { font-size: 14px; font-family: var(--font-heading); font-weight: var(--font-heading-weight); }
.source-url { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, var(--color-text) 60%, transparent); }
.link-cyan { font-size: 12.5px; color: var(--color-accent); border-bottom: 1px solid currentColor; }
.link-magenta { font-size: 12.5px; color: var(--color-accent-2-700); }
.source-form-cell { padding: 0 0 22px; border-bottom: 0; }
.add-source-cell { padding-top: 14px; border-bottom: 0; }
.add-source-line { font-family: var(--font-heading); font-weight: var(--font-heading-weight); font-size: 14.5px; color: var(--color-accent); }

.switch {
  display: inline-flex; align-items: center; width: 38px; height: 20px; padding: 2px;
  cursor: pointer; background: var(--color-neutral-300);
  border: 1px solid var(--color-divider); border-radius: 10px;
}
.switch[aria-checked='true'] { background: var(--color-accent); }
.switch-knob { width: 14px; height: 14px; border-radius: 50%; background: var(--color-neutral-100); }
.switch[aria-checked='true'] .switch-knob { margin-left: 16px; background: var(--color-bg); }
```

- [ ] **Step 5: Run the whole settings surface**

```bash
cd dashboard && npx vitest run tests/SourcesTable.test.tsx tests/SourceForm.test.tsx tests/SettingsPage.test.tsx tests/ProfileForm.test.tsx tests/RubricEditor.test.tsx tests/SettingsSection.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/SourcesTable.tsx dashboard/src/components/SettingsPage.tsx dashboard/tests/SourcesTable.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the sources table with in-place add and edit"
```

---

### Task 8: The masthead and the shell

**Files:**
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/tests/App.test.tsx`
- Modify: `dashboard/src/styles.css`

**Interfaces:**
- Consumes: the Task 1 tokens and classes.
- Produces: nothing other components import. The meta strip is built from data `App` already fetches — the newest `ranAt` in `/api/health`, the length of the postings list, and `settings.data.version`.

- [ ] **Step 1: Write the failing tests**

Add to `dashboard/tests/App.test.tsx`, inside `describe('App')`:

```tsx
  it('mastheads the product and its promise', async () => {
    stubFetch();
    render(<App />);
    expect(screen.getByText('JobRadar')).toBeInTheDocument();
    expect(screen.getByText('Stop scrolling job boards. Read the shortlist.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Senior Node Engineer')).toBeInTheDocument());
  });

  it('shows the settings version and the last run in the meta strip', async () => {
    stubFetch({ health: [{ source: 'djinni', status: 'ok', ranAt: '2026-08-26T08:30:00.000Z', error: null }] });
    render(<App />);
    expect(await screen.findByText(/Scoring settings v1/)).toBeInTheDocument();
    expect(screen.getByText(/1 posting scored/)).toBeInTheDocument();
  });

  it('reads "never" when nothing has run yet', async () => {
    stubFetch({ health: [], postings: [] });
    render(<App />);
    expect(await screen.findByText(/Last run never/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd dashboard && npx vitest run tests/App.test.tsx
```

Expected: FAIL — no text `Stop scrolling job boards. Read the shortlist.`

- [ ] **Step 3: Rewrite the App shell**

In `dashboard/src/App.tsx`, replace everything from `<h1>JobRadar</h1>` down to the closing `</nav>` with the masthead, and wrap the page in `<div className="page">`. Keep the `settingsError` derivation, the tab state and the two branches below it untouched.

```tsx
  const runs = health.data ?? [];
  // The meta strip is built from what App already has: no new request.
  const lastRun = runs.length === 0 ? 'never'
    : new Date(runs.map((h) => h.ranAt).sort().at(-1)!).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      });
  const scored = (postings.data ?? []).length;

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-row">
          <div className="masthead-brand">JobRadar</div>
          <div className="masthead-tagline">Stop scrolling job boards. Read the shortlist.</div>

          {/* Two screens do not justify a routing dependency. */}
          <nav className="tabs" role="tablist">
            {(['postings', 'settings'] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                className={tab === t ? 'tab tab-active' : 'tab'}
                onClick={() => setTab(t)}
              >
                {t === 'postings' ? 'Postings' : 'Settings'}
              </button>
            ))}
          </nav>
        </div>

        <div className="masthead-rule" />

        <div className="masthead-meta">
          <span>{new Date().toLocaleDateString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}</span>
          <span>Last run {lastRun} · {scored} posting{scored === 1 ? '' : 's'} scored</span>
          <span>Scoring settings v{settings.data?.version ?? '—'}</span>
        </div>
      </header>

      {settingsError && (
        <div className="banner" role="status">
          <div className="banner-label">NOT SCORING</div>
          <p>
            JobRadar is not scoring yet —{' '}
            {settingsError.error ?? 'the last run could not read its settings'}.{' '}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setTab('settings')}>
            Finish setup
          </button>
        </div>
      )}
      …
```

Close the new `<div className="page">` at the end of the component, replacing the current closing fragment.

- [ ] **Step 4: Add the shell styles**

Append to `dashboard/src/styles.css`:

```css
/* ── Masthead ─────────────────────────────────────────────────────────── */
.page { padding: 22px 34px 60px; }
.masthead-row { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
.masthead-brand { font-family: var(--font-heading); font-weight: var(--font-heading-weight); font-size: 22px; letter-spacing: -0.02em; }
.masthead-tagline { font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 50%, transparent); }
.masthead-rule { height: 3px; margin-top: 12px; background: var(--color-text); }
.masthead-meta {
  display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 6px 0; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: color-mix(in srgb, var(--color-text) 60%, transparent);
}
.tabs { margin-left: auto; display: flex; gap: 20px; }
.tab {
  appearance: none; background: none; border: 0; cursor: pointer; font: inherit;
  font-size: 15px; padding: 0 0 5px; color: color-mix(in srgb, var(--color-text) 60%, transparent);
  border-bottom: 2px solid transparent;
}
.tab-active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

/* ── First-run banner ─────────────────────────────────────────────────── */
.banner {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  margin-top: var(--space-4); padding: 14px 17px;
  background: var(--color-accent-2-100); border-left: 4px solid var(--color-accent-2);
}
.banner-label { flex: none; font-family: var(--font-heading); font-weight: var(--font-heading-weight); font-size: 12px; letter-spacing: 0.14em; color: var(--color-accent-2-800); }
.banner p { margin: 0; flex: 1; min-width: 260px; font-size: 14px; line-height: 1.55; color: var(--color-accent-2-900); }

@media (max-width: 820px) {
  .page { padding: 18px 16px 40px; }
  .masthead-tagline { display: none; }
}
```

- [ ] **Step 5: Run the full suite**

```bash
cd dashboard && npx vitest run
```

Expected: every suite passes. This is the first point where the whole dashboard is green again.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/App.tsx dashboard/tests/App.test.tsx dashboard/src/styles.css
git commit -m "feat(dashboard): the masthead, tabs and first-run banner"
```

---

### Task 9: Verify against the running app, then close the documentation

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/features/settings-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [ ] **Step 1: Run the whole dashboard suite and the build**

```bash
cd dashboard && npx vitest run && npm run build
```

Expected: all suites pass; the build succeeds. Record the actual counts — the feature doc states them.

- [ ] **Step 2: Drive the real app**

```bash
cd backend && docker-compose up -d db && docker-compose run --rm migrate && docker-compose up -d api
cd ../dashboard && npm run dev
```

Walk the Settings tab and confirm each item:

- Each of CV, Profile and Rubric shows `● Unsaved` on the first keystroke, `Saving…` while in flight, then `✓ Saved · v{N+1}` — and the version in the masthead increments **once** per save.
- Sources has no Save button and no chip, and its note is visible.
- A failed save (stop the API mid-edit) leaves the section dirty, keeps the typed text, and prints the alert.
- `+ Add a source` opens the form inside the table; adding a source with a name that already exists prints the 409 and marks the Name field.
- The optional selectors are collapsed for a new source and open for a source that already has one set.
- Fonts load from `/fonts/` — check the network panel for zero requests to any font CDN.
- Tab through the page: every control takes a visible cyan focus ring.
- Narrow the window to 800px: the tagline hides, the two-column sections wrap to one, and nothing overflows horizontally.

- [ ] **Step 3: Amend CLAUDE.md**

In the `dashboard/ — two tabs, one of them a write surface` section, the sentence claiming all four sections have their own dirty-tracked Save button is now wrong. Replace that clause with:

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

Add, in the same section, a paragraph recording the design system:

```markdown
The look is the Broadsheet design system, ported from the delivered design doc
into `src/styles.css` as plain global CSS: tokens in `:root`, then component
classes (`.btn`, `.input`, `.field`, `.tag`, `.table`). Source Serif 4 is
self-hosted under `public/fonts/`, extracted by
`scripts/extract-design-fonts.py` — the dashboard must not depend on a font
CDN, and that script is the provenance record for twelve binary files. Two
values in the port are measured rather than chosen and must not be "tidied":
`.input::placeholder` at 65% ink with `opacity: 1` (the browser default misses
4.5:1 on the surface fill, and Firefox fades placeholders further), and `.btn`
at 14px to match `.input`, because the two sit side by side. Each settings
section renders as `role="region"` named by its heading — with four "Save"
buttons on one page, the region is what disambiguates them, for a screen
reader and for the tests alike.
```

- [ ] **Step 4: Write the feature doc**

Create `docs/features/settings-design.md` covering: the problem (an undesigned write surface where a source is eleven fields of devtools output); the design system port and why plain global CSS; the section state machine and why Sources is exempt; the four-required/six-optional disclosure and why the line names all six; the gated submit and the 409 field marking; the two conflicts resolved against the mock (employment types kept as free strings, timezone kept as a text input) and the one deviation kept from the old copy (the longer `detail` warning); the files touched; and how to verify — the commands from Step 1 and the walkthrough from Step 2. Link the spec at `docs/superpowers/specs/2026-08-26-settings-design.md` and record its four open questions as future work.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/features/settings-design.md
git commit -m "docs: record the settings page design and its one deliberate divergence"
```

---

## Self-review notes

- **Spec coverage:** design system → Task 1; shell and banner → Task 8; section state machine → Task 2; Profile and one-way door → Task 4; Sources table → Task 7; source form → Task 6; CV → Task 3; Rubric → Task 5; accessibility contract → asserted across Tasks 2, 4, 6, 7; docs → Task 9. The spec's "ten woff2 subsets" is wrong — the bundle carries twelve files behind eighteen `@font-face` rules; this plan uses the real numbers.
- **Cross-task coupling:** Task 6 renames the source field labels, which `SourcesTable.test.tsx` depends on, so Task 6 updates that helper and Task 7 finishes the file. Task 3 renames the rubric weight labels used by one `SettingsPage` test, so Task 3 updates it and Task 5 lands the labels themselves. Between those points the two suites are red on purpose; only Task 8 Step 5 requires the whole suite green.
- **Naming consistency:** `SectionState` fields are `dirty`/`saving`/`saved`/`error` everywhere; `SettingsSection` takes `id`/`title`/`blurb`/`version`/`state`/`onSave`/`note`; `SourceForm` takes `formTitle` in every caller and test.
