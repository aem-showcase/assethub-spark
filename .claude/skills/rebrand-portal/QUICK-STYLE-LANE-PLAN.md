# Plan — intent-driven partial runs for rebrand-portal

Status: PLAN ONLY. No skill/hook/script files changed. Grounded in a full
read of SKILL.md, docs/step-1-2-branch.md, step-3-da-copy.md,
step-4-rebrand.md, step-4g-verification.md, step-5-assets.md,
step-6-collections.md, invariants.md (I1–I9), all four hooks, and the evals.

---

## 0. Scope of this plan (per latest direction)

- **Assets (Step 5) and Collections (Step 6) stay bundled and UNCHANGED.**
  They are one unit — enrichment auto-follows into collections, exactly as
  today. This plan does **not** add an assets-only path and does **not**
  touch `enrich-assets.js`, `create-collections.js`, `step-5-assets.md`,
  `step-6-collections.md`, or the `guard-step5-verify-gate.sh` hook.
- The partial-intent work is limited to the **look / content** side of a
  demo (the rebrand half). The choices the user gets are:
  1. **Look only** — recolor / swap logo+icon / restyle a block.
  2. **Look + content** — the visual change plus company-appropriate page
     copy (the full rebrand half, no assets).
  3. **Full demo** — rebrand half + assets + collections (unchanged).

So a partial run is: **the mandatory foundation + the rebrand half, and it
STOPS before assets.** Assets/collections only run in a full demo (or on a
later explicit "now bring in the assets" follow-up — the existing
deferred-assets mechanism, I4, already handles that).

---

## 1. The user need + the two corrections carried over

Users sometimes want to demo the styling capability on a slice, not a whole
portal. Real phrasings:
- "change my **portal's** color using `https://brand.com`"
- "change the icons / swap the logo"
- "recolor it to <brand/hex>"
- "restyle the search / cards block"
- "give it brand.com's look but I don't need assets yet"

Two router rules that must hold (from earlier feedback):
1. **"Portal" is not a full-scope signal** — it names the artifact, not the
   size. "Change the portal's color" is a look request.
2. **A source URL is not a full-scope signal** — it's the *style source*
   excat extracts the palette from (step-4-rebrand.md:22-24), the same way
   the full flow uses it. Never widen scope because a URL is present.

Today the skill refuses all of this: `intent` has one legal value `"full"`
(SKILL.md:109) and "never ask full-vs-branding-only … every demo always
includes assets" (SKILL.md:186-188).

---

## 2. The shared, non-negotiable foundation (every run, partial or full)

Even for "just change one color," these run in full and unchanged:
1. **Step 1 `demo-confirmed`** — plain-language demo framing (I1).
2. **Step 2 `branch-resolved`** — worktree + `demo/<key>` branch,
   existing-branch ask (I5), secrets copied in (I9).
3. **Step 3 `da-content-copied`** — FULL DA copy into `/companies/<key>`,
   path-by-path verified, sheet-format checked. **MANDATORY** — the hard
   gate (SKILL.md:66-70), I6, and the 60-pt
   `demo-and-copy-before-any-design-tool` eval all require it.
4. **config.js scope** (`DEMO_COMPANY`/`DEMO_BASE_PATH` = key) — the preview
   worker + login need it.
5. **Publish** the copied `/companies/<key>/…` paths incl. access sheets (I7).
6. **Open PR** — the shareable deliverable (I3); never merge/delete (I5).

