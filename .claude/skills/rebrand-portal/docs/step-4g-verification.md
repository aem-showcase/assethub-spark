## Step 4g — Verification (before declaring the rebrand done)

> **Run from the worktree** (`customer.worktreePath`). The config.js diff
> and asset-color sweep you verify are the worktree's files on the demo
> branch, not the main checkout.

This section is a **hard gate before Step 5**, not optional cleanup. Do not
invoke `.claude/skills/rebrand-portal/scripts/assets/enrich-assets.js`, create collections, or mark asset
steps `done` until every Step 4g check passes against the deployed PR
worker in the current session. If a resumed state claims rebrand is done
but any Step 4g check fails, leave `assets-*` pending, fix Step 4, and only
then continue.

Completion is the **open PR + its verified branch-preview URL** (I3), not
a merge. The preview URL is the **per-PR worker**
(`https://<branch>.dev.frescopamedia.com/companies/<company>/…`), not the raw
`aem.page` origin — that worker is where login, search, and the company
filter actually run. First confirm the PR diff **includes
`cloudflare/src/config.js`** with `DEMO_COMPANY`/`DEMO_BASE_PATH` =
companyKey (without it the deployed worker is unscoped — abort and fix).
Then open the preview: confirm the rebranded `/<company>` pages render,
the `/companies/<company>/public/welcome` login page shows the new brand, and
searching returns **only** this company's assets. Run the asset-color
sweep against that **preview URL** (not the local tree, not after a
merge).

**Verification ladder — cheapest first; a screenshot is never the gate.**
Every color/surface/logo/link assertion in this section is proven by reading
what the site *serves*, not by looking at a picture of it:

1. **Deterministic checks are the gate.** `scripts/rebrand/verify.mjs`
   (residue, header-logo, applied-css, nav-404-loop) plus `curl` of the
   served CSS and `.plain.html` give a binary pass/fail. This is what
   "done" means. The rendered colors are fully determined by the served
   stylesheet — resolve the cascade, do not eyeball it.
2. **Rendered DOM, only when a check needs the authenticated page.** If a
   gate needs the logged-in view (the facets/search page) and you cannot
   reach it, run local dev with the auth bypass (below) and read the served
   DOM/CSS from `localhost`. This is the prescribed fallback, not a last
   resort.
3. **A screenshot is optional confirmation, never a gate and never a
   blocker.** If the screen is locked or no browser-automation tool is
   available this session, record the one item you could not eyeball as a
   follow-up and **continue** — do not loop trying to capture it. The only
   thing a screenshot adds over the served-CSS check is catching a
   third-party widget state that lives outside this repo's CSS (see the
   facets note below); everything else is already covered by steps 1–2.

**Local testing without Entra login.** The deployed PR worker is the
default verification target and needs no login bypass — Entra login works
there. Also reach for local dev in two cases: checking something *before* a
PR/deploy exists (mid-edit, no live preview yet), OR when a gate needs the
authenticated page (the facets/search view) and you have no working
browser-automation tool and cannot screenshot — running local lets you
fetch and diff the rendered DOM without a login. `cloudflare/src/auth.js`
carries a commented-out bypass block (search `DISABLE_AUTHENTICATION`) that
short-circuits `withAuthentication` with a fake local-dev user when
`DISABLE_AUTHENTICATION=true` is set for `npm run dev` (see `local.sh`).
To use it: uncomment the block, run locally, test, then **immediately
re-comment it before doing anything else** — never leave it uncommented
between turns. **Never `git commit`, `git add`, or `git push` while it is
uncommented** — a `PreToolUse` hook
(`hooks/guard-auth-bypass-commit.sh`) blocks those commands whenever the
block is active in the working tree as a second line of defense, but don't
rely on the hook instead of re-commenting promptly. This bypass is a
local-dev convenience only; it must never appear in a diff, a commit, or a
PR.

**Background-color applied check — a hard gate, before the residue
sweep.** The residue sweep below catches leftover old-brand values; it
does NOT catch a new-brand token that excat wrote into `styles/styles.css`
but that never actually took effect on the rendered page (a cascade miss,
a more-specific selector winning, a stale cached build). Check that
separately, and first, because a token that isn't applied makes the
residue grep moot:

