# RCA + Plan — why 4g passes a demo with stale home bg + missing non-home logo

Two defects seen consistently across demos (Woolworths, and earlier runs). This
documents the ROOT CAUSE in the skill's gate (not the demo) and plans checks that
would actually catch the class. Diagnosis was done from served CSS + repo only —
no local server needed.

---

## Defect 1 — Home canvas background is stale base cream

### Evidence (proven, not inferred)
- Served `styles.css`: rebrand set `--light-color: #EAF5EE` (green) — that is the
  SEARCH-hero surface, which is why the search page reads green.
- The HOME canvas paints from a different surface. `--background-color` →
  `--color-neutral-50` → `#fff`. The visible cream is NOT `#fff`.
- The only near-cream literal in served `styles.css` is `#fafafa` (neutral-200),
  not the home cream. **The home cream hex is not in `styles.css` at all** — it
  comes from the copied DA content / a section-class background authored in the
  index doc (home-specific), outside `styles.css`.

### Why the gate misses it
- `verify.mjs checkAppliedCss` (scripts/rebrand/verify.mjs) does exactly ONE
  thing: fetch served `styles.css`, grep it for `baseBrand.oldHexes` as literal
  UPPERCASE strings. Pass if none present.
- The home cream (a) isn't a literal hex in `styles.css` (it's in DA content /
  section styling) and (b) `oldHexes` in state is empty/absent. So the grep has
  nothing to match → passes.
- The 4g DOC (step-4g-verification.md:118-145) DOES describe a computed
  background check on the "home landing canvas" + an anti-regression assert that
  no surface still equals `baseSurfaceHex`. But that is PROSE the agent is trusted
  to run by hand. There is NO deterministic verify.mjs check enforcing it.
  Unenforced prose → skipped every run → green.

### Root cause
The color gate proves the wrong artifact (literal hexes in `styles.css`) when the
real home surface is a computed value reached via a token/`var()` chain and/or
authored in DA content. No check computes what actually paints the home canvas.

---

## PROVEN MECHANISM (from code + DA only, no live server) — supersedes the hypotheses below

Traced end-to-end. The real cause of BOTH defects is a **re-rebrand blind spot**:
this fork was a **Disney** demo, re-rebranded to **Woolworths**. The gate keys its
residue/color checks off `baseBrand.baseSlug`/`oldHexes` = the pristine template
brand (`frescopa`), NOT Disney. So it greps for the wrong old brand and passes.

Evidence (DA source, org/repo `mohitar1/poc-eds-fork-1786551635`, content at ROOT
`/en`, NOT `/companies/woolworths/`):
- `/en/nav` doc body: `<a href="file:////en/">:disney-icon:</a>`
  - brand icon shortcode is **`:disney-icon:`** → `/icons/disney-icon.svg` absent →
    no logo. `header.js isBrandContent` matches `.icon-woolworths-icon` (absent) →
    brand node never built. Logo broken on EVERY page (shared nav), home included;
    the green W seen earlier is the favicon, not the in-page header logo.
  - brand link is **`file:////en/`** → broken `file:` scheme → dead home link.
- `/en/index` doc: **8 `disney` refs, 0 `woolworths`**; card images point at
  `content.da.live/aem-showcase/assethub-spark/...` (base showcase org). The home
  doc was never rebranded off Disney.

Why 4g passed it:
- Brand-residue check (step-4g:233-251) greps nav/footer/welcome for
  `baseBrand.baseSlug` = **`frescopa`** — not `disney`. `:disney-icon:` isn't
  `frescopa`, so it passes.
- `applied-css` greps `oldHexes` (also `frescopa`-era) → misses Disney/stale
  colors.

