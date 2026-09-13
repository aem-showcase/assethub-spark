---
name: rebrand-portal
description: >
  Produce a demo copy of the AEM Edge Delivery asset portal for a company,
  rebrand it, enrich company assets, and create scoped collections using the
  existing environment. Use when the user says: "create a demo portal for
  [company]", "rebrand the portal for [company]", "set up a demo for
  [company]", "enrich [company]'s assets", "build collections for [company]".
---

# Customer Migration — Demo

This skill produces a **demo**: a copy of an existing AEM Edge Delivery
site, rebranded for a company and filled with that company's own assets,
delivered as **one open pull request** whose branch-preview URL is the
shareable result. It never touches the shared original and it **reuses the
existing environment end to end** — the existing repo, its Document
Authoring (DA) content, its publish access, and its asset credentials.
Nothing is provisioned. Dedicated portal path: disabled — see `NON-DEMO-DISABLED.md`.

## Invariants

⚠️ **Read `docs/invariants.md` in full before acting.** The rules there
(I1–I9) govern every step and are not repeated below.

## Missing required inputs

Before doing anything, check the user's request for two required inputs:

- **Company name** — needed for every step (`companyKey`, DA folder, branch). Never infer it from a source URL (e.g. don't assume "acme" from `acme.com`).
- **Source site URL** — needed for design matching (Step 4 / excat). Required even when `assetsLane` is `enrich-existing`.

If both are missing: ask for both in one message, after the Step 1 plain-sentence intro (I1 — never open with a question).
If one is missing: ask only for that one.
If both are present in the request: proceed without asking.

## Capture the intent first (`full` / `rebrand` / `look`)

Before running the sequence, decide **how much** the customer asked for.
Every request shares the same mandatory foundation (Steps 1–3 + scope +
publish + open PR); the intent only changes **which of Step 4's change
buckets run and whether assets follow**. Three intents:

- **`full`** (default) — a complete demo: rebrand the look + content, then
  bring in and organize the company's assets. Runs Steps 1–6.
- **`rebrand`** — give the portal the company's look **and** rewrite its
  page copy, but **no assets**. Runs Steps 1–4, then stops.
- **`look`** — a smaller visual change only: recolor the theme, swap the
  logo/icon, or restyle a named block. Page copy is left as-is and there
  are no assets. Runs Steps 1–4 (visual buckets only), then stops.

**Routing — parse the request into an intent:**
- Wording about **color / theme / palette / restyle / look / logo / icon /
  favicon / a named block** → `look`.
- Wording about **rewriting the copy/content/wording for the brand** (with
  or without the visual change) → `rebrand`.
- **"create/build a demo portal", "set up a demo", anything mentioning
  assets/enrich/search, or no narrowing at all** → `full`.

**Two things that are NOT scope signals — never widen on them:**
- **The word "portal."** "Change the **portal's** color" names the artifact
  being restyled, not the size of the job — it's a `look` request.
- **A source URL.** The URL is the **style source** the design tool extracts
  the palette from (Step 4), exactly as a `full` demo uses it — not a signal
  to build the whole thing. "Recolor my portal using `brand.com`" is `look`.

**When genuinely ambiguous** whether the customer wants more than the visual
change, ask **one** plain either/or question — each option a concrete
outcome, no internal terms (I1) — before proceeding, e.g. *"Just give the
portal a fresh look, or also fill it with your assets so people can search
them?"* Never silently guess.

Record the chosen value in state `intent`. For `look`, also record the
slice in `customer.styleScope` (e.g. `["color","icon"]` or
`{"block":"search-results"}`). A partial run (`look`/`rebrand`) runs the
foundation + its Step 4 buckets, **stops after the PR**, and marks the
skipped steps `not-applicable` (see the state file below). It **never** asks
the asset questions (Q1/Q2) — those belong to Step 5, which it doesn't run —
and it ends with a one-line offer to do more, not a gate (see
`docs/partial-runs.md`). A later "now bring in the assets" follow-up resumes
into Steps 5–6 the same way a deferred-assets `full` run does.

> **I1 applies to this whole section.** `intent`, `full`/`rebrand`/`look`,
> `styleScope`, `not-applicable`, "Step N", "Entry flow", "buckets" — these
> are operator/internal terms. **Never surface them to the customer**, in
> prose or any UI you render. Decide the intent silently and speak only in
> outcomes: say "I'll give your portal a fresh look" / "…a new look and
> refreshed wording" / "…the full portal with your assets" — never "this is
> `intent = look`" or "I'll set `styleScope`." The routing vocabulary here
> is for your reasoning, not the customer's ears.

> **Colour/theme/logo are branch-global.** If a `look` request says "change
> the colour of a **few pages**," the theme still applies portal-wide (that
> is how the design system works) — say so plainly and confirm, rather than
> hand-hacking per-page overrides. Genuinely per-page visual differences
> (a page-specific section style) stay scoped to the named
> `/companies/<companyKey>/…` pages, never the shared root.

