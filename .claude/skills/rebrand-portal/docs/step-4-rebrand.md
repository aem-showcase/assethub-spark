# Step 4 — Rebrand `/companies/<companyKey>` + repo, publish, open the PR

> **Run from the worktree.** All code edits here — design tokens,
> `cloudflare/src/config.js`, logo/asset swaps — happen in
> `customer.worktreePath` (Step 2's git worktree), never the main checkout.
> Invoke `excat-complete-design-expert` and the packaged scripts with cwd =
> the worktree so they edit the worktree's files.

**Gate — do not start until both `customer.demoBranch` and
`customer.daFolder` are set** (Steps 2 and 3 `done`). Do not invoke
`excat-complete-design-expert` or touch any file until both are set.

## Step 4 preflight — Experience Catalyst availability

Before any design/rebrand work, verify `excat-complete-design-expert` is
invokable in the current session. Run the operator setup check above
(`claude plugin list`, `claude skill list`, or the equivalent in the active
CLI). If it is not invokable, follow `docs/excat-setup.md` and block here
until the plugin is loaded.

If a source website URL is present, that URL is the design source. Invoke
`excat-complete-design-expert` directly in Complete Migration mode with the
source URL and the copied `/companies/<companyKey>/...` verification targets.

**Do not ask how to source the look when a source URL is already present.**
Do not ask the user for colors or a palette while Catalyst is available.
A generic `WebFetch` failure is not a blocker and is not a reason to ask
for manual colors; Catalyst performs its own source extraction. Do not
route this work to DesignSync or any generic design tool. If Catalyst
itself fails to extract the source after it is invoked, then report that
specific Catalyst failure and ask for a better source URL or brand inputs.

## Step 4a — Content-authoring access (`token.env` — the only setup)

The only customer-provided access setup is a gitignored `token.env` at the
repo root with **one** line, `KEY=value`, no quotes:

- **`DA_TOKEN`** — read/write Document Authoring content, and mint the
  Helix Admin API key used for preview/publish.

Send this exact message (don't paraphrase, don't add any settings/toggle/
permissions step — none exists for this flow):

> "Before I start, create a file called `token.env` in the project root
> with this one line (I'll never ask you to paste this in chat):
> `DA_TOKEN=<token copied from da.live>`
> To get it: open `https://da.live/#/{org}/{site}`, sign in, open browser
> DevTools → Network, click a request like
> `https://admin.da.live/config/{org}/...`, copy the
> `Authorization: Bearer ...` request header, and paste only the token
> value after `DA_TOKEN=`.
> Let me know once it's there."

Then check the file exists (never read/log its contents — I2) and confirm
it's gitignored; if `.gitignore` lacks a `token.env` entry, add one.
Access is exactly this DA token from the customer. The active flow does not
ask the customer for any other token or send them to another setup screen.

After `token.env` exists, run the packaged token script:

```
.claude/skills/rebrand-portal/scripts/da/ensure-eds-tokens.sh \
  <org> <repo> \
  --token-file token.env
```

The script verifies `DA_TOKEN`, reuses an existing valid `HLX_ADMIN_TOKEN`
if present, otherwise mints a new Helix Admin API key from `DA_TOKEN`,
writes it back to `token.env`, and verifies Helix Admin status. It never
prints token values. If DA validation fails, stop and say the DA token is
expired or does not have access to this site.

**Minting can 403 and that is NOT a publish blocker.** Minting a separate
`HLX_ADMIN_TOKEN` needs site admin/config rights the DA token may lack, but
`admin.hlx.page` preview/publish accepts `DA_TOKEN` forwarded directly — so
a mint failure says nothing about whether you can publish. When minting
fails or returns no token value, do **not** stop and do **not** ask the user
for a different token. Decide publish capability by a real probe, not by the
mint result:

1. Run one real `admin.hlx.page` **preview** call against a
   `/companies/<companyKey>/...` path, forwarding `DA_TOKEN` as
   `Authorization: Bearer $DA_TOKEN`; assert on the HTTP status.
2. If that returns non-2xx, retry the same call forwarding `DA_TOKEN` via an
   `x-content-source-authorization` header instead (a known `admin.hlx.page`
   quirk: it can `401` on the `Authorization` form even with a valid token).
3. A 2xx on either form means `DA_TOKEN` can publish — proceed; the mint 403
   is irrelevant. Only if **both** header forms return non-2xx is there a
   real blocker — and surface it as "publish failed against `admin.hlx.page`
   (status N)", not "the token can't mint". Do not offer fallback token
   paths.

**Publish path/ref convention (avoids the guard/ref confusion).** DA-managed
content previews and publishes with **`REF=main`** and the full DA path
`/companies/<companyKey>/en/<doc>`, i.e.
`https://admin.hlx.page/{preview|live}/{org}/{repo}/main/companies/<companyKey>/en/<doc>`
— **not** the demo branch as the ref. The publish guard's URL regex reads the
segment after `{org}/{repo}` as the ref; if you pass the demo branch (or a
`/`-containing branch like `demo/apple-2`) as that segment it mis-parses the
company folder as part of the path. Use **explicit per-path publish calls**
(one URL per doc) rather than a shell loop over a variable — the guard
deliberately blocks shell-variable paths, and explicit paths also make the
per-path publish report auditable.

**Capture the base brand's current values — before any edit.** Every
later residue/applied check needs the base brand's values as they are on
THIS repo right now — never a value frozen into this doc. **Do not read or
copy any brand hex from this document** (there are none, deliberately). Run
the capture script from the worktree, before Step 4b touches anything:

```
node .claude/skills/rebrand-portal/scripts/rebrand/capture-base.mjs
```

It reads `styles/styles.css` and `icons/` and writes a `baseBrand` block
into `.internal/onboarding-state.json`:
`baseBrand.baseSlug`, `baseBrand.baseSurfaceHex`,
`baseBrand.tokens.*` (light/primary/secondary/text/link/accent),
`baseBrand.welcomePanelBg`, `baseBrand.welcomePanelAccentRgb`,
`baseBrand.navHeight`, and `baseBrand.oldHexes` (the old→new residue map's
old side). Every check below keys off these state fields. When the
template's base brand changes, nothing in this doc changes — the script
reads whatever the tree holds.

Also confirm the brand inputs before the delegation: the new brand name
(`customer.name`), the source site to extract the look from, and that the
customer wants the full scope — design tokens AND asset colors AND
content-register rewrite AND publish AND landing via PR. Don't proceed
without a source site, or on a vague "update the styles."

## Step 4b–4f — The delegation (`rebranded`, `published`, `landed-via-pr`)

Issue one comprehensive request covering all of the following — don't
split it across turns:

1. **Design tokens and typography** — invoke `excat-complete-design-expert`
   in **Complete Migration** mode (site design system + all blocks),
   naming the source site if given. Its CSS is branch-global (correct —
   the demo previews on this branch). Point its visual verification at the
   copied `/companies/<companyKey>/...` pages. Do not substitute manual `styles.css`
   edits. **Rebrand the FULL palette, not just the accent** — primary,
   secondary, **background/surface tokens, and every decorative brand
   background** (e.g. a coffee-bean hero/section background, a tinted
   filter/facets panel). The base site ships a themed background (cream
   sections + a decorative brand SVG); if only the primary color changes,
   those backgrounds survive off-brand. Name `baseBrand.baseSlug` (from the
   capture step) so the agent knows exactly what to replace.
   **Name the exact base surface tokens/assets that MUST change (not just
   `--primary-color`)** — verified still-base-surface live:
   - `--light-color` (value = `baseBrand.baseSurfaceHex`, in
     `styles/styles.css`) — the base surface behind the search hero
     (`blocks/search-bar/search-bar.css`), the **filter/facets panel**, and
     section backgrounds. This is the single token behind gap "filter
     background is off-brand"; if it is not rebranded the whole portal stays
     the base surface color.
   - the `.<baseSlug>-background-*` section-style classes and
     `styles/backgrounds/big.svg` (the decorative brand mark).
   - **Login/welcome split-screen tokens.** The left brand panel is themed
     by CSS variables with the base brand's defaults — set them in the brand
     theme so the login rebrands: `--welcome-panel-bg` (panel colour, base =
     `baseBrand.welcomePanelBg`), `--welcome-panel-accent-rgb` (glow, base =
     `baseBrand.welcomePanelAccentRgb`),
     `--welcome-panel-mark-image` (→ `url('/icons/<companyKey>-beans.svg')`),
     and the tagline — set as **two separate line properties**,
     `--welcome-tagline-line1` and `--welcome-tagline-line2` (each a quoted
     CSS string, no line-break escapes inside them — the stylesheet inserts
     the break between the two). Do not reintroduce a single
     `--welcome-tagline` property with a `\A` escape baked into its value:
     a line-break escape only renders when parsed directly in a stylesheet
     content string, not when it's stored inside a custom property and
     substituted via `var()` — that was a real bug in an earlier revision.
     Leaving these unset keeps the base brand's panel colour + tagline
     (the CSS defaults) on the customer's login.
   - **Sign-in link target — `/auth/login`, NOT `/companies/<companyKey>/auth/login`.**
     If the welcome doc carries a Sign in link/button, author its `href` as
     **`/auth/login`**. The worker's auth routes are hardcoded at `/auth/*`
     (`AUTH_PREFIX = '/auth'` in `cloudflare/src/auth.js` is **not** prefixed
     with `DEMO_BASE_PATH`), so a `/companies/<companyKey>/auth/login` link falls
     through the auth router, hits `withAuthentication` unauthenticated, and
     redirects back to the welcome page — an infinite loop with no way to
     sign in. This shipped broken on a live demo; Step 4g's sign-in redirect
     check is the gate that catches it.
2. **Brand assets + hardcoded colors** — separately in scope, and the
   most-missed step:
   - **Logo/wordmark swap (all instances) — MANDATORY, and the single
     most-missed step.** This is not optional and not "leave it if there's
     no logo": leaving the base shortcode makes the header render an **empty
     circle** (the shortcode points at an icon that no longer exists) and
     the login page keep the base brand's mark. Do all of the following and
     do not mark `rebranded` done until the residue check (Step 4g) is clean:
     1. **Produce a real brand mark for the company.** Prefer the source
        site's own logo/favicon (fetch it from the `--source-url` given for
        the look); if none is available, generate a minimal wordmark SVG
        from the brand name. Register it in the repo as
        `/icons/<companyKey>-icon.svg`. **The base uses TWO marks —
        `<baseSlug>-icon` (nav/wordmark) AND `<baseSlug>-beans` (the large
        login-panel mark) — so you MUST create BOTH `/icons/<companyKey>-icon.svg`
        AND `/icons/<companyKey>-beans.svg`.** A shortcode with no matching
        SVG renders an empty circle / broken image (verified live on the
        login page — two broken marks). Never leave a shortcode that
        resolves to a missing icon; confirm both files exist before publish.
        **Never add a per-company CSS size override for the nav logo** (e.g.
        a new `.icon-<companyKey>-icon` selector) — `header.css`'s
        `.nav-brand .icon img` rule is meant to constrain by `max-height`
        against `--nav-bar-height` so any logo aspect ratio (wide wordmark
        or square mark) fits the header row. A brand-specific pixel override
        is a sign the shared rule regressed; fix the shared rule instead
        (Step 4g's `verify.mjs --only header-logo` checks the actual rule).
     2. **Swap the icon shortcode in EVERY DA doc that carries it** — the
        base brand's logo appears in **multiple** places: the DA `nav` doc,
        the DA **`footer`** doc, AND the login/`welcome` page, as EDS icon
        shortcodes like `:<baseSlug>-icon:` / `:<baseSlug>-beans:` (rendered
        `class="icon icon-<baseSlug>-icon"`). Replace each with the new
        brand's shortcode (`:<companyKey>-icon:` etc.) in nav AND footer AND
        welcome. A swapped header with a stale footer or welcome logo is the
        classic failure — verified live to still read `icon-<baseSlug>-*`.
     3. **Repoint every repo asset + CSS reference** — `<baseSlug>_logo.svg`,
        `<baseSlug>-beans.svg`, CSS `url('/icons/<baseSlug>…')`,
        `.icon-<baseSlug>…`.
     4. **Rebrand the browser-tab favicon.** Replace the repo `favicon.svg`
        AND `favicon.ico` (repo root) with the brand mark — these are
        branch-global and `head.html` references them by fixed root path
        (`/favicon.svg`, `/favicon.ico`), so replacing the files rebrands
        the tab icon without touching `head.html`. The base `favicon.svg`
        carries the base brand's `aria-label` (e.g. `aria-label="Frescopa"`
        at the time of writing, along with its `fill` hex) — check the
        current `aria-label`/`fill` on the unedited `favicon.svg` before
        Step 4b; either still present afterward is a giveaway it wasn't
        replaced.
   - **Hardcoded fills / embedded raster — replace them as part of THIS
     edit, not as a later 4g discovery.** SVG icons with a literal
     `fill="#hex"` or background SVGs with embedded raster, and CSS/JS
     literals not wired to a token (the search-results `theme.css` scale,
     `hero.css` tints, chart palettes in `scripts/analytics/*`), don't follow
     the `:root` tokens — each needs its own file edited to the new palette.
     **Hand the design agent the old→new hex map up front:** the old side is
     `baseBrand.oldHexes` (captured above); instruct it to grep-and-replace
     every one across `icons/`, `styles/`, `blocks/`, and `scripts/analytics/`
     **before returning**, including the known-repeat-miss files listed in
     `docs/step-4g-verification.md`. Doing this in the edit step (not
     reactively at 4g) is the difference between 4g finding zero residue and
     4g finding forty (verified live: a token-only rebrand left ~40 literals
     that 4g then had to hunt across two commits).
   - **Zero-residue rule.** After the swap, grepping `baseBrand.baseSlug` and
     every `baseBrand.oldHexes` value across the repo (`icons/`, `styles/`,
     `blocks/`, `scripts/analytics/`) AND the copied `/companies/<companyKey>/…` DA docs
     must return **nothing** except a documented, intentional placeholder.
     `scripts/rebrand/verify.mjs --only residue` runs exactly this grep — it
     must pass.
3. **Content-register rewrite** — rewrite the **DA documents copied in
   Step 3**, i.e. the authored page content, **not** source-code strings.
   **Scoped to the company folder only** (`customer.daFolder`): rewrite
   the pages under `/companies/<companyKey>/...`, never the shared root. For each
   page rewrite the actual copy to match the new brand's real subject
   matter, not just a name swap. Show a before/after diff before
   publishing. Express it as a **scoped page-URL update**: hand the design
   skill/agent the **explicit list of `/companies/<companyKey>/…` page URLs** with
   scope restrictions — change *only* pages **inside** `/companies/<companyKey>`; do **not** touch the
   shared **root** (`/en/...`, `/nav`, `/footer`) or any page outside
   `/companies/<companyKey>`; have it identify the files first and report modified
   files after. **The rewrite list MUST include the company-scoped `nav`,
   `footer`, and login/welcome copies** —
   `/companies/<companyKey>/en/nav`, `/companies/<companyKey>/en/footer`, and
   `/companies/<companyKey>/public/welcome`. These are **copies** (Step 3), not the
   shared root, and they carry the brand logo shortcode, tagline, contact
   details, and copyright — rewriting the pages but skipping the footer is
   exactly how a Fréscopa footer (logo + "© … Fréscopa") survives on an
   otherwise-rebranded portal. Rewrite the copy AND swap the logo shortcode
   in each. (Only the **shared root** nav/footer are off-limits; the
   `/companies/<companyKey>` copies are in scope.) Never hand it "the whole site" or
   an un-prefixed path.

   **Preserve the login page's `welcome` section style — never flatten it.**
   The split-screen login (left brand panel / right sign-in) is driven
   purely by the `.section.welcome` section style (a `Section Metadata`
   `Style: welcome` on `/companies/<companyKey>/public/welcome`) plus the
   `--welcome-panel-*` tokens from step 1. The rewrite MUST keep the
   `welcome` **section wrapper and its Section Metadata** intact and swap
   BOTH marks (`:<companyKey>-icon:` and `:<companyKey>-beans:`) — it must
   NOT collapse the page to plain paragraphs. A rewrite that drops the
   section style renders the login as a single off-brand column with broken
   marks (verified live). After rewrite, the published
   `/companies/<companyKey>/public/welcome.plain.html` must still contain
   `<div class="welcome">` (i.e. `.section.welcome`).
   (The site-wide design tokens from step 1 are the deliberate global
   exception; this per-page content step stays scoped.)

   **Source-derived category contract — mandatory handoff to assets.**
   Before rewriting any Browse/category cards, derive one category contract
   from the source site. It is the only vocabulary shared by homepage cards,
   facet links, asset `productCategory`, and collections. Derive it from
   source-site navigation, product/category sections, URL paths, headings,
   nearby product text, and asset/page context. Do **not** hardcode
   brand-specific category examples in the skill, and do not choose a
   generic category set when source-site categories are clear. Normalize
   labels to stable lowercase slugs and keep `{slug, label, evidence}` for
   each category in the working notes handed to Step 5.

   **Category floor — propose at least 5 real candidates.** This initial
   contract must name **at least 5** real, source-derived candidate
   categories before handing off to Step 5 (`MIN_CARDS` in
   `scripts/assets/constants.js` is `5` — the same floor Step 5's card gate
   enforces on the surviving, actually-enriched categories). If genuine
   derivation from the source site yields fewer than 5 real candidates, say
   so plainly and widen derivation — check more nav sections, product pages,
   disease/category pages, business-line listings — before handing off; don't
   hand Step 5 a sub-5 contract and expect it to backfill the gap later. This
   is a *candidate* floor, not a guarantee of survival: Step 5 may still find
   that one of these candidates has zero real assets after scraping, in
   which case Step 5's own floor rule (`docs/step-5-assets.md`) governs
   whether to widen, drop, or use a last-resort placeholder for that one.

   Ask the customer to choose categories only when the source site is
   genuinely ambiguous after inspection. Otherwise state the decision
   plainly: "I found these usable categories from the source site: <derived
   categories>. I'll use them for cards, filters, asset metadata, and
   collections." Do not mix that answer with lint output, CSS details,
   copied-content bugs, branch mechanics, script names, or any other
   operator/debug narrative.

   **Also rewrite two things INSIDE those docs that a label-only rewrite
   misses (both verified broken live):**
   - **Internal links → company-scoped.** The copied docs carry links that
     still point at the shared root, and DA/docx import can emit them as
     `file://` URLs — e.g. the `nav` logo link was authored
     `href="file:////en/"`. The header only re-scopes links inside
     `.nav-brand`/`.nav-sections`, so a logo link in a `data-role="tools"`
     block stays `/en/…`, lands **outside** `/companies/<companyKey>/`, and 404s.
     Rewrite every internal link in the copied `nav`/`footer`/`welcome` to
     drop any `file:` scheme and prefix the company folder: `/en/…` →
     `/companies/<companyKey>/en/…` (the logo/brand link included). Do this for
     **every copied page, not just nav/footer/welcome** — the home page's
     category cards, "Browse" links, and hero CTAs also carry bare `/en/…`
     links that drop the company folder. After rewrite, **no** copied doc
     may contain a `file:` link or a bare `/en/…` link. (The worker now
     also self-heals a stray root-locale link — `/en/*`→`/companies/<companyKey>/en/*`
     — so navigation no longer falls out of the folder, but scoping the
     links avoids a redirect flash and keeps the content correct.)
   - **Filter/facet slugs → the enrichment vocabulary.** The home "Browse
     by category" cards (and any curated filter links) encode the filter in
     the href as `…/search?facetFilters={"productCategory":{"<slug>":true}}`.
     A label-only rewrite renamed the card text (e.g. "Sedans", "SUVs") but
     left the **base slugs** (`coffee`, `machine`, `accessory`, `lifestyle`)
     in the href — so clicking a card filters on a value no asset carries
     and returns **0** results. Rewrite each card's `productCategory` (and
     campaign/channel) slug from the source-derived category contract, then
     hand that exact contract to Step 5 so the cards and tagged assets agree
     by construction. Never publish a card whose slug is not in the contract.
