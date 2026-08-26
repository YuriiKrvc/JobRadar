# JobRadar — design brief

Paste this whole document into Claude and ask for a UI design. It describes the
product, the users, the exact data on screen, and the constraints the design has
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

### The loop, in one sentence per step
1. Poll each enabled source (Greenhouse / Lever / Ashby company boards, Djinni, DOU).
2. Store every posting so "last seen" advances.
3. Drop postings that fail hard filters (excluded location, wrong employment type, below minimum salary) — these are *recorded with a reason*, not silently deleted.
4. Send the rest to the LLM, which returns 5 sub-scores + notes.
5. Weighted total → verdict band: **STRONG ≥ 75**, **MAYBE 50–74**, **NO < 50**.
6. Notify (Telegram) anything above the notify threshold.

---

## 2. Who uses it and what they need

A single technical job-seeker (the developer who installed it), checking in
**once or twice a day, for maybe two minutes**. They are not exploring — they
are triaging.

Three jobs-to-be-done, in priority order:

| Priority | Need | Frequency |
|---|---|---|
| 1 | "What's new and worth my time today?" — scan the top of the list, open 2–3 tabs, move on. | Daily, 90% of visits |
| 2 | "Why did it score this?" — sanity-check the model's judgement, spot a bad rubric. | Weekly |
| 3 | "Tune it" — edit the CV, constraints, rubric weights, add/remove a job board. | Setup, then rarely |

Design implication: the postings view must be **scannable in five seconds**.
Settings is a rarely-visited but high-stakes workshop — clarity over density.

---

## 3. Screens

Currently two pages, no router. The design may propose a different structure, but
should keep the same information.

### Page 1 — Postings (the main screen, 90% of usage)

**Filter bar:** Verdict (any/STRONG/MAYBE/NO), Source (dropdown, values derived
from the data), Provider (which LLM scored it), Min score (0–100), Scored since
(date).

**The list.** One row per posting, sorted by score descending (click to
reverse). Fields available per row:

- `total` — 0–100 integer, the headline number
- `verdict` — STRONG | MAYBE | NO
- `title` — links out to the original posting (opens in a new tab)
- `company`
- `source` — e.g. `greenhouse:stripe`, `djinni`, `dou`
- `location` — may be null
- `reasoning` — a one-to-two sentence natural-language explanation. For
  hard-filtered postings this is the literal string `hard-filter:<rule>`
  (e.g. `hard-filter:excluded-location`).
- `providerId` — which model produced the score (e.g. `anthropic`,
  `hard-filter`, a local model id)
- `settingsVersion` — the settings version the score was computed under
- `scoredAt` — ISO timestamp

Three row states carry meaning and today are only weak background tints:
- **STRONG** — the shortlist. This is what the user came for.
- **MAYBE** — worth a glance.
- **near miss** — verdict NO but score 40–49, i.e. *just* below the MAYBE cut.
  Surfaced deliberately because it is the signal that the rubric may be
  mis-weighted.
- **stale** — the posting's `settingsVersion` ≠ the current one, so this score
  predates a CV/rubric change and is not comparable. Currently a ⚠ glyph with a
  tooltip.

**Source health panel** at the bottom: the last 20 pipeline runs, each `source —
status`, an optional error string, and a timestamp. Errors are the only thing
that tells the user a board's scraper broke and the shortlist is silently
incomplete.

**First-run / broken-settings banner** at the top when the last run could not
score (empty CV, no sources configured, unreadable settings) — with a button
that jumps to Settings. A fresh install shows an empty list, so this banner is
the entire onboarding.

### Page 2 — Settings (a write surface, four independent sections)

Each section has its **own dirty-tracking, own Save button, own error state** —
this is deliberate and must survive any redesign, because each maps to a
separate API write, and each save bumps the scoring version exactly once.

1. **Profile / hard filters** — excluded locations (chip/tag input), allowed
   employment types (chips), minimum salary in USD (nullable number), timezone.
2. **Sources** — a table of job boards: kind (`ats` | `djinni` | `dou`), for ATS
   a board (greenhouse/lever/ashby) + company slug, for the others a URL, plus
   an **enabled** toggle and a created date. Disabled rows are dimmed. Below it,
   an add-source form whose fields change with the selected kind.
3. **CV** — one big markdown textarea. This is the most important input in the
   whole product and currently the least designed.
4. **Rubric** — a markdown body (the scoring instructions given to the model)
   plus five integer weights: **coreStack, seniority, domain, logistics,
   growth** (defaults 35/20/15/20/10). Weights are normalised by their *actual
   sum*, not by 100 — so the UI shows each one's live percentage share, and only
   the ratios matter. All-zero is rejected.

A line at the top reads: *"Scoring settings version N — changes apply on the next
run."* Saving does **not** rescore existing postings; it marks them stale.

---

## 4. Constraints the design must respect

- **Stack:** React 19
- **Accessibility is non-negotiable and already partly done:** tabs use
  `role="tablist"`/`aria-selected`, the sortable header uses `aria-sort`, the
  stale marker is `role="img"` with an `aria-label`, errors use `role="alert"`.
  **Colour may never be the only carrier of meaning** — verdict, near-miss and
  stale all need a non-colour cue too.
- **Light schema only.**
- **No optimistic updates.** Save → refetch. On failure the form stays dirty and
  keeps what the user typed. Loading states must never unmount an editor
  mid-edit.
- **Data volume:** tens to low hundreds of rows, capped by a `limit` query
  param. No virtualisation needed; no pagination exists.
- **Desktop-first**, but it should not fall apart on a phone — the user may
  check the shortlist from bed.
- Empty states matter more than usual: a fresh install is genuinely empty for
  the first 30 minutes.

## 5. What is deliberately *not* in the product

No auth (it binds to 127.0.0.1). No multi-user, no saved searches, no application
tracking or kanban pipeline, no notes on postings, no editing a posting.
The dashboard **reads** postings and **writes** settings — that is the whole
surface. Don't design features that need new backend endpoints.

## 6. Known gaps a designer could fix

- The five sub-scores and their per-dimension notes **exist in the database but
  are not exposed on the row** — only the aggregate `total` and a single
  `reasoning` string are. A design that wants a score breakdown (radar, stacked
  bar, five mini-meters) should say so explicitly, since it needs one extra
  field in the API response.
- `VerdictBadge` currently renders bare text in a generic pill. STRONG / MAYBE /
  NO deserve real visual hierarchy.
- `hard-filter:<rule>` leaks a machine string into the "Why" column where every
  other row has a human sentence.
- Source health is an unstyled bulleted list at the bottom of the page; a broken
  scraper is easy to miss.
- There is no sense of *recency* on the list — `scoredAt` is fetched but never
  displayed, so "what's new today" (job #1) can't actually be answered.

---

**Ask:** design a calm, scannable, accessible interface for this. Prioritise the
five-second triage scan on the Postings tab; make Settings feel safe to edit.