▶ **Read now, before acting on a `look`/`rebrand` request:**
`.claude/skills/rebrand-portal/docs/partial-runs.md`

## The demo — one sequence (the single source of truth)

Every demo is these steps, in this order. This ordered list **is** the
workflow; the state file's `steps` object mirrors it 1:1. Do not restate,
re-plan, or reorder it — run it and mark each step `done` as you go. A
`rebrand`/`look` run follows the **same** ordered steps for the foundation
(1–3) and Step 4, then stops before Step 5 (see the intent section above and
`docs/partial-runs.md`); it does not reorder or skip anything **within** the
steps it runs.

1. **`demo-confirmed`** — say plainly it's a demo copy (Step 1).
2. **`branch-resolved`** — resolve the company; check for an existing
   branch for it; if one exists, **ask** continue-vs-new; create/checkout
   (Step 2).
3. **`da-content-copied`** — **MANDATORY**: copy the site's existing DA
   content into `/<company>` (Step 3).
4. **`rebranded` → `demo-company-set` → `published` → `landed-via-pr`** —
   rebrand the `/<company>` content + repo design, set the demo scope in
   `cloudflare/src/config.js` (`DEMO_COMPANY` + `DEMO_BASE_PATH` =
   companyKey — this scopes the PR's preview worker: company filter,
   `/<company>` routing, and login base), publish `/<company>`, open one
   PR (Step 4).
5. **`assets-uploaded` → `assets-enriched` → `search-scoped`** — upload
   (if the assets aren't already in the company's folder) and, unless the
   customer chose to defer it (Entry flow Q2), enrich the company's assets
   so they're searchable, scoped to the company (Step 5).
6. **`collections-created`** — once the company's assets are searchable,
   group them into ready-made collections (one per category), each scoped
   to the company so it shows/hides with the demo company filter (Step 6).
   Runs whenever enrichment actually completes — immediately for an
   enrich-now demo, or on the later follow-up request if enrichment was
   deferred.

> **⛔ The one hard gate.** You may NOT invoke the design tool
> (`excat-complete-design-expert`) or edit any styling file until both
> **`branch-resolved`** and **`da-content-copied`** are `done`. Jumping
> from the entry question straight to design — with no branch and no DA
> content copied — is the single failure this skill exists to prevent.

## State file

The whole demo reads and writes one gitignored file,
`.internal/onboarding-state.json` (covered by the existing `.internal`
ignore — do not add a new rule). It is the resumability record. **Copy
this schema verbatim when creating it — do not hand-author a different
shape from memory:**

```json
{
  "schemaVersion": 4,
  "intent": "full",
  "customer": {
    "name": null,
    "companyKey": null,
    "demoBranch": null,
    "worktreePath": null,
    "daFolder": null,
    "assetsLane": null,
    "assetsEnrichNow": null,
    "styleScope": null
  },
  "steps": {
    "demo-confirmed": "pending",
    "branch-resolved": "pending",
    "da-content-copied": "pending",
    "rebranded": "pending",
    "demo-company-set": "pending",
    "published": "pending",
    "landed-via-pr": "pending",
    "assets-uploaded": "pending",
    "assets-enriched": "pending",
    "search-scoped": "pending",
    "collections-created": "pending"
  }
}
```

`intent` is `"full"` (default — all six steps), `"rebrand"` (look +
content, no assets — Steps 1–4 then stop), or `"look"` (visual change only,
no content rewrite, no assets — Steps 1–4 visual buckets then stop). See
"Capture the intent first" above for how to choose; `docs/partial-runs.md`
for what each partial run does. Step values are `pending`, `done`,
`blocked`, `deferred`, or `not-applicable`.
- **`deferred`** — the step was *asked for* but postponed
  (`assets-enriched`, `search-scoped`, `collections-created` when the
  customer chose to leave enrichment for a later step — see Entry flow Q2 —
  resuming to `pending` on a later "now enrich the assets" follow-up).
