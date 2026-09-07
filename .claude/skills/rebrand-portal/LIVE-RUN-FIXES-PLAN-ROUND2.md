# rebrand-portal — live-run fixes plan (round 2)

Source: Samsung India demo run (Opus 4.8), screenshots 2026-09-07 12.49 + 15.33.
Three issues observed. No implementation until approved.

---

## 1. Home/portal background still on the base cream surface

**What happened**
- Live portal: blue applied to buttons, search pill, category text, footer mark.
- Whole page background + the card-strip band still `#FBF1EA`/cream (base surface).
- This is exactly the "changes only accent, leaves home hero/panel on base cream"
  FAIL the docs already describe — yet it reached the live portal and the run
  reported Step 4 done.

**Root cause (a coverage hole in the gate, not a missing rule or a weak method)**
- `step-4-rebrand.md:121-134` already orders the full surface rebrand.
- `step-4g-verification.md:40-67` already has a "Background-color applied check —
  hard gate", and it is already a screenshot-free, binary computed-value check:
  build a `selector → expected-value` map from excat's edit (52-57), read the
  actual computed `background-color` on the preview URL for those selectors
  (58-60), hard-fail on any mismatch (61-67).
- Why cream still slipped through: the named selector list is the **search page +
  login** surfaces (`search-hero`, `category-tiles`, `welcome`, `facet-filter-panel`).
  The cream that survived is the **home landing page's dominant canvas** at
  `/<company>/en/` and the **band behind the category cards** — surfaces that
  resolve through a token/section class not in the six named selectors. The gate
  read six passing values and reported clean while the visible home canvas was
  still `baseSurfaceHex`. Coverage hole, not a checking-method weakness. No
  screenshot needed — the method is already computed-value equality.

**Change (plan) — no screenshot; close the coverage hole**
- **A. Extend the selector→expected map (`step-4g-verification.md:52`).** Add the
  home page's dominant surfaces: the home landing canvas (resolve it once on the
  preview — the element whose computed `background-color` actually paints the
  full-page background behind the cards, typically `body` or the top-level
  `main`/section wrapper at `/<company>/en/`) and the section-container band behind
  `main .section.category-tiles` (the wrapper parent, where the band color usually
  lives — not just `.category-tiles`).
- **B. Add an anti-regression clause (`step-4g-verification.md:61-67`).** Alongside
  "computed ≠ expected → fail", add the inverse guard using a value the skill
  already captures: for every surface selector, the computed `background-color` on
  the home preview must **not equal `baseSurfaceHex`** (the base cream captured
  before Step 4b, `step-4-rebrand.md:84-86`). Any surface still resolving to the
  captured base cream is a hard FAIL regardless of the expected map — this catches
  surfaces nobody thought to name, which is exactly how the home page escaped.
  Nothing new to capture; `baseSurfaceHex` is already read in Step 4.
- **C. Gate the completion report (`step-4g-verification.md:252-255`).** Forbid
  emitting the completion report while A/B are unresolved; same hard-fail path as
  the welcome-panel token.

**Files**: `docs/step-4g-verification.md` only. `step-4-rebrand.md` already correct.

---

## 2. Asset questions asked too early (at the Step 4→5 handoff)

**What happened**
- At Step 4 completion the run bundled the publish-token blocker together with
  Q1/Q2 (asset source, label-now-or-later) into one interruption — before the
  portal was even confirmed shareable.
- User: "Unnecessary question at this stage."

**Root cause**
- `SKILL.md:171` says ask Q1/Q2 "immediately before Step 5" — correct intent.
- But `step-4g-verification.md:257-265` runs the context/`/compact` check and then
  "continue straight into Step 5 with the asset answers already gathered." Nothing
  states *where* Q1/Q2 get asked on a run that reaches Step 5 for the first time in
  the same session (the common case). The agent filled the gap by asking at the
  Step 4 completion handoff — the worst spot: mixed with a blocker, before the demo
  link is delivered.

**Change (plan)**
- `SKILL.md:171` — tighten "immediately before Step 5" to "as the first action of
  Step 5, after the Step 4 completion report is delivered and the portal link is
  shared — never bundled into the Step 4 handoff or mixed with any blocker/status."
- `step-4g-verification.md:263-265` — reorder explicitly: (a) deliver completion
  report + link, (b) context/`/compact` check, (c) *then* ask Q1/Q2 if not already
  answered. Q1/Q2 is a Step 5 concern; it must not appear in the Step 4g section's
  handoff.
- Add one negative rule: do not ask an asset question in the same message as a
  publish/access blocker or a completion report. One purpose per interruption.

**Files**: `SKILL.md`, `docs/step-4g-verification.md`.

---

## 3. Agent must self-check DA_TOKEN sufficiency before declaring a publish blocker

**What happened**
- Mint of the separate `HLX_ADMIN_TOKEN` returned 403. The agent treated that as a
  publish blocker and asked the user for a token with site-admin rights.
- Only after the user prompted "check can you publish using DA_TOKEN itself" did the
  agent test a real publish call — which returned 200. DA_TOKEN alone could publish.
- The blocker was false; the escalation to the user was unnecessary.

**Root cause**
- `step-4-rebrand.md:64-68`: on mint failure the doc says *stop and ask the user for
  a different token*. That instruction is wrong — it conflates "can't mint the
  separate admin key" with "can't publish."
- `step-4-rebrand.md:70-72` documents the actual workaround (`admin.hlx.page` accepts
  `DA_TOKEN` forwarded via `x-content-source-authorization`, or direct Bearer), but
  it sits below the stop-and-ask rule and isn't wired into the mint-failure decision.
- Memory `da-token-short-lived` already records: "publish via `Authorization: Bearer
  $DA_TOKEN`; mint-403 is not a blocker." The doc contradicts the established fact.

**Change (plan)**
- `step-4-rebrand.md:64-68` — replace the "minting fails → stop and ask" branch with:
  on mint failure, do **not** stop. Probe publish capability directly first — one
  real preview call against a `/<companyKey>/...` path with `DA_TOKEN` (direct
  `Authorization: Bearer`, then `x-content-source-authorization` fallback), asserting
  on HTTP status. Only if the *actual publish probe* fails (non-2xx on both header
  forms) is it a real blocker worth surfacing — and surface it as "publish failed",
  not "token can't mint".
- Fold the line 70-72 quirk into this branch so the workaround is the first thing
  tried, not a footnote.
- State plainly: mint-403 alone is never a publish blocker; DA_TOKEN sufficiency is
  decided by a publish probe, not by the mint result.

**Files**: `docs/step-4-rebrand.md` only. (`ensure-eds-tokens.sh` unchanged — the
script's mint attempt is fine; only the agent's interpretation of its failure changes.)

---

## Notes / non-changes
- Improvement #1 is a coverage hole in an existing gate, not a new rule or a new
  medium — the surface-rebrand instruction and the computed-value applied-check gate
  already exist and are correct. Extend the selector list + add the anti-regression
  clause; do not add a screenshot step and do not duplicate the existing rules.
- Round-1 plan (`LIVE-RUN-FIXES-PLAN.md`) items 1-3/5 are separate; this round does
  not touch them.

## Implementation order (once approved)
3 → 1 → 2
(3 removes a false blocker that stalls every low-privilege run; 1 is the visible
quality miss; 2 is UX polish.)
