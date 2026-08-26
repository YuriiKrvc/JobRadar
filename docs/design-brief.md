# JobRadar — design brief

Paste this whole document into Claude and ask for a UI design. It describes the
product, the user, the exact data on screen, and the constraints the design has
to respect.

---

## 1. What the product is

**JobRadar is a personal job-hunting radar.** A background worker polls job
boards every 30 minutes, and an LLM scores every new vacancy against *your* CV,
*your* hard constraints, and *your* weighted rubric. Instead of scrolling
hundreds of listings, you open one screen and see a ranked shortlist with a
one-line explanation of *why* each job fits.

It is self-hosted, single-user, and runs on localhost. There are no accounts, no
teams, no sharing. One person, one CV, one shortlist.

Tagline: **"Stop scrolling job boards. Read the shortlist."**

### The loop, one line per step

1. Fetch each enabled source's **listing page** (every tick — this is the
   new-posting detector).
2. Store every posting so "last seen" advances.
3. **Title blocklist** — reject on a blocked word in the title, before any
   further download.
4. **Hydrate (new)** — fetch the posting's own detail page to get the real
   description. Once per posting, ever.
5. **Hard filters** — excluded location, wrong employment type, below minimum
   salary, blocked word in the description.
6. **Classify** — the LLM returns 5 sub-scores with notes.
7. Weighted total → verdict band: **STRONG ≥ 75**, **MAYBE 50–74**, **NO < 50**.
8. Notify (Telegram) above a threshold.

Rejected postings are **recorded with their reason, not deleted** — they stay
visible in the list. That is how the user notices an over-aggressive filter.

---

## 2. Who uses it and what they need

A single technical job-seeker (the developer who installed it). Two distinct
modes, and the design has to serve both without letting one crowd the other:

| Mode | Need | Frequency | Feel |
|---|---|---|---|
| **Triage** | "What's new and worth my time today?" Scan the top, open 2–3 tabs, leave. | Daily, ~2 minutes | Fast, calm, scannable in five seconds |
| **Audit** | "Why did it score that?" Sanity-check the model, spot a bad rubric or a filter eating good jobs. | Weekly | Explanatory |
| **Tune** | Edit the CV, constraints, rubric weights; add or repair a job board. | Setup, then whenever a scraper breaks | A careful workshop — clarity over density |

**This is the main change from the previous version of this brief:** tuning is
no longer a rare, trivial task. A source is now eleven fields including **CSS
selectors the user writes by hand from a page's DOM**, and repairing one when a
board changes its markup is a recurring chore. The Settings tab is now the
hardest design problem in the product, not an afterthought.

---

## 3. Screens

Two tabs, no router. A different structure may be proposed, but it must carry
the same information.

### 3A — Postings (shipped; 90% of usage)

**Filter bar:** Verdict (any / STRONG / MAYBE / NO), Source, Provider (which LLM
scored it), Min score (0–100), Scored since (date). Source and Provider options
are derived from the loaded rows, not from a fixed list.

**The list.** One row per posting, sorted by score descending (click the header
to reverse). Fields available:

- `total` — 0–100 integer, the headline number
- `verdict` — STRONG | MAYBE | NO
- `title` — links out to the original posting (new tab)
- `company`
- `source` — **the user-given board name**, e.g. `Acme`, `Djinni`. *(Changing
  from machine strings like `greenhouse:stripe` as part of the new source
  model.)*
- `location` — may be null
- `reasoning` — one or two natural-language sentences. For filtered postings it
  is instead a machine string: `hard-filter:excluded-location`,
  `hard-filter:title-word:php`,
  `hard-filter:description-word:relocation required`.
- `providerId` — the model that scored it (`anthropic`, a local model id, or
  the literal `hard-filter`)
- `settingsVersion` — the settings version the score was computed under
- `scoredAt` — ISO timestamp

Four row states carry meaning; today they are only weak background tints:

- **STRONG** — the shortlist. This is what the user came for.
- **MAYBE** — worth a glance.
- **near miss** — verdict NO but score 40–49, *just* below the MAYBE cut.
  Surfaced deliberately: it is the signal that the rubric may be mis-weighted.
- **stale** — the posting's `settingsVersion` ≠ the current one, so the score
  predates a CV/rubric change and is not comparable. Currently a ⚠ glyph.

**Source health panel** (bottom): the last 20 pipeline runs — `source — status`,
an optional error string, a timestamp. A broken scraper silently truncates the
shortlist, so this is more important than its current styling suggests.

**First-run / broken-settings banner** (top), shown when the last run could not
score — empty CV, no enabled sources, unreadable settings — with a button that
jumps to Settings. A fresh install shows an empty list, so this banner *is* the
onboarding.

### 3B — Settings (target design)

Four sections. Each has its **own dirty-tracking, own Save button, own error
state** — deliberate, and it must survive any redesign: each maps to a separate
API write, and each save bumps the scoring version exactly once. A save never
rescores existing postings; it marks them stale.

Header line: *"Scoring settings version N — changes apply on the next run."*

#### 1. Profile — hard filters

- Excluded locations — removable chips, typed and committed with Enter
- Allowed employment types — chips
- Minimum salary, USD — nullable number
- Timezone
- **Blocked words — titles (new)** — chips. Help text: *"Reject a posting
  outright if its title contains one of these words. Checked before the job page
  is downloaded, so it also saves a request. Whole words only, case-insensitive
  — `php` will not match `phpstorm`."*