- **`not-applicable`** — the step is *out of scope for the chosen intent*
  and will not run for this request: on a `rebrand` run the four asset/
  collection steps (`assets-uploaded`, `assets-enriched`, `search-scoped`,
  `collections-created`) are `not-applicable`; on a `look` run those four
  **plus** the content half of `rebranded` are (the `rebranded` step still
  runs, but only its visual buckets — see `docs/partial-runs.md`). A later
  "now bring in the assets" follow-up flips the asset steps from
  `not-applicable` to `pending` and resumes into Steps 5–6.
`customer.styleScope` records a `look` run's slice (e.g. `["color","icon"]`
or `{"block":"search-results"}`); it is `null` for `full`/`rebrand`.
`customer.companyKey` is the slug of `customer.name` (lowercase, hyphens);
`daFolder` is `/companies/<companyKey>`. `customer.worktreePath` is the demo's
dedicated git worktree (`../assethub-spark.worktrees/demo-<companyKey>`,
set in Step 2); **Steps 3–6 run with cwd = this worktree**, not the main
checkout, so parallel demos never contend over one working tree. `customer.assetsLane` is
`enrich-existing` or `bring-in` (Entry flow Q1); `customer.assetsEnrichNow`
is `true`/`false` (Entry flow Q2 — always `true` for `bring-in`, since
pulling in samples with no labeling afterward isn't a sensible outcome).
Asset credentials and the AEM env id are **not** in state — they live in
the existing environment (Step 5).

## Skill source of truth

Only **`.claude/skills/rebrand-portal`** is maintained. This repo's
skill discovery reads `.claude/skills`, so do **not** keep a second
`.agents/skills/rebrand-portal` copy. If that duplicate appears, remove
it before editing or running the workflow; a stale duplicate can bypass
new gates such as Step 4g's color verification before assets.

## Entry flow — run first, every invocation

0. **State Step 1 first, then confirm the company name.**
   On a brand-new request (no state file, or `demo-confirmed` not yet
   `done`): say the one plain sentence from Step 1 (what will happen, in
   outcome language), then resolve and **confirm** `customer.name` (Step 2)
   before doing anything else. Never open with a question, and never
   silently default or guess the company name/slug from the source URL
   (e.g. inferring "microsoft" from a microsoft.com link) — if a tool error
   or missing info blocks asking everything at once, fall back to asking
   one thing at a time in order (Step 1 statement → company name), never
   skip ahead. **Do not ask about assets here** (see Entry flow point 2
   below) — Steps 1–4 (confirm, branch, DA copy, rebrand/publish/PR) need
   nothing about asset source or timing; asking Q1/Q2 this early front-loads
   a decision the customer can't yet see the payoff for, and interrupts a
   flow that would otherwise run straight through to the open PR.

1. **Load and verify state.** If `.internal/onboarding-state.json` exists,
   read it, but before trusting a step marked `done`, spot-check one
   concrete fact against the repo (e.g. `rebranded` done → does the demo
   branch exist and carry brand tokens). A state file can be stale or
   inherited from another branch/customer. If the check disagrees, treat
   that step as needing confirmation, not authoritative. Otherwise resume
   at the first non-`done` step and don't re-ask answered questions. If
   the file is absent, create it with the schema above.
   **Step 5 resume guard:** if the next runnable step is asset enrichment
   but Step 4g was not verified in the current session, run Step 4g first.
   A `done` state value is not enough to start assets when live CSS,
   copied docs, PR scope, or the facets panel can still carry stale base
   branding.

1a. **Check excat availability now — before Step 3.** Run `claude plugin
    list` / `claude skill list` (or equivalent) and confirm
    `excat-complete-design-expert` is invokable in this session. The three
    states and their handling are in `docs/excat-setup.md`. If it is not
    invokable: surface the state to the operator and follow the setup
    steps. **Do not block Steps 1–3 on this** — DA copy and branch work
    need no excat; proceed through Steps 1–3 while the operator resolves
    it. Do block Step 4 as before. Surfacing this early avoids a
    mid-flow restart after the DA setup is already done.

2. **Ask Q1/Q2 as the first action of Step 5, not in the entry flow and not
   in the Step 4 handoff** (skip any question the request already answers
   unambiguously). Ask only *after* the Step 4 completion report and portal
   link are delivered and the context check is done — never bundled into the
   Step 4 handoff, and never in the same message as a publish/access blocker
   or the completion report (one purpose per interruption). Plain outcome
   language, no internal terms (I1). Never ask "demo vs real portal" — the
   dedicated path is disabled; every request is a demo. If the customer
   explicitly asks for their own real, separate portal, say plainly that a
   dedicated environment is temporarily unavailable and you'll show it as a
   demo instead — a fresh copy of the site under their company name — then
   proceed. **Q1/Q2 apply only to a `full` demo** — a `rebrand`/`look` run
   never reaches Step 5, so it never asks them.

   Q1/Q2 are **not** a "full vs. branding-only" question, and you must never
   pose them that way — within a `full` demo, assets are always in scope and
   the only open questions are *where the assets come from* and *when
   enrichment runs*. Choosing between `full`, `rebrand`, and `look` is a
   **separate, earlier** decision made up front in "Capture the intent
   first" (from the customer's own wording, and only asked as one plain
   either/or when genuinely ambiguous) — do not fold that choice into
   Q1/Q2, and do not offer "branding only" as an *alternative to assets*
   inside a request that already asked for a full demo.

   If the original request already answered Q1/Q2 unambiguously (e.g. "the
   assets are already in AEM Assets, enrich them"), record the answer in
   state up front and skip straight through Steps 1–4 to Step 5 without
   re-asking — the point is to not ask *before the customer needs to
   decide*, not to force a redundant re-ask when they already decided.

   **Q1 — asset source (always ask unless the request already says).**
   Address the customer as "you"/"your" — the person answering is who you're
   asking, not a third party being described.
   - "Are your assets already uploaded in AEM Assets?" → `assetsLane` =
     `enrich-existing`.
   - "Should I pull in some sample assets from your website instead?" (needs
     a source URL) → `assetsLane` = `bring-in`; `assetsEnrichNow` = `true`
     (bring-in always enriches after upload — there's no sensible reason
     to upload samples and leave them unlabeled).

   **Q2 — enrichment timing (ask only when Q1 = `enrich-existing`, unless
   the request already says).**
   - "Should I also label them now so they're searchable, or leave that
     for a later step?" → `assetsEnrichNow` = `true` or `false`.

   On a resumed request where rebrand is already verified `done` and
   `assetsEnrichNow` was `false`, no question is needed for a follow-up
   like "now enrich Acme's assets and build the collections" — just set
   `assetsEnrichNow` = `true` and route straight to Step 5, then Step 6.

   Never label an option with a step/phase name or a bare mechanic
   ("rebrand only," "publish"); every option states a concrete result the
   customer could see. Never say "DAM folder," "Adobe" (as a stand-in for
   the asset system — say "AEM Assets"), or any other internal-system term
   in the option text — I1 applies to the templates above too, not just to
   ad-libbed phrasing.

3. **Run the sequence** from the first non-`done` step, **for the chosen
   `intent`**. Honor the hard gate. A `full` run goes through Step 6; a
   `rebrand`/`look` run runs the foundation + Step 4 (its buckets) and stops
   after the PR, per "Capture the intent first" and `docs/partial-runs.md`.
   Do not narrate the step list back to the customer.

## Agent invocation examples (operator-facing)

Use these to route user prompts; do not recite this table to the customer.

| User says | Route |
|---|---|
| "Create a demo portal for Acme using `https://www.acme.com` for the visual style and content direction. The assets are already in Adobe, enrich them." | Source site present; `assetsLane = enrich-existing`, `assetsEnrichNow = true`; enrich existing assets; automatically create collections after assets verify. |
| "Create a demo portal for Acme using `https://www.acme.com` for the visual style and content direction. The assets are already in Adobe." | Source site present; `assetsLane = enrich-existing`; ask Q2 (enrich now or leave for later) — don't assume. |
| "Create a demo portal for Acme using `https://www.acme.com` for the visual style and content direction. Pull sample assets from `https://www.acme.com/products`." | Source site present; `assetsLane = bring-in`, `assetsEnrichNow = true` (bring-in always enriches); automatically create collections after assets verify. |
| "Create Acme's demo portal using `https://www.acme.com` for the visual style and content direction, but leave enrichment for a later step." | Source site present; ask Q1 if not already answered; `assetsEnrichNow = false`; rebrand + upload (if applicable) land, `assets-enriched`/`search-scoped`/`collections-created` stay `deferred`. |
| "Now enrich Acme's assets and create the collections." | Resume: `assetsEnrichNow = true`; route straight to Step 5, then Step 6. |
| "Rebrand this for Acme." | Missing required source site; ask for Acme's source site so the look and content direction can be matched. |
| "Change Acme's portal colours to match `https://www.acme.com`." | `intent = look`; the URL is the style source (not full scope), "portal" is not full scope. Steps 1–4 (visual buckets), stop after PR, no Q1/Q2. `styleScope = ["color"]`. |
| "Swap in Acme's logo and icons, using `https://www.acme.com`." | `intent = look`; `styleScope = ["icon"]` (logo+favicon+icon rules mandatory). Steps 1–4 (visual), stop after PR. |
| "Restyle the search block for Acme like `https://www.acme.com`." | `intent = look`; `styleScope = {"block":"search-results"}`. Steps 1–4 (block styling), stop after PR. |
| "Give Acme's portal the look and rewrite the copy from `https://www.acme.com`, but no assets yet." | `intent = rebrand`; Step 4 items 1+2+3(copy), stop after PR; asset steps `not-applicable`; no Q1/Q2. |
| "Actually, now bring in Acme's assets too." | Resume a prior `look`/`rebrand`: flip the asset steps `not-applicable`→`pending`, ask Q1 (Q2 if enrich-existing), run Steps 5–6. |

Every **`full`** route ends with collections once enrichment actually runs
— either immediately, or on the later follow-up if the customer deferred
it. Do not wait for the customer to ask for collections after assets are
searchable. A **`look`/`rebrand`** route ends after the PR with a one-line
offer to bring in assets (not a gate) — see `docs/partial-runs.md`.

## Operator setup (not customer-facing)

⚠️ **Read `docs/excat-setup.md` in full before Step 4.** It covers the
three plugin states (invokable / installed-not-enabled / not-installed),
agent-first install steps, and the publish guard hook. Never hand-roll the
rebrand as a substitute for fixing the tool.


# The steps — summaries + where the full detail lives

Each step below is a **summary only — it is deliberately incomplete.** The
full, mandatory checklist for a step lives in its `docs/step-*.md` file, and
that checklist contains gates, exit-code rules, and verification items that
are **not** repeated in the summary. Acting from the summary alone will skip
them and is a defect.

> ⛔ **MANDATORY READ GATE — applies to every step below.** The FIRST action
> you take when you enter a step is to **Read that step's `docs/step-*.md`
> file in full** (use the Read tool on the path in the step's 📄 line). Do
> **not** run any command, edit any file, delegate to any tool, or write any
> customer-facing message for a step until you have read its doc **in this
> session**. The summary is a table of contents, not the instructions. If you
> find yourself about to act on a step and have not read its doc this turn,
> stop and read it first. This is the single most important rule in this
> file — the step docs carry the failure-derived checks that the evals
> assert, and skipping them reproduces exactly the live breakages they exist
> to prevent.

Paths are repo-relative (`.claude/skills/rebrand-portal/docs/...`) so they
resolve whether cwd is the repo root or the skill dir, matching the existing
`docs/asset-enrichment.md` reference style.

---

## Step 1 — Confirm it's a demo (`demo-confirmed`)

Tell the customer in one plain sentence what will happen (copy the site
under their name, give it their look/content, share a portal link; the
original is never changed — I1). Mark `demo-confirmed` `done`.

▶ **Read now, before acting:** `.claude/skills/rebrand-portal/docs/step-1-2-branch.md`

## Step 2 — Company and branch (`branch-resolved`)

Resolve `customer.name` + `customer.companyKey` (apply I6 for empty/reserved
slugs). Resolve `{org}/{repo}` from the origin remote (this shared repo, not
a fork). Demo branch is `demo/<companyKey>`, created in its **own git
worktree** (`../assethub-spark.worktrees/demo-<companyKey>`) — not the main
checkout — so parallel demos don't contend. Copy the gitignored
`token.env` + `cloudflare/.secrets` into it (each worktree fully
independent; nothing shared back to the main checkout). **Always check for an existing
brand branch first and ASK continue-vs-new if one is found — never silently
reuse, recreate, or delete it (I5).** Record `customer.demoBranch` and
`customer.worktreePath`; mark `branch-resolved` `done`.

▶ **Read now, before acting:** `.claude/skills/rebrand-portal/docs/step-1-2-branch.md`

---

## Step 3 — Copy existing DA content into `/companies/<companyKey>` (`da-content-copied`)

**MANDATORY — never skipped, deferred, or assumed away.** Copy the site's
real DA content into `/companies/<companyKey>` with the packaged
`scripts/da/copy-folder.sh` (never hand-rolled). Conclude "empty" **only**
from exit code `3` (authenticated list, zero docs); `404`/`403` is never
empty. Path-by-path verification, extensions preserved (access sheets must
land as `.json`, not `.xlsx`). On success set `customer.daFolder =
"/companies/<companyKey>"` and mark `da-content-copied` `done`.

▶ **Read now, before acting** (script contract, exit codes, sheet-format &
nav checks): `.claude/skills/rebrand-portal/docs/step-3-da-copy.md`

---

## Step 4 — Rebrand `/companies/<companyKey>` + repo, publish, open the PR

**Gate: do not start — do not invoke `excat-complete-design-expert` or touch
any file — until both `customer.demoBranch` and `customer.daFolder` are set
(Steps 2 & 3 `done`).** One comprehensive delegation: design tokens +
full-palette rebrand via Catalyst, brand-asset/logo swap (all instances),
content-register rewrite scoped to `/companies/<companyKey>` only, publish only
`/companies/<companyKey>/...` paths, set the demo scope in `cloudflare/src/config.js`
(`DEMO_COMPANY`/`DEMO_BASE_PATH` = companyKey), and land one PR (open, never
merge — I3; never close/delete — I5). Token setup is Step 4a (`token.env`,
`DA_TOKEN` only). Marks `rebranded`, `demo-company-set`, `published`,
`landed-via-pr`.

▶ **Read now, before acting** (preflight, 4a token setup, 4b–4f delegation,
all checklists): `.claude/skills/rebrand-portal/docs/step-4-rebrand.md`

## Step 4g — Verification (hard gate before Step 5)

**A hard gate, not optional cleanup.** Verify against the deployed PR worker
in the current session: config.js scoped in the PR diff; background-color
*applied* check (computed == expected per landmark selector, zero
mismatches); full asset-color sweep; base-slug zero-residue; brand-residue
on copied DA docs; login two-panel/logo/favicon; link-scope & auth-gating;
facets-panel colors across every interactive state; folder-scope. If a
resumed state claims rebrand `done` but any 4g check fails, leave `assets-*`
pending and fix Step 4.

▶ **Read now, before acting** (every checklist item + known repeat misses):
`.claude/skills/rebrand-portal/docs/step-4g-verification.md`

---

## Step 5 — Upload and enrich the company's assets

**Preflight gate: all Step 4g checks must have passed in this session
before any `--dry-run` or live enrichment.** If `assetsLane`/`assetsEnrichNow`
aren't already known from the original request, ask Q1/Q2 now (Entry flow
point 2) — this is where those answers are first needed. Reuses the existing environment
(no provisioning): the controller
`scripts/assets/enrich-assets.js` resolves DM creds from
`cloudflare/.secrets` and the AEM env id from `cloudflare/src/config.js`.
Enrich (default) or bring-in (`--source-url`); always `--dry-run` first.
On enrich-existing, the tool reuses assets that are already searchable as-is
and only labels the ones that aren't — report that split to the customer in
plain outcome language (already-searchable is reused work, not a failure).
Pass the Step 4 category contract via `--categories <slugs>` (one shared
vocabulary, no hardcoded list); every asset is mapped to exactly one contract
category. The run emits `report.cards` (label + blurb + facet href + proxy
image per category) and a **card gate** that fails on a zero-asset category or
fewer than `MIN_CARDS` cards. Author the copied `/companies/<companyKey>/en/index`
carousel + cards rows from `report.cards` (via `update-index-cards.js`),
preserving the block wrappers. Scope the portal via config.js.
Marks `assets-uploaded`, `assets-enriched`, `search-scoped`. Then continue
to Step 6 automatically — unless `assetsEnrichNow` is `false`, in which
case leave `assets-enriched`/`search-scoped`/`collections-created`
`deferred` and stop here (I4).

▶ **Read now, before acting** (lanes, controller flags, enrichment path,
card visuals, verification): `.claude/skills/rebrand-portal/docs/step-5-assets.md`

---

## Step 6 — Build collections from the searchable assets (`collections-created`)

Runs **automatically after** `assets-enriched` + `search-scoped` complete
— one collection per `productCategory`, company-scoped, via
`scripts/assets/create-collections.js` (existing env, DM collections API,
always `--dry-run` first). Leave `deferred` only while
`assets-enriched`/`search-scoped` are themselves `deferred`. Marks
`collections-created`.

▶ **Read now, before acting** (controller flags, company-filter stamping,
verification): `.claude/skills/rebrand-portal/docs/step-6-collections.md`