ROOT CAUSE (workflow): the skill assumes ONE rebrand from the pristine template.
On a **re-rebrand** (a prior demo's brand → a new brand), the true "old brand" is
the previous demo (Disney), but state's `baseBrand` still says `frescopa`. Every
residue/color/icon check greps the wrong old brand and reports green while live
old-brand shortcodes, links, content, and images survive.

NOTE: this also means content was published to ROOT `/en`, not
`/companies/woolworths/` — a separate finding worth confirming.

---

## Defect 2 — Company/home logo missing on all NON-home pages

The brand logo (the click-target back to home) renders on `/en/` but is absent on
`/en/search`, `/en/reports/*`, `/en/my-dam/*`.

### Evidence gathered
- Header is client-JS-built: `header.js` loads `/nav` via
  `loadFragment(localizePath('/nav'))`.
- `localizePath` → `getExplicitLocalePrefix` → `detectCompanyBaseFromPath`
  correctly yields `/companies/woolworths/en` on EVERY page (traced in
  locale-utils.js). Same nav doc, same prefix, on all pages.
- Both icon files resolve 200 (`/icons/woolworths-icon.svg`,
  `woolworths-beans.svg`). `isBrandContent` keys off `.icon-woolworths-icon`.

### Honest limit
- The authenticated nav DOM cannot be read via curl — `/nav.plain.html` 302s to
  the auth welcome page (no session cookie). So the EXACT rendered mechanism of
  why the logo is present on home but absent on nested pages is **NOT fully proven
  from curl+repo alone.** It needs the logged-in DOM (browser session or local
  auth-bypass render). Candidate causes not yet distinguished: per-page nav
  fragment render timing, a nested-route DOM difference, or a home-only inline
  logo vs nav-driven logo. DO NOT assert one without the rendered read.

### Why the gate misses it (this part IS proven, and is the real point)
- The gate's logo/icon checks are HOME/LOGIN-only:
  - `icon-render` — tests the wordmark SVG is vector not `<text>` (blank-logo).
  - `header-logo` — tests the CSS sizing rule in header.css.
  - the brand-residue check fetches nav/footer/welcome docs.
- NONE of them load a NON-home page (search/reports/notifications) and assert the
  brand logo element is present + its icon resolves. So a logo fine on home and
  absent elsewhere is never inspected → green.

### Root cause (workflow level)
The gate only ever verifies the header on the home/login surface. Whatever the
per-page mechanism, a header regression on nested routes escapes because no check
inspects a nested route.

---

## The shared, higher-order RCA
The 4g "hard gate" is a set of **narrow, literal-string, home-only** checks:
- color = literal-hex grep of `styles.css` (misses token chains + DA-content
  surfaces),
- logo = home/login header only (misses nested routes).
The doc compensates with PROSE ("compute the home surface", "inventory every
tile") but nothing enforces it, so the agent reports green without doing it. That
is why both defects recur consistently across demos.

---

## Plan (checks to add — NOT yet implemented; for review first)

Principle: convert the two unenforced prose checks into deterministic
verify.mjs gates. Both must be runnable from served content (+ report), no local
server for the parts that don't need auth; the ONE part that needs the
authenticated DOM is called out explicitly.

### Check A — home-canvas computed surface (Defect 1)
- New `verify.mjs --only home-surface` (or fold into applied-css):
  - Fetch the published home page (`/companies/<key>/en/`) served HTML + its
    section CSS classes; resolve the background actually applied to the home
    canvas + the section band behind the category cards.
  - Assert it does NOT equal the captured `baseSurfaceHex`, and DOES equal the
    rebrand's intended surface token.
  - Because the cream can live in DA-authored section styling (not `styles.css`),
    the check must inspect the home DOC's section classes + the resolved
    background, not only `styles.css`.
- OPEN QUESTION for the plan review: computing the *applied* background on the
  home canvas may require the rendered DOM (cascade). Decide: (a) served-CSS +
  section-class resolution is enough (cheaper, no auth), or (b) it needs the
  rendered page. Home page render is PUBLIC-ish? — verify whether `/en/` is
  auth-gated; if the home canvas is readable unauthenticated, no bypass needed.

### Check B — brand logo on a NON-home page (Defect 2)
- New `verify.mjs --only header-logo-present` that targets a NESTED route
  (e.g. `/companies/<key>/en/search`), not home:
  - Assert the header brand element + its `.icon-<key>-icon` (or the resolved
    `/icons/<key>-icon.svg`) is present and the icon resolves 200.
- HONEST DEPENDENCY: the nested nav DOM is auth-gated → this check needs the
  authenticated view. Options to decide in review:
  1. Local dev + auth bypass (the prescribed gated-DOM path), OR
  2. If the nav FRAGMENT (`/nav.plain.html`) can be fetched with a session/token
     non-interactively, assert on it directly (no full render).
- Must FIRST finish the RCA: read the logged-in nested-page DOM once to prove the
  actual mechanism, THEN write the assertion against that mechanism — do not code
  a check against an unproven cause.

### Doc reconciliation
- step-4g-verification.md: replace the PROSE home-surface + tile-inventory
  instructions with a pointer to the new deterministic checks, so the gate is
  enforced not trusted. Keep the narrow third-party-widget exception only.

---

## What is NOT in this plan yet
- No code written. No new checks implemented.
- Defect 2's exact mechanism is still OPEN (needs one authenticated DOM read).
- Whether Check A needs rendered DOM vs served CSS is OPEN (needs the auth-gating
  status of `/en/` confirmed).

## Next step (on approval)
1. Read the authenticated nested-page nav DOM ONCE (browser session or local
   bypass) to close Defect 2's mechanism.
2. Confirm whether `/companies/<key>/en/` home canvas is readable unauthenticated.
3. Only then implement Check A + Check B against proven mechanisms.