- **Blocked words — descriptions (new)** — chips. Help text: *"Checked after the
  job page is downloaded. Use it for deal-breakers in the body text, like
  `relocation required`. Whole words and phrases, case-insensitive."*
- **An irreversibility warning (new)** on both lists: *removing a word does not
  bring back postings it already rejected.* This needs real visual weight — it
  is a genuine one-way door and the only warning of its kind in the product.

#### 2. Sources — the hard part **(new model)**

Every source is now the same shape: no more `ats` / `djinni` / `dou` kinds, no
vendor dropdown, no branching form.

**Table:** `On | Name | URL | Edit | Delete`. The `On` toggle enables/disables
without opening anything; disabled rows are dimmed. **Edit expands the row into
the full form, in place** — a source's selectors are tuned when a board changes
its markup, and doing that by delete-and-re-add would lose the board's posting
history. Empty state: *"No sources configured — add one below."*

**The form** (used for both add and inline edit) has eleven fields:

| Field | Required | Note |
|---|---|---|
| Name | ✓ | Unique. Becomes the posting's `source` and the health panel's label. |
| Listing URL | ✓ | Unique. The page that lists the openings. |
| Item | ✓ | CSS selector for each posting block on the listing page |
| Link | ✓ | Anchor within the block whose href is the posting URL |
| Title | | Defaults to the link's own text |
| Company | | Defaults to the source's Name |
| Location | | |
| Employment type | | |
| Description | | |
| Description container (posting page) | | Container on the *detail* page; absent = whole page |
| Blocked words — titles | | Chips; **added to** the global list, never subtracted |
| Blocked words — descriptions | | Chips; same |

Submit is disabled until Name, URL, Item and Link are all filled. Errors are
inline and keep the typed values — a duplicate name or URL returns a 409 naming
which one collided.

**The core design challenge:** eight of these are raw CSS selector strings. The
person filling them in has a browser devtools panel open in another window and
is copying selectors across. Six months later they will not remember what
"Item" meant. Every field needs help text explaining *what it selects*, and the
grouping needs to make the required-vs-optional split obvious at a glance
without making the form feel like a wall. Progressive disclosure of the optional
selectors is worth considering.

#### 3. CV

One large markdown textarea. The single most important input in the product and
currently the least designed.

#### 4. Rubric

A markdown body (the scoring instructions sent to the model) plus five integer
weights: **coreStack, seniority, domain, logistics, growth** (defaults
35/20/15/20/10). Weights are normalised by their *actual sum*, not by 100, so
only the ratios matter and the UI shows each one's live percentage share.
All-zero is rejected.

---

## 4. Constraints the design must respect

- **Stack:** React 19
- **Reuse the existing controls.** `ChipInput` already serves the two profile
  lists and now the blocked words too. A second list-of-strings control with
  different interaction rules was explicitly rejected.
- **Accessibility is non-negotiable and already partly done:** tabs use
  `role="tablist"` / `aria-selected`, the sortable header uses `aria-sort`, the
  stale marker is `role="img"` with an `aria-label`, errors use `role="alert"`,
  every field has a real `<label>` (the tests select by label text).
  **Colour may never be the only carrier of meaning** — verdict, near-miss and
  stale each need a non-colour cue too.
- **Lightonly**
- **No optimistic updates.** Save → refetch. On failure the form stays dirty and
  keeps what the user typed. A loading state must never unmount an editor
  mid-edit.
- **Data volume:** tens to low hundreds of rows, capped by a `limit` query
  param. No virtualisation needed; no pagination exists.
- **Desktop-first**, but it must not fall apart on a phone — the user may check
  the shortlist from bed.
- Empty states matter more than usual: a fresh install is genuinely empty, and a
  fresh install now ships **no sources at all**, so the user's very first action
  is the hardest form in the app.

## 5. Deliberately not in the product

No auth (it binds to 127.0.0.1). No multi-user, no saved searches, no
application tracking or kanban, no notes on postings, no editing a posting. No
selector auto-detection or "detect selectors" button — considered and rejected
in favour of explicit, debuggable fields. No pagination of job boards. No
re-score button.

The dashboard **reads** postings and **writes** settings. Don't design features
that need new backend endpoints.

## 6. Known gaps a designer could fix

- The five sub-scores and their per-dimension notes **exist in the database but
  are not exposed on the row** — only the aggregate `total` and one `reasoning`
  string are. A design wanting a score breakdown (radar, stacked bar, five mini
  meters) should say so explicitly: it needs one extra field in the API
  response.
- `VerdictBadge` renders bare text in a generic pill. STRONG / MAYBE / NO
  deserve real hierarchy.
- `hard-filter:title-word:php` leaks a machine string into the "Why" column
  where every other row has a human sentence — and the new blocklists make these
  rows *more* common, not less.
- Source health is an unstyled bulleted list at the bottom of the page; a broken
  scraper is easy to miss, and with hand-written selectors, scrapers now break
  routinely.
- There is no sense of *recency* in the list — `scoredAt` is fetched but never
  displayed, so the #1 job-to-be-done ("what's new today?") cannot actually be
  answered.
- Nothing on the Postings tab links a filtered-out posting back to the setting
  that killed it. A "this was rejected by a rule you can edit" affordance would
  close the tune→triage loop.

---

**Ask:** design a calm, scannable, accessible interface for this. Prioritise the
five-second triage scan on Postings; make Settings — especially an eleven-field
source form full of CSS selectors — feel learnable and safe to edit.