4. **Publish** — publish **only `/companies/<companyKey>/...` paths** via Helix
   Admin (`admin.hlx.page` preview+publish with `HLX_ADMIN_TOKEN`), over
   exactly the documents copied in Step 3 and rewritten in step 3 above —
   **including the login page `/companies/<companyKey>/public/welcome` and the
   `/companies/<companyKey>/config` tree — which MUST include
   `/companies/<companyKey>/config/access/application` and
   `/companies/<companyKey>/config/access/users`** (without these the foldered
   portal's login is broken/unbranded). **The worker reads the
   COMPANY-scoped access sheets** (`companyBasePath()/config/access/*`, not
   the root ones) for login and permission gating, so if those sheets are
   missing/unpublished under `/companies/<companyKey>` — or landed as `.xlsx` media
   instead of a `.json` sheet — login fails with "User not allowed to
   access this application" (verified live). This is **ours**, not excat's. It is **never**
   `not-applicable` — Step 3 already proved content exists. Build the
   publish list from the copied `/companies/<companyKey>/...` paths — never "the
   whole site," never a root path. **Guard:** before publishing, assert
   every path is prefixed with `customer.daFolder`; abort if any isn't
   (the `guard-da-publish.sh` hook enforces this independently). Poll each
   job to completion and report confirmed per-path success/failure.
5. **Apply the demo scope config (`demo-company-set`)** — edit
   `cloudflare/src/config.js`: set **`DEMO_COMPANY: '<companyKey>'`** and
   **`DEMO_BASE_PATH: '/companies/<companyKey>'`** (the same key as the branch, the
   DA folder, and the asset company). This is **mandatory and must be
   committed to the PR** — the per-PR worker (I3) is built from this file,
   so it is what makes the preview's company filter, `/<company>` routing,
   and `/companies/<company>/public/welcome` login actually work.
   `.claude/skills/rebrand-portal/scripts/assets/enrich-assets.js` also writes both keys in Step 5, but
   do it here too so the preview is scoped and working immediately after
   Step 4, even when asset enrichment is deferred to a later step. Mark
   `demo-company-set` `done`.
6. **Land as one PR** — on `customer.demoBranch`. Finish tokens, assets,
   content, **and the `config.js` scope edit** first, stage everything,
   then commit → push → open the PR as one sequence. **The PR diff MUST
   include `cloudflare/src/config.js`** — if it doesn't, the deployed
   preview worker keeps the wrong company and root routing (the exact
   failure this flow fixes); verify the diff before opening. Per I3,
   **opening** the PR (not merging) is the finish line — the branch
   preview serves it; do not merge, never close/delete it (I5). If CI
   blocks, only fix checks that fail on your branch but pass on `main`.
   **Immediately after `gh pr create` returns, give the customer the PR
   URL it prints** (plain sentence, e.g. "Here's the pull request: <url>")
   — this is the shareable result (I3), not an internal artifact, so I1
   does not apply to it.

   **Then poll for the deploy job and hand over the actual portal URL, not
   just the Actions run link.** The "Deploy branch worker" job's log line
   contains the exact route the worker deploys to — the customer-facing
   portal URL — so parse it instead of making the customer read the log
   themselves:
   ```
   gh pr checks <PR> --watch   # wait for deploy to reach a terminal state
   RUN_ID=$(gh run list --branch customer.demoBranch -L 1 --json databaseId --jq '.[0].databaseId')
   HOST=$(gh run view "$RUN_ID" --log 2>/dev/null \
     | grep -m1 -- '--route' \
     | grep -oE '\-\-route "[^"]+"' \
     | sed -E 's/--route "//; s|/\*"$||')
   ```
   `$HOST` is the live portal host (verified: yields e.g.
   `demo-microsoft.dev.frescopamedia.com`, no quotes/no trailing `/*`).
   Report it plainly: "Here's the pull request: <pr-url>. The live preview
   is deploying — once it finishes you can open it here:
   `https://$HOST/companies/<companyKey>/en/`."
   If the deploy job hasn't completed yet (log line absent), say building
   is still in progress and give the Actions run URL as a fallback watch
   link, framed as "you can watch the build here: <url>" — don't block the
   rest of Step 4 on deploy completion, this is a one-time follow-up
   message once it lands.

Mark `rebranded`, `demo-company-set`, `published`, and `landed-via-pr`
`done` as each completes.