1. **Build the selector → expected-value map from excat's own edit** —
   not from any external fetch or user-supplied reference. Read the exact
   `background`/`background-color` value (or the `var(--token)` it
   resolves to) that excat's Step 1 edit wrote in `styles/styles.css` for
   each landmark: `body`, `main .section.search-hero`,
   `main .section.category-tiles`, `.cards-card-body`,
   `.section.welcome`, and the facets/filter panel
   (`.facet-filter-panel`). Excat already fetched the source site and
   already decided these values — this step reuses that decision as the
   expected value, it does not re-derive brand colors from anywhere else.
   **Include the home landing page's dominant surfaces explicitly** — the
   search-page selectors above are not enough; the base surface
   (`baseSurfaceHex`) commonly survives on the home canvas even when the
   search page is clean (verified live). Add: the **home landing canvas**
   at `/companies/<companyKey>/en/` — resolve
   it once on the preview as the element whose computed `background-color`
   actually paints the full-page background behind the cards (typically
   `body` or the top-level `main`/section wrapper) — and the
   **section-container band behind the category cards** (the wrapper parent
   of `main .section.category-tiles`, where the band color usually lives,
   not just `.category-tiles` itself).
2. **Read the actual computed value on the deployed PR preview** for each
   of those same selectors (not the local tree, not source-inspection —
   the rendered, cascaded result).
3. **Hard fail on any mismatch.** Computed ≠ expected for any landmark
   selector blocks Step 5 the same way a missing welcome-panel token does
   (Step 4b–4f item 1) — go back and fix the losing declaration (check for
   a later `background-color` override, an `!important`, or a
   more-specific selector winning; see the known-repeat-misses list below
   for files this has hit before), then re-check. Do not downgrade this to
   a screenshot judgment call — it is binary pass/fail per selector.
