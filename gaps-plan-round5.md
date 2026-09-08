# Rebrand-portal — Live-run fixes (Round 5): de-hardcode the skill

> **Status: IMPLEMENTED on `rebrand-improvements` (2026-09-08).** Derived from the
> Workday demo run (`demo/workday`, PR #37). Every claim traced to `file:line`.
>
> | Item | What landed | Validated |
> |---|---|---|
> | T1 — 404-loop redirect | `index.js` `redirectTo404` (un-prefixed `/404.html`), dead `redirectToBasePath` removed | 442 worker tests; `verify.mjs nav-404-loop` |
> | T2 — header logo overflow | `header.css` `max-height` rules + `<480px` block; `header.js` `.my-account-label` span | `verify.mjs header-logo` PASS; lint clean |
> | A — capture-base.mjs | reads baseSlug/surface/tokens/welcome-panel/navHeight/oldHexes → state `baseBrand` (schema 4→5) | 8 tests + e2e vs real tree (reads frescopa/#F4E9DC) |
> | B — verify.mjs | 5 checks: header-logo, residue, nav-404-loop, applied-css, stale-card-images | 7 tests + e2e (residue finds 54 hits on unrebranded tree) |
> | Gap 3 — front-load residue | step-4 delegation greps `baseBrand.oldHexes` before returning | doc |
> | Gap 4 — stale-card gate | step-5 `verify.mjs --only stale-card-images` | doc + test |
> | Gap 5 — debug heuristic | step-4g "check the DESTINATION first" | doc |
> | Gap 6 — daFolder de-conflict | step-3 "set daFolder BEFORE the copy" | doc |
> | Docs de-hardcoded | 0 brand hexes in step-4/4g; all point at scripts | grep |
> | Evals | header-rule-is-checked-not-assumed, redirect-destination-tested-first, stale-card-images-dropped | task+criteria+fixture each |
>
> New tests: `tests/rebrand/{capture-base,verify}.test.js` (15), all suites green
> (665 unit + 68 dom + 442 worker), JS/CSS lint 0 errors.

> **Original plan (below) — for traceability.** Derived from the Workday demo run
> (`demo/workday`, PR #37, 2026-09-08). Every claim traced to `file:line` on
> `rebrand-improvements` (current tree), not to the run log.

## Thesis

The skill keeps shipping broken demos because **brand values and codebase-state
facts are frozen into prose docs**. Each run against a new company (Workday ≠
frescopa ≠ Apple ≠ Pfizer) trips over a literal or a code assumption baked in
for the *previous* company/state.

Two buckets, one fix each:

| Bucket | Current (hardcoded) | Fix |
|---|---|---|
| **Brand values** in prose | `baseSurfaceHex = #F4E9DC`, `#2f2318`, `234 163 58`, `--nav-height: 72px` (`step-4-rebrand.md:126-127`, `:161`, `:171`) | Script reads them from the tree at runtime → state; docs reference state, never a literal |
| **Codebase-state claims** as fact | "`header .nav-brand .icon img` constrains by `max-height`" (`step-4g-verification.md:206-208`) — but `header.css:341-345` is `width:150px; height:auto` | Script checks the actual tree/preview and fails loudly; docs describe the *check*, not the *state* |

Evidence of the hardcoding, current tree:
- `step-4-rebrand.md`: **15** `frescopa` literals; hexes `#F4E9DC #2f2318 #95351D #7a2b17`, rgb `234 163 58`.
- `step-4g-verification.md`: hexes `#F4E9DC #FBF1EA #95351D #7a2b17`; a false code-state claim (line 206-208); `--nav-height: 72px` assumption.
- `scripts/`: Step 5 (assets) is fully scripted; **Step 4/4g rebrand+verify is 100% prose** — zero scripts capture base values or verify. That asymmetry is the root cause.

The docs *know* the values are wrong — they wrap each in "read the actual value
from the tree, this is just an example" (`step-4-rebrand.md:128-134`). But that
hedge is (a) prose the agent can ignore, and (b) **not applied to code-state
claims** — which is exactly what broke in the Workday run (Gap 2).

---

## The two new artifacts (scripts replace the hardcoded prose)

### A. `scripts/rebrand/capture-base.mjs` — removes all frozen brand values

**Input:** repo root (cwd = worktree). No brand values passed in — it reads them.

**Reads from the unedited tree:**
- `baseSlug` — from `icons/*-icon.svg` / `icons/*-beans.svg` filenames.
- `baseSurfaceHex` — `--light-color` in `styles/styles.css` `:root`.
- `welcomePanelBg`, `welcomePanelAccentRgb` — literal fallbacks in `body:has(.section.welcome)` rules.
- `actionColors` — secondary-button bg/hover hexes in `styles.css`.
- `navHeight` — `--nav-height` value in `styles.css`.
- `oldHexes[]` — every distinct hex in `:root` (source of the old→new residue map).

**Writes:** `.internal/onboarding-state.json` → new `baseBrand: { baseSlug, baseSurfaceHex, welcomePanelBg, welcomePanelAccentRgb, actionColors, navHeight, oldHexes }` (bump `schemaVersion` 4→5).

**Self-test fixture (the ONLY place a frescopa hex may live):** a test asserts
that on the current tree it reads `baseSlug=frescopa`, `baseSurfaceHex=#F4E9DC`,
etc. This is a *fixture*, not guidance — when the template's base brand changes,
the fixture updates; no doc does.

**Doc effect:** delete `step-4-rebrand.md:125-134` (the frescopa hex paragraph)
and every downstream "read the actual value from the tree" hedge; replace inline
hexes at `:161` and `:171` with `baseBrand.*` references.

### B. `scripts/rebrand/verify.mjs <preview-host> <companyKey>` — removes all code-state claims + makes gates executable

Each check reads the **tree or live preview**, hard pass/fail, non-zero exit on
any FAIL, prints failing check + `file:line`. Replaces the 4g prose the agent
skipped or found false.

- **`header-logo`** — reads the *actual* `header .nav-brand .icon img` rule from
  `header.css`; FAIL if fixed-`width`+`height:auto` (no `max-height` bound). Kills
  the false claim at `step-4g-verification.md:206-208`.
- **`nav-404-loop`** — `curl -sI <host>/<company>/<random-missing>`; follow one
  hop; FAIL if the 302 destination doesn't itself return 200 (loop). Catches Gap 1
  for every future demo.
- **`applied-css`** — reads excat's written token values from `styles.css`; reads
  computed values on the preview; FAIL on mismatch or on any surface still ==
  `baseBrand.baseSurfaceHex`. Uses the *captured* value, not a literal.
- **`residue`** — greps `baseBrand.oldHexes` + `baseSlug` across
  `icons/ styles/ blocks/ scripts/analytics/`; FAIL on any hit.
- **`stale-card-images`** — FAIL if any published card `<img>` src resolves to a
  base-template asset (`firefly_*`, shared-root media) not in this run's
  enrichment report. Catches Gap 4.

**Doc effect:** `step-4g-verification.md` collapses from ~300 lines of
prose-the-agent-rationalizes-past to: "Run `verify.mjs`; every check must pass;
do not proceed to Step 5 on any FAIL." Keep only the *why* for each check, not
the *how* or the values.

---

## Template fixes (upstream PR #37 fixes to `main` so the scripts pass on a clean baseline)

These are app code the skill governs (every demo branches from this template),
so a template bug is a skill bug.

### T1 — `cloudflare/src/index.js` 404 redirect loop (P0, confirmed live)
- `index.js:70-73` `redirectToBasePath` prepends `BASE`.
- Called at **`:171`** and **`:189`** with `'/404.html'` → `/<company>/404.html`,
  which is never provisioned (`404.html` is repo-root static, `./404.html`; Step 3
  copy allowlist is `en config public`, `copy-folder.sh:97`) → destination 404s →
  same handler → infinite loop.
- **Fix:** both call sites redirect to the un-prefixed shared `${origin}/404.html`
  (the exact fix validated in PR #37). `404.html` is a shared static asset like
  `/favicon.ico` — must not be company-prefixed.
- `scripts/scripts.js:71` `window.location.replace('/404.html')` is then
  *consistent* (both point at shared root) — leave as-is; note in commit so it
  isn't "fixed" to a prefixed path later.
- After T1: `verify.mjs nav-404-loop` passes on a clean template.

### T2 — `blocks/header/header.css` fixed-width logo (P0, confirmed live)
- `header.css:319-322` (`width:180px; height:auto`) and **`:341-345`**
  (`width:150px; height:auto`) — both fixed-width, no `max-height`. The 4g doc
  claims otherwise (false).
- **Fix:** both rules → `width:auto; max-width:<existing px>; height:auto;
  max-height:calc(var(--nav-bar-height) - 24px)`. Add the `@media (width < 480px)`
  block (tighten icon gaps, hide `.my-account-label`). Requires wrapping the
  "My Account" bare text node in `header.js` in `<span class="my-account-label">`.
- After T2: `verify.mjs header-logo` passes on a clean template.

---

## Front-load residue into the excat delegation (Gap 3, P1 — biggest time sink)

- Run initially token-only → 4g discovers ~40+ hardcoded literals (theme.css
  `--purple-*`, hero.css cream tints, 16 icon SVGs, `scripts/analytics/*`
  palettes) reactively, across 2 commits + ~25 min.
- **Fix:** `step-4-rebrand.md` §4b-4f item 2 — make `baseBrand.oldHexes` (the
  old→new map) and the "known repeat misses" file list (`step-4g:135`) an **input
  to the excat delegation**: "grep-and-replace every value in this map across
  `icons/ styles/ blocks/ scripts/analytics/` before returning." 4g then verifies
  a clean tree (finds zero), not forty.

---

## De-conflict the docs (Gap 6, P2 — systemic; contradictions train the agent to distrust gates)

- **`daFolder` guard:** `step-3-da-copy.md:75-81` warns "don't hand-set daFolder
  to unblock the guard," but Round-3 FIX 10 says set it up front. Pick one:
  "set `daFolder` in state before running the copy; verification still gates
  marking the step done." Delete the contradicting warning.
- **`--welcome-tagline`:** `step-4-rebrand.md:174-182` mandates two separate
  `--welcome-tagline-line1/2` properties, never a single `\A`. Verify against the
  *actual* current CSS which one it reads; make the doc match reality (agent kept
  the base's single-`\A` structure in the run, contradicting the doc).

---

## Debugging heuristic (Gap 5, P1 — workflow)

Run log 3142 vs 3515: user named the redirect **destination** (`/workday/404.html`);
agent found the culprit function (`redirectToBasePath`, `index.js:170-189`) at
3142, abandoned it, ran ~15 probes into auth/Referer/cookies/deploy, and didn't
`curl /workday/404.html` until 3515 — one request that ends the whole investigation.

- **Fix:** one line in `step-4g-verification.md` debugging note + SKILL.md: "When a
  report names a redirect **destination**, test whether that destination resolves
  (`curl -sI`) **before** tracing how the redirect was produced. A 302 to a page
  that itself 404s is a loop — check the end of the chain first."

---

## Doc rewrite rule (applies to EVERY doc)

1. **No hex, rgb triplet, `--nav-height: 72px`, brand name, or `line N` in prose.**
   A needed value comes from `baseBrand.*` in state.
2. **No sentence asserting current code state as fact.** Each becomes "the verify
   script checks this; if it fails, fix `<file>`."
3. Frescopa hexes survive **only** in `capture-base.mjs`'s self-test fixture.

---

## Evals

Current suite (30) is single-turn scripted-customer in an isolated sandbox (no
real DA/AEM); scores ~30% because the agent halts — so Gaps 1-5 aren't testable
as live outcomes. But three are testable as *behaviors*:

- **`header-rule-is-checked-not-assumed`** — fixture has fixed-`width` `header.css`;
  task runs the 4g header check. PASS = agent reads the actual rule and flags the
  regression, not asserts "already uses max-height" from the doc.
- **`redirect-destination-tested-first`** — fixture: user reports "after login lands
  on /X/404.html". PASS = agent's first diagnostic tests whether `/X/404.html`
  resolves, before tracing auth.
- **`stale-card-images-dropped`** — fixture: a secondary section with base-template
  images. PASS = agent drops/replaces, doesn't ship the stand-in.
- **Strengthen `resume-verifies-not-assumes`** — add a case where the doc claims a
  state the fixture contradicts; agent must trust the tree over the doc.

---

## Sequencing

1. **T1 + T2** (template fixes on `main`) — the two real defects; smallest, unblocks the verify scripts.
2. **A `capture-base.mjs` + B `verify.mjs`** (+ tests) — the de-hardcoding engine.
3. **Doc rewrites** (step-4, step-4g) — delete literals + code-state claims, point at scripts.
4. **Gap 3** (front-load residue into delegation) + **Gap 6** (de-conflict) + **Gap 5** (heuristic).
5. **Evals** — the three behavior evals above.

## Confirmed-live anchors (traceability)

- `index.js:70-73, :171, :189` — redirect loop (T1).
- `header.css:319-322, :341-345` — fixed-width logo (T2); `styles.css:86` `--nav-height:72px`.
- `copy-folder.sh:97` — `en config public` allowlist; `./404.html` is repo-root static.
- `step-4g-verification.md:206-208` — false "uses max-height" claim.
- `step-4-rebrand.md:126-134, :161, :171` — frozen frescopa hexes.
- `scripts/scripts.js:71` — client-side `/404.html` (consistent after T1).
