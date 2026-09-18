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
the `/companies/<company>/login` login page shows the new brand, and
searching returns **only** this company's assets. Run the asset-color
sweep against that **preview URL** (not the local tree, not after a
merge).

**Verification ladder — cheapest first; a screenshot is never the gate.**
Every color/surface/logo/link assertion in this section is proven by reading
what the site *serves*, not by looking at a picture of it:

1. **Deterministic checks are the gate.** `scripts/rebrand/verify.mjs`
   plus `curl` of the served CSS and `.plain.html` give a binary pass/fail.
   This is what "done" means. The rendered colors are fully determined by the
   served stylesheet — resolve the cascade, do not eyeball it.

   **Run it as ONE consolidated pass**, not scattered greps. All checks in a
   single invocation (tree + preview + report + cascade):
   ```
   node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
     --preview <branch>.dev.frescopamedia.com --company <companyKey> \
     --report .internal/<companyKey>-assets-report.json \
     --cascade-report .internal/cascade-report.json
   ```
   Checks and what each catches:
   - `brand-fidelity` (tree + preview) — every mapped CSS variable carries the
     value **measured from the source site** (`migration-work/brand.json`),
     in the tree and as served. This is the only check that proves the NEW
     colors are *right*; all the residue checks prove only that the OLD ones
     are gone, which a stylesheet with nothing correct in it also satisfies.
   - `background-shorthand` (tree) — a `background:` shorthand on a
     `.section.*` rule resetting a layered background set at equal
     specificity. This is the mechanism that left a surface cream.
   - `cascade` (needs `--cascade-report` from `check-cascade.mjs`) — the
     **computed** background on the rendered page, home canvas included. No
     static check can see a correct declaration that loses the cascade.
   - `residue`, `structural-residue`, `icon-reference-resolution`,
     `welcome-header-home-link`, `header-logo`, `applied-css`,
     `nav-404-loop`, `access-json` — colors (including one-off literals in block-level CSS
     that were never a named `:root` token), CSS icon references that don't
     resolve to a file, the welcome-header home link resolving through
     `localizePath()`, logo sizing, applied CSS, 404 loop, and the published
     company-scoped access sheets the callback reads.
   - `icon-render` (tree) — header wordmark is vector, not blank `<text>`.
   - `stale-card-images` (report) — no published card image points at a
     base-template asset. A card retitled for the new company but still
     linked to the template's content is a defect that has now shipped
     twice.
   - `card-count` (report) — every populated contract category has a card
     with an href + image, and the page does not exceed the demo's category
     count (catches "only 4 of 6 categories show" and its opposite).
   - `card-ceiling` (preview) — the same ceiling asserted against the
     **published** page rather than the run's own report. A page authored by
     any other route (hand-edited HTML, an ad-hoc script, raw curl) produces a
     report that says nothing about what shipped; this check counts what a
     visitor actually sees, and fails if a "Top Brands" block is still there.
   - `access-json` (preview/origin) — the company-scoped access sheets that the
     worker reads during login are published as JSON under
     `/companies/<companyKey>/config/access/`, and the application sheet grants
     `preview`. This catches the DA-authoring-vs-published-JSON mismatch that
     returns "User not allowed to access this application" after callback.
   - `hero-quality` (report) — no card hero is a flat logo/wordmark/chrome
     (scored by AEM's own smart-tag signal, not a filename list).

   **`card-count` and `hero-quality` need the Step-5 report, and `card-ceiling`
   needs the published page**, so re-run verify.mjs (or just those
   `--only card-count,hero-quality,card-ceiling`) after enrichment produces the
   report and the page is previewed — the icon/CSS/nav checks run at 4g before
   Step 5, the card checks run once the report and page exist.

   **The mandatory set mechanically blocks Step 5.** A `PreToolUse` hook
   (`hooks/guard-step5-verify-gate.sh`) reads a `verify.mjs --write-report`
   output and refuses to run `enrich-assets.js` unless `residue`,
   `structural-residue`, `icon-reference-resolution`,
   `welcome-header-home-link`, `header-logo`, `icon-render`,
   **`brand-fidelity`, `background-shorthand`**, **`stale-card-images`**, and
   **`access-json`** all passed against the current commit. Every other check is listed in
   that hook's `WAIVED_CHECKS` with the reason it is not gated — a check
   belongs to exactly one of the two sets, and
   `tests/rebrand/enforced-checks.test.js` fails if a new one belongs to
   neither. (`stale-card-images` spent months in neither: it shipped with a
   passing eval, gated nothing, and the defect it was written for recurred.)
   A FAIL here must be fixed, not noted and skipped — write the report with:
   ```
   node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
     --preview <branch>.dev.frescopamedia.com --company <companyKey> \
     --report .internal/<companyKey>-assets-report.json \
     --write-report .internal/verify-report.json
   ```

   **`card-ceiling` mechanically blocks the live publish.** It cannot be in
   the set above — it reads the published page, which does not exist yet at
   Step 5 — so it is gated at the other end instead, by
   `hooks/guard-live-publish-ceiling.sh`. The sequence is therefore:

   ```
   author → preview (ungated) → verify --only card-ceiling → publish live (gated)
   ```

   Promoting the landing page to `live` is refused unless
   `.internal/verify-report.json` holds a **passing** `card-ceiling` for
   **this company**, recorded within the last 30 minutes. Preview is
   deliberately left open: gating it would make the check unsatisfiable,
   since the check needs a previewed page to read. The freshness window is
   time-based rather than commit-based because the published page is not a
   git artifact — re-authoring it leaves `HEAD` untouched.

   This is the one barrier that does not depend on which script authored the
   page. Runs have hand-edited the index HTML and imported block primitives
   directly; none of that is blocked, and none of it can skip publishing.

   **Drive the sequence with `scripts/assets/publish-page.js`** — use
   `--push --preview-only`, run the `card-ceiling` check, then
   `--publish`. The guard recognises the CLI as well as raw `curl`, so the
   packaged route is gated exactly the same way; it is not a bypass.

   **`card-count` and `hero-quality` stay self-healing — a FAIL on these
   two never halts the demo.** On a FAIL: fix the cause in place and
   continue — re-author the index so every category is a carousel card;
   re-pick a flat hero. Only if a fix is genuinely impossible (e.g. a
   category has no non-logo asset at all) do you record a one-line
   follow-up in the completion report and proceed — same "note and
   continue, never loop" rule as the screenshot step below. Do not stop
   the run waiting on a human for these two specifically.
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
4. **Once the consolidated `verify.mjs` pass is clean, ask the user
   directly before marking Step 4g done** — do not assume clean means no
   remaining issue. Ask something like: "Static verification passed
   (colors, icons, home navigation). Do you still see stale colors or
   navigation issues on the live preview?" This is a real check-in, not a
   formality — the deterministic checks cover what they cover (residue at
   known selectors, icon file resolution, cascade for the landmarks named
   above); they do not render the page. If the user says no issues,
   proceed to Step 5. **If the user says yes, still stale, only then**
   move to step 2 above (rendered DOM / local testing with the auth
   bypass) to actually see the authenticated page and find the specific
   remaining defect — don't reflexively boot local dev every run "just in
   case."

**Local testing without Entra login.** The deployed PR worker is the
default verification target and needs no login bypass — Entra login works
there. Also reach for local dev in two cases: checking something *before* a
PR/deploy exists (mid-edit, no live preview yet), OR when a gate needs the
authenticated page (the facets/search view) and you have no working
browser-automation tool and cannot screenshot — running local lets you
fetch and diff the rendered DOM without a login. `cloudflare/src/auth.js`
carries a commented-out bypass block (search `DISABLE_AUTHENTICATION`) that
short-circuits `withAuthentication` with a fake local-dev user when
`DISABLE_AUTHENTICATION=true` is set for `npm start` (see `run.sh`).
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
does NOT catch a new-brand token that was written into `styles/styles.css`
but that never actually took effect on the rendered page (a cascade miss,
a more-specific selector winning, a stale cached build). Check that
separately, and first, because a token that isn't applied makes the
residue grep moot:

> **This procedure used to say: "Build the selector → expected-value map
> from excat's own edit — Excat already fetched the source site and already
> decided these values, so this step reuses that decision as the expected
> value." That was wrong, and it is the single reason a cream background
> shipped while every check reported PASS.**
>
> It made the gate circular: the expected values were read out of
> `styles/styles.css`, and then compared against `styles/styles.css`.
> Expected equalled actual by construction, so the gate could not fail —
> not for a cascade miss, and not for an invented colour. Worse, its stated
> premise ("excat already fetched the source site") was false in every run
> we have transcripts for: excat's extraction step was loaded and then
> abandoned 13 times out of 13, so the "decision" being reused was often
> just a colour the agent recalled or derived from a logo.
>
> **The expected value must come from outside the artifact being checked.**
> That is `migration-work/brand.json`, written by `extract-brand.mjs`
> directly from the rendered source site. Never re-derive expectations from
> the stylesheet, from a screenshot of your own work, or from memory.

1. **Confirm the measured record exists and is real.** `migration-work/brand.json`
   must be present with `provenance.gatePassed: true`. If it is missing, or
   `brand.rejected.json` is there instead, extraction landed on an age gate
   or interstitial and **no colour in the theme is trustworthy** — stop and
   re-extract from a URL that renders real content. Do not hand-write
   `brand.json` to get past this; a fabricated record defeats every check
   below. (A `PreToolUse` hook, `hooks/guard-brand-extraction.sh`, blocks
   theme edits while this is unmet, but don't rely on the hook instead of
   checking.)

2. **Run the fidelity check** — it performs the comparison that used to be
   done by eye, against `brand.json` rather than against the stylesheet:

   ```sh
   node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
     --only brand-fidelity,background-shorthand \
     --preview <branch>.dev.frescopamedia.com
   ```

   `brand-fidelity` asserts every `tokenMap` entry's CSS variable is
   declared with the value that was measured from the source, in the tree
   **and** in the served stylesheet (a correct tree that never deployed
   looks identical to a correct deployment if you only read the tree).
   `background-shorthand` catches the specific mechanism behind the cream
   background: a `background:` **shorthand** on a `.section.*` rule
   resetting the layered background another `.section.*` rule set at equal
   specificity. `search-hero` and `category-tiles` are two classes on **one
   element** — the later rule won, and the shorthand wiped the tint and the
   SVG, not just the colour. Prefer `background-color` on section rules.

3. **Read the actual computed value on the rendered page.** Static checks
   are structurally blind to a declaration that is present and correct but
   loses the cascade — which is exactly what happened. This step needs a
   browser, which is why it was never performed before; it is now
   executable, using the browser the excat plugin already ships:

   ```sh
   node .claude/skills/rebrand-portal/scripts/rebrand/check-cascade.mjs \
     --origin https://<branch>--assethub-spark--aem-showcase.aem.page \
     --company <companyKey> --write-report .internal/cascade-report.json
   ```

   Point it at the **AEM content origin, not the worker preview** — the
   worker is behind Entra login, so a headless browser would measure the
   login page's colours (the same failure mode as the age gate). The AEM
   origin serves the same CSS and DOM unauthenticated.

   It resolves what actually *paints* behind each landmark (walking up
   through transparent ancestors, because a transparent section shows its
   parent's colour and that is what the customer sees) and hard-fails any
   surface still painting a captured base-brand hex. It covers the **home
   landing canvas** as well as the search page: the base surface commonly
   survives on the home canvas even when the search page is clean, which is
   how the cream background escaped review.

4. **Gate on the result.** Feed the cascade report into the consolidated
   pass (`--cascade-report .internal/cascade-report.json`) so `cascade`
   appears in the verify report as a real pass/fail. Any failing surface
   blocks Step 5 the same way a missing welcome-panel token does — go back
   and fix the losing declaration (check for a later `background-color`
   override, an `!important`, or a more-specific selector winning;
   `structural-residue` below flags an unchanged literal at the same
   selector, which is often the cause), then re-check. Do not downgrade
   this to a screenshot judgment call — it is binary pass/fail per surface.

**Asset-file color sweep — a fixed checklist, not an ad hoc grep** (a
manual eyeball pass has missed real cases). Run the whole checklist twice:
once right after the step 1–2 edits, and again against the preview URL.

1. **Build the old→new hex map** from step 1's token diff.
2. **Run the consolidated `verify.mjs` pass** (already shown above,
   `--only residue,structural-residue,icon-reference-resolution,welcome-header-home-link`
   to isolate just these four). Between them these checks now cover what
   used to be manual instruction here: `residue` greps `baseBrand.oldHexes`
   (the 11 named tokens) and `baseSlug` across `icons/`, `styles/`,
   `blocks/`, `scripts/analytics/`; `structural-residue` re-derives the
   full repo-wide hex capture (`baseBrand.allBaseHexes`) and fails on any
   hex unchanged at the same file+selector in a file that already carries
   a named brand hex — this is what catches a one-off literal in
   `theme.css`/`facets.css`/`cart-panel.css`/`date-picker.css`/etc. that
   was never one of the 11 named tokens, without needing a hardcoded list
   of "known miss" files to remember by hand; `icon-reference-resolution`
   catches any CSS `url(/icons/...)` reference that doesn't resolve to a
   real file. A hand-curated exclude list for genuinely semantic (not
   brand) colors — warning/error states, chart palettes — lives in
   `scripts/rebrand/semantic-color-allowlist.json`; extend that file, not
   this doc, if a new legitimate semantic color needs excluding.
3. **Diff every file touched** against its pre-edit version and flag any
   changed line not explained by the intended token/color/name swap
   (catches a linter auto-fix riding along).

4. **Welcome-panel token check.** Confirm the brand theme sets
   `--welcome-panel-bg`, `--welcome-panel-accent-rgb`,
   `--welcome-panel-mark-image` (→ `/icons/<companyKey>-beans.svg`), and
   `--welcome-tagline-line1` + `--welcome-tagline-line2`; otherwise the
   login's left panel keeps the base brand's panel colour, mark, and
   tagline (the CSS defaults). `icon-reference-resolution` (above) already
   confirms every icon file a CSS reference points at exists — **also
   confirm the header wordmark actually RENDERS, not just exists.** A
   wordmark SVG built from `<text>`
   renders blank when loaded via an icon shortcode (which the header does as
   an `<img>`): the font does not load in the isolated SVG context, so the
   letters vanish while the file is present and non-empty (verified live —
   blank Nescafé header logo). Header wordmarks MUST be vector `<path>`
   outlines, or embed the real logo as `<image>` — never `<text>`. The
   `icon-render` check (below) FAILs on a `<text>` wordmark; on a FAIL,
   regenerate the icon as outlines and continue — do not ship the blank logo.

Not every `structural-residue` hit is wrong — a genuinely semantic color
(warning/error/success state) that happens to sit in a brand-adjacent file
will FAIL until it's added to `semantic-color-allowlist.json`. Before
adding an entry, confirm the flagged rule really is a semantic-state
color, not brand, by reading the selector and its computed result (served
CSS) — do not add to the allowlist just to make a FAIL go away. Fix real
misses and re-run clean.

**Brand-residue check on the copied DA docs — the footer/logo guard.**
The asset sweep covers the *repo*; this covers the *content*. Fetch each
published company-scoped doc — `/companies/<companyKey>/en/nav`,
**`/companies/<companyKey>/en/footer`**, and `/companies/<companyKey>/login` — from
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
`/companies/<companyKey>/login.plain.html` and assert it contains
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
root ones. After publish: (a) GET the branch AEM origin JSON
`https://<branch>--assethub-spark--aem-showcase.aem.page/companies/<companyKey>/config/access/application.json`
and confirm **200 +
an EDS sheet shape** (`{":type":"sheet",…}`) — a `404` or an `.xlsx`/media
response means the sheet wasn't published under `/companies/<companyKey>` (or landed
as media, not a `.json` sheet); (b) sign in on the preview as a known demo
user and confirm you **reach the portal**, NOT "User not allowed to access
this application". Either failure means Step 3/4 didn't get the company
`config/access/*` sheets published as `.json` — fix and republish before
declaring the rebrand done. The executable gate is:

```
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
  --preview <branch>.dev.frescopamedia.com --company <companyKey> \
  --only access-json
```

The check derives the branch AEM origin from the worker preview host because
the worker route protects `/config/access/*`; an unauthenticated GET to the
worker can redirect to login even when the origin JSON is correctly published.

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