4. **Anti-regression: no surface may still be the base cream.** In addition
   to the expected-value match, assert that the computed `background-color`
   on every surface selector (especially the two home-page surfaces added
   in step 1) does **not** equal `baseSurfaceHex` — the base surface value
   captured before Step 4b (see `step-4-rebrand.md`, "Capture the base
   brand's current values"). Any surface still resolving to the captured
   base cream is a hard FAIL regardless of what the expected map says; this
   catches surfaces that were never named in the map. `baseSurfaceHex` is
   already captured — nothing new to read.

**Asset-file color sweep — a fixed checklist, not an ad hoc grep** (a
manual eyeball pass has missed real cases). Run the whole checklist twice:
once right after the step 1–2 edits, and again against the preview URL.

1. **Build the old→new hex map** from step 1's token diff.
2. **Grep every value in that map**, case-insensitive, across every
   `*.svg`, `*.css`, `*.scss` — report every hit. Check icon SVGs for
   `fill="#..."`, background assets for embedded raster, hardcoded panel
   colors. **Explicitly include the background/surface tokens and the
   filter/facets panel** — not just the accent. Grep the base
   background/surface hexes (the cream section/hero surface and any
   decorative brand-background SVG) across `styles/*.css`, the home
   hero/section CSS, AND the search-results **facets/filter panel** CSS.
   A rebrand that changes only the primary/accent leaves the home hero and
   the filter panel on the base cream surface (verified live) — that is a
   FAIL, not a pass. **Explicitly grep the base surface names captured
   before Step 4b** (`--light-color` and `baseSurfaceHex`, the
   facets/search-panel surface value if it's a separate hardcoded literal
   rather than the `--light-color` token, `${baseSlug}-background` (the
   `.${baseSlug}-background-*` section classes), and `backgrounds/big.svg`
   if it still carries the base brand's decorative artwork). Any of these
   still present with the captured base value is the "filter background
   off-brand" gap. Every base surface token and decorative base-brand
   background must be gone. Also confirm the welcome-panel tokens were set
   (see item 5). Also grep the base action-color values captured before
   Step 4b (the base secondary-button `background-color`/hover hexes) that
   commonly survive through component overrides, and every other red/gold
   value in the token diff. Any remaining hit must be either changed to a
   semantic token from the new palette or explicitly justified as a
   deliberate new-brand choice; do not classify these old brand colors as
   neutral chrome. **The old-hex set is `baseBrand.oldHexes`** (captured by
   `capture-base.mjs`); this doc carries no hex literals to match — grep the
   state's `oldHexes`, never a value copied from here.
   `scripts/rebrand/verify.mjs --only residue` runs exactly this grep across
   `icons/`, `styles/`, `blocks/`, and `scripts/analytics/`.
   Then run a **structural hardcoded-surface audit**, not just exact old
   values: inspect every `background`, `background-color`, `border-color`,
   token assignment, and SVG `fill`/`stroke` using a literal hex in
   `styles/`, `blocks/search-results/`, `blocks/search-bar/`, and `icons/`.
   Classify each hit as **neutral UI chrome** (`#fff`, greys, focus ring),
   **semantic token fallback**, or **brand/off-brand surface**. Any
   brand/off-brand hit must become a semantic token. Do not dismiss a color
   as neutral until checking the rendered component it styles.
   **Known repeat misses that must be checked explicitly before Step 5:**
   `blocks/search-results/styles/facets.css .facet-filter-panel`
   (`background-color` overrides earlier `background`), search-results
   `theme.css` red token aliases (`--red-*`, invalid/pressed colors),
   `blocks/search-results/styles/search-panel.css`,
   `blocks/search-results/styles/cart-panel.css`,
   `blocks/search-results/styles/date-picker.css`,
   `styles/add-to-collection-modal.css`, and `styles/styles.css`
   secondary button base/hover colors. If a rule has both
   `background: #...` and later `background-color: #...`, the later
   declaration wins; inspect the computed result and fix the winning
   declaration, not just the first one.
3. **Grep `baseSlug`** (captured before Step 4b; `frescopa` at the time of
   writing) — case-insensitive, across
   the whole repo (`icons/`, `styles/`, `blocks/`, `head.html`) — catching
   a renamed icon whose class still reads `.icon-<baseSlug>-mark`, a CSS
   `url('/icons/<baseSlug>…')` decorative background, or a stray copy
   string. Must be **zero** hits (barring a documented placeholder).
4. **Diff every file touched** against its pre-edit version and flag any
   changed line not explained by the intended token/color/name swap
   (catches a linter auto-fix riding along).

5. **Welcome-panel token check.** Confirm the brand theme sets
   `--welcome-panel-bg`, `--welcome-panel-accent-rgb`,
   `--welcome-panel-mark-image` (→ `/icons/<companyKey>-beans.svg`), and
   `--welcome-tagline-line1` + `--welcome-tagline-line2`; otherwise the
   login's left panel keeps the base brand's panel colour, mark, and
   tagline (the CSS defaults). Confirm both `/icons/<companyKey>-icon.svg` AND
   `/icons/<companyKey>-beans.svg` exist.

Not every hardcoded fill is wrong (a neutral icon that turns brand-colored
on hover is fine) — confirm a flagged file reads off-brand before fixing by
reading the rule it lands in and the selector's computed result (served
CSS), not by assuming. Fix real misses and re-run both passes clean.

**Brand-residue check on the copied DA docs — the footer/logo guard.**
The asset sweep covers the *repo*; this covers the *content*. Fetch each
published company-scoped doc — `/companies/<companyKey>/en/nav`,
**`/companies/<companyKey>/en/footer`**, and `/companies/<companyKey>/public/welcome` — from
the preview (or via `admin.da.live/source`).

**Fetch with status verification — a non-200 response is a failure, not a
clean result.** Use `curl -s -o /tmp/body.txt -w '%{http_code}'` and check
the status code first. A `404` or `403` means the path is unverifiable —
the response body may contain the base brand's name in error-page
boilerplate and must never be grepped as a residue check. Treat any
non-200 as a failure: the doc is missing or unpublished, which is itself a
defect. Fix and republish before proceeding.

On a confirmed 200, assert the body contains **none** of:
`baseBrand.baseSlug` in any name/casing variant,
its old logo shortcode (`:${baseBrand.baseSlug}-icon:`), its taglines/contact, or
its copyright line. Any hit means that doc was skipped in item 3 of the
delegation — go rewrite it and republish.
Also assert **every** remaining icon shortcode in those docs resolves to an
**existing** `/icons/<companyKey>-*.svg` (a shortcode pointing at a missing
icon renders the empty circle seen live), and that the repo `favicon.svg`
no longer carries the base marker captured before Step 4b
(`aria-label`/`fill`).
Then confirm the logo (header + login), footer, and section backgrounds all
read as the NEW brand — catching a surviving cream/coffee background, a
stale footer/welcome logo, or an empty-circle header that a repo grep alone
misses. Do this by reading served content, not a screenshot: fetch
`/companies/<companyKey>/public/welcome.plain.html` and assert it contains
`<div class="welcome">` (the two-panel split layout is present, not
flattened) and that the brand marks resolve; the served-CSS applied-check
and the header-logo check above already prove the panel and section colors.
A screenshot here is optional confirmation only — if you can take one, use
it to eyeball the composed result; if you cannot, do not block on it.

**Header logo-size check (the overflow guard).** The brand-logo rule
(`header .nav-brand .icon img`) MUST constrain the logo by `max-height`
against `--nav-bar-height`, not a fixed `width` + `height: auto`: a fixed
width with `height: auto` renders a square-aspect logo (e.g. a ~1:1 or
~1.6:1 mark) far taller than the header, spilling over the hero title
beneath it (verified live — shipped on a demo whose logo was less wide/flat
than the base). **Verify the actual rule, do not assume it:**
```
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs --only header-logo
```
`header-logo` FAILs if either brand-logo rule is fixed-`width` with no
`max-height`. On a FAIL, **fix the shared rule in `header.css`**
(`width:auto; max-width:<px>; max-height:calc(var(--nav-bar-height) - N)`) —
**never** add a per-company override selector (e.g. `.icon-<companyKey>-icon`)
sized in pixels, which papers over the next brand's aspect ratio instead of
fixing the shared rule. The `header-logo` check proves the rule is
`max-height`-bound (the actual overflow cause); if you have a screenshot
available, eyeball that the rendered logo sits within the header bar, but a
passing `header-logo` check is the gate — do not block on the screenshot.

**Facets-panel verification is mandatory before assets.** The filter panel
is the common gap where the hero looks rebranded but the searchable-assets
UI still carries the old brand — especially in a non-resting state (a
*checked* checkbox rendering the old color while its unchecked state is
already correct, verified live). Verify it in this order:

1. **Served CSS (the gate).** The panel's colors live in
   `blocks/search-results/styles/*.css`; the residue + applied-css checks
   above already assert no captured base hex survives there — including the
   decimal `rgb(r g b …)` form of an old hex, which the plain hex grep
   misses (grep the state's `oldHexes` in both `#rrggbb` and `rgb()` forms).
   **Check every interactive state's declaration** — default, hover, focus,
   checked/active, disabled — for checkboxes, toggles, buttons, tabs; a
   stale value hiding in one state is a FAIL.
2. **Rendered state, if it lives outside our CSS.** If a control's
   checked/hover color comes from a bundled third-party component (not any
   file in `blocks/`), no grep can see it. Reach it by reading the rendered
   DOM: run local dev with the auth bypass (above) and read the computed
   style, or use a browser-automation tool if one is available.
3. **If neither the served CSS nor a rendered read can settle a specific
   third-party widget state** (locked screen, no browser tool, style not in
   this repo): record it as a one-line follow-up for a human eyeball and
   **continue to Step 5** — a single un-eyeball-able third-party widget
   state is not a hard gate. Do not loop trying to screenshot it.

**Link-scope check (the logo-404 guard).** Fetch the copied
`/companies/<companyKey>/en/nav` doc and assert the logo/brand link href starts with
`/companies/<companyKey>/` and has **no** `file:` scheme; assert every internal link
in the copied nav/footer/welcome is under `/companies/<companyKey>/` (no bare
`/en/…`). Then click the logo on the preview and confirm it lands on
`/companies/<companyKey>/en/`, **not** `/404.html` (verified-broken live: an
un-rescoped `/en/` logo link 404s).

**Auth verification (the login-gating guard).** The worker resolves login
and permissions from the **company-scoped** access sheets
(`companyBasePath()/config/access/application` and `.../users`), not the
root ones. After publish: (a) GET
`<preview>/companies/<companyKey>/config/access/application.json` and confirm **200 +
an EDS sheet shape** (`{":type":"sheet",…}`) — a `404` or an `.xlsx`/media
response means the sheet wasn't published under `/companies/<companyKey>` (or landed
as media, not a `.json` sheet); (b) sign in on the preview as a known demo
user and confirm you **reach the portal**, NOT "User not allowed to access
this application". Either failure means Step 3/4 didn't get the company
`config/access/*` sheets published as `.json` — fix and republish before
declaring the rebrand done.

**Sign-in redirect check (hard gate — the dead-login guard).** On the
deployed preview, load `/companies/<companyKey>/en/` (or the welcome page) and
**click the Sign in button**. It **must** redirect to the identity provider
(`login.microsoftonline.com` / the configured Entra host). If it instead
loops back to the welcome page, sign-in is **broken** — do not declare the
portal ready. The cause is a base-path mismatch: the worker's auth routes
are hardcoded at `/auth/*` (`AUTH_PREFIX = '/auth'` in `cloudflare/src/auth.js`
is **not** prefixed with `DEMO_BASE_PATH`), while the welcome page may have
been authored to link `/companies/<companyKey>/auth/login`. The fix is to author the
welcome Sign-in link as **`/auth/login`** (no `/companies/<companyKey>` prefix) — see
Step 4. This exact loop shipped on a live demo because only the login page
render (not the click-through) was checked; the click-through is mandatory.

**Navigation-scope check (the folder-drop guard + the 404-loop guard).**
Run the packaged check first — it hits a deliberately-missing
`/companies/<companyKey>/...` path and asserts the 404 fallback resolves without a
redirect loop:
```
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
  --preview <branch>.dev.frescopamedia.com --company <companyKey> --only nav-404-loop
```
`nav-404-loop` FAILs if the missing path 302s to a 404 page that itself does
not return 200 (e.g. a company-prefixed `/companies/<companyKey>/404.html` that was
never provisioned — it 404s and re-triggers the same handler, an infinite
loop that shipped live). The base template redirects missing paths to the
**shared un-prefixed** `/404.html` (a repo-root static file, not copied
per-company); if this check fails, the worker's 404 redirect regressed to a
company-prefixed target — fix `cloudflare/src/index.js` (`redirectTo404`),
do not "fix" it by copying a 404 page into the company folder.
Then click through the preview and confirm **every** hop stays under
`/companies/<companyKey>/`: a home **category card**, the cart's **"Go to Homepage"**,
the **404 "Go home"**, and **sign-out**. None may land on a bare `/en/…`,
`/`, or an unresolvable `/404.html` (all verified-broken live). The worker's
`/en/*`→`/companies/<companyKey>/en/*` redirect catches strays, so a landing outside
`/companies/<companyKey>/` means both the link and the redirect are wrong.

**Debugging a redirect symptom — check the DESTINATION first.** When a
report names a redirect target (e.g. "after login it goes to
`/companies/<companyKey>/404.html`"), the fastest diagnosis is one `curl -sI` on that
**destination** to see whether it itself resolves — before tracing how the
redirect was produced (auth callback, Referer, cookies). A 302 to a page
that itself 404s is a loop; checking the end of the chain first collapses
the investigation (verified: a live 404-loop was traced through the whole
auth flow before the one-request destination check settled it).

**Folder-scope checks.** Confirm: the rebranded pages render at the branch
preview under `/companies/<companyKey>/`; only `/companies/<companyKey>/...` paths were
published (per-path report shows no root path); and the original shared
root content is unchanged (spot-check one root page still shows the old
brand). Only then is the rebrand done.

**Completion report** (I1, outcomes only): what's rebranded and confirmed
on the portal link (no merge needed); the new brand name and content
highlights; any follow-up (e.g. a placeholder logo pending the real
asset). **Do not emit this report while the background-color applied
check (above) is unresolved** — a home surface still resolving to
`baseSurfaceHex` is a hard FAIL that blocks the report the same way a
losing welcome-panel token does; fix it, re-check, then report.

**The Step 4 handoff carries no asset question and no blocker.** Deliver
the completion report and the portal link on their own. Do not bundle Q1/Q2
(asset source, label-now-or-later) or any publish/access blocker into the
same message as the report — one purpose per interruption. Q1/Q2 is a
Step 5 concern (below), not part of the Step 4 handoff.

**Context check before Step 5.** After the report + link are delivered,
check `/context`. If the messages budget is above 60%, tell the operator:
"Before I start the asset step, run `/compact` — that keeps the session
clean through enrichment and collections." Wait for confirmation before
proceeding. (`/compact` is a user-typed command; you surface the
suggestion, you don't invoke it.)

Then continue into Step 5. **Ask Q1/Q2 as the first action of Step 5** —
after the report and link are delivered and the context check is done —
not before, and never in the Step 4 handoff (see SKILL.md Entry flow
point 2 for the wording). Skip either question the original request or
prior state already answered unambiguously. Once answered: if
`assetsEnrichNow` is `false`, upload (if applicable) and stop there;
stopping with enrichment deferred is a valid end state (I4).