Partial = a smaller CHANGE-SET on top of this same foundation, not a smaller
foundation. (Rationale: without the branch there's nowhere to work; without
the DA copy there's no `/companies/<key>` content to restyle, login/access
sheets are missing, and both the hard gate and the eval fail; without
scope/publish/PR there's no working shareable URL — the point of a demo.)

---

## 3. The rebrand half, split into what's optional vs. always-on

Step 4's delegation (step-4-rebrand.md) has three change buckets. In a
partial run:

| Step 4 bucket | Look only | Look + content | Full |
|---|---|---|---|
| item 1 — design tokens / full-palette color / typography | ✔ if asked | ✔ | ✔ |
| item 2 — logo / icon / favicon swap | ✔ if icons asked | ✔ | ✔ |
| item 3 — content-register rewrite (page copy) | �’**skip** | ✔ | ✔ |
| item 3 — category contract + facet-slug rewrite | **skip** | **skip** (only matters for cards/assets) | ✔ |
| config.js scope (`demo-company-set`) | ✔ | ✔ | ✔ |
| publish `/companies/<key>/…` (I7) | ✔ | ✔ | ✔ |
| land as one PR (I3) | ✔ | ✔ | ✔ |
| **Step 4g verification** | scoped (see §4) | scoped | full |
| **Step 5 assets / Step 6 collections** | **not run** | **not run** | run |

Notes:
- **Look-only** applies excat + logo/icon/favicon, but leaves the copied
  page prose as-is (the source site's copy under the company name). That's
  an acceptable demo of the *visual* capability.
- The **category contract / facet-slug** parts of item 3 exist to feed the
  cards+assets vocabulary. With no assets in a partial run, they're skipped;
  the copied index keeps its base cards (still branch-global-recolored).
- **Logo/icon rules stay verbatim** when icons are in scope — create both
  `<key>-icon.svg` and `<key>-beans.svg`, swap shortcodes in nav/footer/
  welcome, replace favicon — or the header ships an empty circle.

## 4. Scoped Step 4g for a partial run

4g is the pre-assets gate today. For a partial run there are no assets to
gate, but the **visual checks still run** (they prove the change landed):
- **Run:** `brand-fidelity`, `background-shorthand`, `residue`,
  `structural-residue`, `applied-css`, `icon-render`,
  `header-logo`, `icon-reference-resolution`, welcome-panel + favicon,
  `nav-404-loop`, login/auth (publish happened, so login must work).
  `brand-fidelity` needs `migration-work/brand.json`, which a partial run
  still produces — a look-only run is *exactly* the case where measuring the
  source matters most.
- **Skip:** `card-count`, `hero-quality`, `stale-card-images` — these need
  the Step-5 report, which a partial run never produces. **This skip is
  specific to partial runs.** In a full run all three are live, and
  `stale-card-images` is in `guard-step5-verify-gate.sh`'s mandatory set.
  (It previously was not, and this line was the only place it was mentioned
  anywhere — reading as a blanket "skip", it gated nothing, and the stale-card
  defect it exists to catch then shipped twice.)
- **For look-only (no content rewrite):** the brand-residue check on copied
  DA docs still applies to logo/icon shortcodes (item 2 ran), but the
  page-copy residue expectations that assume item-3 rewrite are relaxed —
  a source-site product name surviving in body copy is expected, not a FAIL,
  because the copy wasn't rewritten by choice.
- **No hook impact:** `guard-step5-verify-gate.sh` only fires on
  `enrich-assets.js`, which a partial run never invokes. So the verify
  report is informational here, not a mechanical gate. **No hook or
  verify.mjs change is required for this plan.**

## 5. Intent capture (the router)

Add an intent-capture block to SKILL.md's entry flow. Logic:
1. **Parse the request:**
   - color/theme/palette/restyle/look/logo/icon/favicon/block → **look**
   - rewrite copy/content/wording for the brand → **content**
   - "create/build a demo portal", "set up a demo", assets/enrich mentioned,
     or no narrowing → **full** (rebrand half + assets + collections)
2. **"Portal" and a source URL are NOT scope signals** (§1) — don't widen on
   either.
3. **Map to `intent`:**
   - look only → `look`
   - look + content → `rebrand` (the whole rebrand half, no assets)
   - full → `full`
4. **If ambiguous** whether they want more than the visual change, ask ONE
   plain either/or, each option a concrete outcome (I1): e.g. "Just give the
   portal a fresh look, or also fill it with your assets so people can search
   them?" Never silently guess.
5. Record `intent` in state; run foundation + the mapped change-set; **stop
   after the PR** for `look`/`rebrand` (do not enter Step 5).
6. **Never ask Q1/Q2** (asset source/timing) in a partial run — those are
   Step 5 questions and Step 5 doesn't run.
7. End a partial run with a one-line offer (not a gate): "Want me to also
   bring in and organize your assets?" — accepting routes into the existing
   Step 5/6 as a follow-up (reusing the deferred-assets resume path).

## 6. State schema

`intent` becomes an enum: `"full" | "rebrand" | "look"`.
- `full` — unchanged; runs all steps (existing string value, still valid).
- `rebrand` — foundation + Step 4 items 1+2+3(copy) + 4g(scoped) + PR; asset
  steps marked `not-applicable`.
- `look` — foundation + Step 4 items 1/2 (as asked) + 4g(scoped) + PR;
  content-rewrite and asset steps marked `not-applicable`.
- Add `not-applicable` as a step value (alongside pending/done/blocked/
  deferred) so resume + completion report know a step was intentionally out
  of scope, distinct from `deferred` (which means "asked for, postponed").
- `customer.styleScope` (for `look`): the slice — `["color","icon"]` or
  `{block:"search-results"}`.
- **Back-compat:** existing fixtures/state use `"intent":"full"` — that's
  the unchanged full value, so all 23 fixtures keep parsing. No migration.

## 7. Proposed file changes
- **EDIT `SKILL.md`** — entry flow: add the intent-capture router (§5);
  amend the "every demo is full / no other intent value" line (109) to the
  three-value enum; amend the "never ask full-vs-branding-only" prohibition
  (186-188) so it forbids the *bad old* framing but permits capturing a
  look/rebrand partial intent; note Q1/Q2 gated on `full` (or a later
  assets follow-up); `steps` may be `not-applicable`; partial runs stop
  after the PR with a one-line assets offer.
- **NEW `docs/partial-runs.md`** — the partial path end-to-end: references
  Steps 1–3 docs (foundation, not duplicated), the §3 change-set table,
  the §4 scoped-4g rules, and the stop-after-PR + offer behavior.
- **NO change** to: any hook, any script (incl. verify.mjs), step-1-2 /
  step-3 / step-4 / step-4g / step-5 / step-6 docs (step-4/4g are
  referenced from partial-runs.md, run in scoped form), NON-DEMO-DISABLED.md.
  (If a one-line "for a partial run, skip item 3 / assets" pointer is
  wanted inside step-4-rebrand.md for discoverability, that's a minor
  optional edit — flag §9-Q3.)
- **(opt) NEW evals** — §8.

## 8. Evals (propose; decide §9-Q2)
- `evals/partial-look-only/` — "change the portal's color to match
  brand.com" → routes `look`; still copies DA content before styling;
  applies color; does NOT run assets/collections; opens PR; plain language.
- `evals/full-not-misrouted/` — "create a demo portal for Acme using
  acme.com" → still routes `full` (a URL / the word "portal" does NOT
  downgrade it).
- All existing full-flow evals stay green (the `full` value is unchanged).

## 9. Open questions
1. **State values:** OK with the `full | rebrand | look` enum + a new
   `not-applicable` step value? (Simplest shape now that assets are out of
   scope.)
2. **Evals:** add the two §8 evals now, or ship + add later?
3. **Discoverability pointer:** add a one-line "partial run: skip item 3 +
   assets, see docs/partial-runs.md" note inside step-4-rebrand.md, or keep
   step-4 untouched and drive everything from the router + partial-runs.md?
4. **Router phrasings (§5):** confirm the verb→intent mapping matches how
   your users ask; add any missing phrasings.
5. **"A few pages" for a color change:** color/theme/logo are branch-global,
   so "change the color of a few pages" = portal-wide. Default to
   portal-wide + confirm, or attempt genuine per-page section styling?
6. **`rebrand` (look+content, no assets) — worth a distinct value,** or fold
   content into `full` and offer only `look` vs `full`? (i.e. is
   "rebrand the copy too but no assets" a real ask, or rare enough to skip?)

## 10. Non-goals
- Not re-enabling the dedicated real-portal path (NON-DEMO-DISABLED stays off).
- Not shrinking the mandatory foundation (branch + full DA copy + scope + PR).
- Not touching assets/collections (Step 5/6) — they stay bundled + unchanged.
- Not weakening any guard hook.
