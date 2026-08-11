---
name: customer-migration
description: Full customer migration for a forked Assets Hub Spark repo — rebrand the site's design/content via Catalyst, then get the backend (Cloudflare, Content Hub, local dev) running. Use when a customer forks this repo and asks to rebrand/restyle the site, or asks to get the portal/site running locally, or asks for a full migration/onboarding — any of these trigger the same one skill, run in order (rebrand first, backend second). Not for initial site migration into EDS (a different, prior step).
---

# Customer Migration

One skill, two phases, run in order: **Phase A — rebrand via Catalyst**,
then **Phase B — backend onboarding**. Whichever phase the customer's
request matches, load this skill and start at the right phase; if a
request only matches one phase, still check the shared state file (below)
to know whether the other phase already happened, so you don't repeat
work or skip a dependency.

**Never name this skill, its file, or its phases to the customer.**
Describe outcomes only — "let's start with the visual rebrand, then get
the backend running locally," not "Phase A of this skill" or "the
customer-migration skill's instructions say." This applies throughout
both phases below; none of the internal headings, step names, or file
paths in this document are for the customer to hear.

## Shared state file

Both phases read and write the same `.internal/onboarding-state.json`
(gitignored via the existing `.internal` entry — do not add a new ignore
rule). This is the resumability mechanism for both phases: if the
customer leaves mid-flow and comes back in a new session, re-read this
file first and resume at the first non-`done` step in whichever phase is
incomplete, rather than re-asking already-answered questions.

Schema:

```json
{
  "schemaVersion": 1,
  "customer": {
    "name": null,
    "githubOrg": null,
    "githubRepo": null,
    "aemEnvId": null,
    "authBypassActive": null
  },
  "phases": {
    "rebrand": {
      "status": "in_progress",
      "lastUpdated": null,
      "steps": {
        "brand-inputs-collected": "pending",
        "permissions-checked": "pending",
        "design-tokens-applied": "pending",
        "asset-colors-swept": "pending",
        "content-register-rewritten": "pending",
        "published": "pending",
        "landed-via-pr": "pending",
        "asset-color-sweep-verified": "pending"
      }
    },
    "backend-onboarding": {
      "status": "in_progress",
      "lastUpdated": null,
      "scopeChoice": null,
      "steps": {
        "node-version-check": "pending",
        "fork-identity-resolved": "pending",
        "code-sync-verified": "pending",
        "helix-url-and-readme-corrected": "pending",
        "tier-selected": "pending",
        "content-hub-creds-collected": "pending",
        "auth-mode-applied": "pending",
        "boot-verified": "pending",
        "deploy-bypass-gated": "pending",
        "intake-file-generated": "pending",
        "repo-identity-rename-applied": "pending",
        "remote-secrets-pushed": "pending",
        "remote-d1-migrated": "pending",
        "ci-token-set": "pending",
        "deployed-via-merge": "pending"
      }
    }
  }
}
```

Step values are one of `pending`, `done`, or `blocked` (blocked = waiting
on something external — the customer fetching credentials, provisioning
Cloudflare resources, or installing Code Sync). Update `lastUpdated` and
the relevant step every time you complete or block on a step.

The `backend-onboarding` steps split along two axes, and phase
completion respects that split:

- **Run-tier steps** (`node-version-check`, `fork-identity-resolved`,
  `code-sync-verified`, `helix-url-and-readme-corrected`,
  `tier-selected`, `content-hub-creds-collected`, `auth-mode-applied`,
  `boot-verified`) — getting the portal running locally at the customer's
  chosen tier.
- **Deploy-only steps** (`deploy-bypass-gated`, `intake-file-generated`,
  `repo-identity-rename-applied`, `remote-secrets-pushed`,
  `remote-d1-migrated`, `ci-token-set`, `deployed-via-merge`) — only
  relevant if the customer wants to deploy.

A customer who only wants to run locally leaves every deploy-only step
`pending` — that is **not** an incomplete state, it's a complete, valid
end state. Set `phases["backend-onboarding"].status` to `"done"` when the
run-tier steps for the chosen tier are done (a `"preview"` tier needs
fewer than a `"local-login"` tier — see B.5). Do not hold the phase
`in_progress` waiting on deploy-only steps the customer never asked for.

`backend-onboarding.scopeChoice`
(`null` / `"preview"` / `"local-no-login"` / `"local-login"`)
is different from a step: it's revisitable, mutable state, not a
forward-only completion marker — a customer can pick `"preview"` now
and ask for more later, in this session or a future one. It
lives alongside `status`/`lastUpdated`, not inside `steps`, precisely
because it can change after being set. See B.5 below for how it's used.
These are internal values only — never shown to the customer.

If the file doesn't exist, create it with the schema above before doing
anything else in either phase. If it exists, read it and jump to the
first non-`done` step in the relevant phase — do not redo completed steps
or re-ask questions whose answers are already recorded under `customer`.

## Companion file: customer-config intake (Phase B only)

`.internal/customer-config.json` (also gitignored, same convention) holds
non-secret Cloudflare identity/resource values the customer must look up
themselves. Generated in the deploy stage (step D.2), and only when the
customer actually wants to deploy — not needed to run locally. Not used
by Phase A.

---

# Phase A — Rebrand via Catalyst

Rebrand the site's design/content to a new brand identity. Runs entirely
inside Catalyst — design tokens, asset colors, content register rewrite,
and publish all depend on Catalyst's own workspace preview and Document
Authoring integration, which work independently of whether the fork's
backend (Cloudflare, Code Sync to the public `.aem.page` URL) is set up
yet. Do not defer this phase waiting on Phase B — it doesn't need it.

**Do not treat this as "just run the design-tokens tool."** A generic
design-migration tool extracts a *source* site's brand during initial
migration — it has no concept of rewriting an already-migrated site's
content register or sweeping hardcoded asset colors. Those are this
phase's job, wrapped around that tool as one step of a larger request.

## A.1: Pre-requisites

Do these before touching any file. Ask the customer directly — these
cannot be discovered mid-task without risking a stalled rebrand.

### A.1.a: Permissions checklist (`permissions-checked`)

Tell the customer to confirm both of these are enabled in Settings → LLM
Permissions before starting:

- **Admin access** — covers Helix admin preview/publish AND, via the same
  Adobe IMS session, Document Authoring read/write. If DA still returns a
  401 right after enabling this, that's expected IMS-session propagation
  lag or an Adobe sign-in prompt — not a missing separate toggle.
- **Git access** — required for committing/pushing/opening a PR.

State the hard rule plainly: never accept a pasted token or secret in
chat — this covers the IMS session above and the `DA_TOKEN`/
`HLX_ADMIN_TOKEN` below equally. If any token appears in the
conversation anyway, treat it as compromised, tell the customer to
revoke/rotate it immediately, and do not use it.

### A.1.d: DA / Helix Admin tokens (`token.env`)

Any Document Authoring or Helix Admin API call this phase makes on the
customer's behalf (preview, publish, status) authenticates with two
tokens the customer supplies — not the IMS session above. Set these up
before the first such call:

- Ask the customer to create a gitignored `token.env` at the repo root
  with exactly two lines, `KEY=value` format, no quotes:
  `DA_TOKEN=...` and `HLX_ADMIN_TOKEN=...`. The customer fills in the
  values themselves; you never read them back or echo them.
- Confirm `token.env` is gitignored. If the repo's `.gitignore` has no
  `token.env` entry, add one — do not rely on it being covered by
  another pattern.
- Read the values from `token.env` at call time (via the environment /
  file), never from chat. This is the same never-paste rule as A.1.a.

Known API quirk, state it so it isn't rediscovered by trial and error: a
preview/publish call to the Helix Admin API (`admin.hlx.page`) can return
`401` **even with a valid `DA_TOKEN`**, because the Admin API's own
server-side fetch back to Document Authoring needs that token forwarded
via an `x-content-source-authorization` header. A 401 of this shape is a
missing-forwarded-header problem, not an invalid-token problem — add the
header rather than assuming the token is wrong.

### A.1.b: Content-source context

Tell the customer once, before any content work: local
`content/**/*.plain.html` files in the workspace are for local
dev-server preview only and have zero effect on the hosted
`.aem.page`/`.aem.live` site. The real source of truth is the Document
Authoring document. This is why "publish" is a real, separate step later.

**Also state, up front, before any publish step happens:** Document
Authoring content and repo code (CSS tokens, SVG icons, JS) are two
independent systems with two independent triggers. Publishing DA content
takes effect immediately. Code changes take effect only once the branch
is **merged** and Code Sync picks it up — an open, unmerged PR means the
code's visual effect is **not live**, no matter how correct or complete
the code itself is. Don't lose track of this later in this phase: never
declare the rebrand "complete and live" while a PR is still open.

### A.1.c: Brand inputs — confirm full scope (`brand-inputs-collected`)

Ask for:

- New brand name. Write it into `customer.name` in the state file.
- Source site to extract the look from, if there is one.
- **Explicit confirmation the customer wants the full scope**: design
  tokens AND hardcoded asset colors (icons, background graphics) AND
  content register (rewritten copy, not just a name swap) AND publish
  AND landing the change via git/PR. Do not proceed on a vague one-line
  request like "update the styles" — that under-specifies scope and
  produces a design-tokens-only result, leaving the rest undone silently.

## A.2: The delegation request

Once A.1 is confirmed, issue one comprehensive request covering all of
the following. Do not split this into separate turns/requests — the goal
is stating the full scope up front so the design-migration tool and your
own judgment handle it correctly in one pass, rather than piecemeal.

1. **Design tokens and typography** (`design-tokens-applied`) — invoke
   the design-migration tool in its full/complete migration mode, naming
   the source site if one was given.
2. **Hardcoded asset colors** (`asset-colors-swept`) — explicitly in
   scope, separate from step 1: check SVG icon files and background
   image assets for hardcoded fill colors and embedded raster art that
   don't match the new palette. CSS custom properties do not affect
   these — a background SVG with an embedded raster pattern, or an icon
   SVG with a literal `fill="#hex"`, needs its own file edited, not just
   `styles.css`.
3. **Content register rewrite** (`content-register-rewritten`) — for
   every content page, rewrite the actual copy to match the new brand's
   real subject matter and business, not just substitute the old brand
   name for the new one. Show a before/after diff for review before
   publishing.
4. **Publish** (`published`) — use the real Document Authoring
   upload/preview/publish flow. This polls the underlying job to real
   completion and returns confirmed per-path success/failure — trust and
   report that result, don't treat the initial upload response alone as
   proof anything published.
5. **Land the change as one combined commit → push → PR**
   (`landed-via-pr`) — finish *all* of the above (tokens, assets,
   content) first, stage everything, and only then commit, push, and
   open the pull request as a single sequence. Do not open a PR and then
   continue pushing follow-up commits to that branch afterward — if more
   work is needed after a PR is already open, go back and finish it on
   the branch before the PR is opened, not after. **Opening the PR is
   not the finish line for the code portion of the rebrand — merging
   is.** Say this plainly to the customer: the code changes exist but
   are not yet live.
   - If CI checks block the merge, check whether the same checks already
     fail on `main` before assuming you broke something — only fix
     checks that fail on your branch but pass on `main`.

## A.3: Verification

After the delegation request completes, run this check, then confirm
completion — do not skip straight to declaring the rebrand done.

**Completion is gated on the PR actually being merged, not opened.**
Content published via DA is live immediately, but if the code PR is
still open, the styling/asset/content-register code changes are **not
live** — say so explicitly rather than reporting "complete and live." If
the customer wants to stop with the PR open for review, that's a valid,
different end state: report it as "code changes ready for review, not
yet live" — not as done.

Once the PR is confirmed merged, run the asset-color sweep below against
the **merged, live** site — not just the local working tree or open
branch.

### Asset-file color sweep (`asset-color-sweep-verified`)

Grep the repo's SVG and image assets for hardcoded hex/color values that
still match the *old* brand's palette — a generic visual-comparison
check typically only compares computed CSS style values, so a stale
background image would score as "matching" as long as its file path/URL
didn't change; this sweep catches what that check structurally cannot.

- Check icon SVGs for `fill="#..."` values.
- Check background image/SVG assets referenced via `background-image`
  for embedded raster art or hardcoded panel colors.
- Not every hardcoded fill is wrong — a dark neutral resting-state icon
  color that turns brand-colored on hover is a legitimate design
  pattern. Take an actual screenshot of the pages/sections in question to
  confirm visually whether a flagged file actually reads as off-brand.

Report any real misses found, fix them, and re-check before considering
Phase A complete. Set `phases["rebrand"].status` to `"done"`.

## Phase A completion report

Summarize plainly: what's rebranded and confirmed live (post-merge); the
new brand name and any before/after content highlights; any known
follow-up (e.g. a placeholder logo mark pending the customer's real
licensed asset). Then, since backend onboarding is a separate, real need
for actually running this locally: ask whether the customer wants to
continue straight into getting the site running locally now (Phase B),
or stop here. If they say no, that's a complete, valid end state — the
rebrand doesn't require Phase B to be "done."

---

# Phase B — Backend onboarding

Get the customer's forked copy of Assets Hub Spark booting locally, with
a correctly reported auth state and real search working against their
own Adobe Content Hub environment — and make sure every file in the repo
that currently identifies the *upstream template* (its GitHub org/repo,
Cloudflare worker/account/resource ids, domain) instead identifies the
*customer's own fork*. Never creates cloud resources itself, never
deploys, and never stores or transmits real secret values — edits local,
gitignored files, writes non-secret resource identifiers the customer
supplies, and tells the customer where to paste actual secrets
themselves.

**Out of scope, on purpose:** the branding/content work is Phase A above,
not repeated here. If Phase A hasn't run yet and the customer only wants
backend/local-dev help, that's fine — proceed with this phase
independently; branding remains something they can come back for later.

**Never hardcode this template's own identity.** Nothing in this phase's
own logic should assume the literal strings `assethub-spark`,
`aem-showcase`, `spark-eds`, `spark.aem.media`, or any other value found
in the inventory below. Always *derive* the current ("old") values by
reading the fork's own files at run time, and *derive* the new values
from what the customer supplies.

## B.1: Node version check (`node-version-check`)

Read `.nvmrc` at the repo root for the required Node major version. Run
`node --version` and compare. If it doesn't match, stop and tell the
customer to switch (e.g. `nvm use`) before continuing — do not proceed on
a mismatched version, since `npm install` will emit engine warnings and
dependencies (wrangler, vite, etc.) may misbehave silently.

Once matched: if `cloudflare/node_modules` is missing, run `npm install`
at the repo root (recurses into `cloudflare/` via `postinstall`). Mark
step `done`.

## B.2: Fork identity resolution (`fork-identity-resolved`)

Do not ask the customer for their GitHub org/repo — derive it:

```
git remote get-url origin
```

Parse `{org}/{repo}` from the URL. Write these into `customer.githubOrg`
/ `customer.githubRepo` in the state file (skip re-deriving if Phase A
already populated these). Mark step `done`.

If there is no `origin` remote, ask the customer directly instead, then
proceed the same way.

## B.3: AEM Code Sync verification (`code-sync-verified`)

Using the org/repo from B.2, probe a path that actually has content —
**not** the bare root. This template's real content lives under `/en/`,
and a bare-root `/` almost always 404s even when Code Sync is perfectly
installed (no document is published at `/index`). Probing `/` and
reading its 404 as "not installed" is a false negative that will misfire
for nearly every fork.

```
https://main--{repo}--{org}.aem.page/en/
```

Fetch it (a `curl -sI` for headers is enough). Determine the result:

- **200** → Code Sync is installed and working. Mark step `done`.
- **404 with an `x-error: Lambda: ...` response header** → Code Sync
  **is** installed (the content-bus Lambda is running and answering),
  but nothing is published at this path yet. Do not tell the customer to
  install anything. Explain that content just needs to be published (a
  Phase A publish, or their own DA publish) — the fork's plumbing is
  fine. Mark step `done` (installation is verified; content is a
  separate concern handled elsewhere).
- **404 with no `x-error: Lambda:` header** (or a "site not found"
  response) → Code Sync is genuinely not installed yet. Explain plainly
  that this is a required one-time GitHub-side step the customer must do
  themselves (the agent cannot install a GitHub App on their org):
  install the AEM Code Sync GitHub App on their forked repository. Point
  them to the aem.live documentation for exact steps (look it up, don't
  guess the URL). Mark step `blocked`, explain you'll re-check once
  they've done it, and stop here for this session if they need to go do
  it now.

The `x-error: Lambda:` header is the discriminator: it only appears when
the content-bus Lambda is running, i.e. Code Sync is installed. A bare
`/` 404 on its own is never evidence of anything — always judge from the
`/en/` probe and its headers.

Do not proceed past a genuine "not installed" state on an unverified
assumption — a customer whose Code Sync isn't installed will silently
see the upstream template's own demo content via the `aem up` fallback
proxy instead of their own.

## B.4: Helix URL and README correction (`helix-url-and-readme-corrected`)

Always runs, regardless of what the customer wants next — this needs no
Cloudflare account, no credentials, no intake file. It's a pure text
substitution using values B.2/B.3 already derived, and it matters even
for a customer who only ever wants a local preview: their `aem up`
process and their own README should already point at their own fork, not
the upstream template.

Using the org/repo from B.2:

- Repoint `AEM_PAGES_URL` in `local.sh` (the line with its `:-` default)
  to `https://main--{repo}--{org}.aem.page`.
- Repoint `HELIX_ORIGIN` in **both** `[env.production.vars]` and
  `[env.branch.vars]` of `cloudflare/wrangler.toml` to
  `https://main--{repo}--{org}.aem.live`.
- Correct `README.md`'s Live/Preview URLs and its `AEM_PAGES_URL` example
  row to the same values.

Do not touch `local.sh`'s placeholder `git remote add origin` line — it
only runs inside a guard for repos with no `origin` at all, which is not
this customer's situation (they have a real fork with a real remote).

Show the customer the before/after for these few lines, apply it, and
mark step `done`.

## B.5: Local-run tier choice (`tier-selected`, sets `scopeChoice`)

There are three genuinely different ways to run this locally, and they
cost the customer very different amounts of setup. Offer all three, in
plain outcome language — **never** say `scopeChoice`, the enum values
(`"preview"` / `"local-no-login"` / `"local-login"`), step names, or
"tier." The customer hears outcomes only. Use wording like:

> "There are three ways I can get this running for you:
>
> **1. Just show me the new look** — I'll start it up so you can click
> through your rebranded pages right away. Nothing needed from you.
> Search and sign-in won't work yet — it's a visual preview.
>
> **2. Get it actually working, skip sign-in for now** — real search,
> real assets and thumbnails, browsing your own content, running on your
> machine without making you set up a login. I'll need two values from
> your Adobe Content Hub for this. (Reports and notifications still need
> the deployed version — those won't work locally.)
>
> **3. The full experience, with real sign-in** — same as option 2, plus
> your real Microsoft sign-in so it behaves exactly like production. This
> needs a bit of setup on Microsoft's side from you or your IT team.
>
> Most people start with 1 or 2. Which sounds right?"

Map the customer's answer to the internal value and record it in
`phases["backend-onboarding"].scopeChoice`: option 1 → `"preview"`,
option 2 → `"local-no-login"`, option 3 → `"local-login"`. Mark
`tier-selected` `done`.

**Honest expectations for options 2 and 3, state at choice time** so the
customer isn't surprised later. In the local no-login/fake-admin mode,
these genuinely work: search, asset thumbnails and previews, the
collections list, and the header/user widget (it'll show a "Local Dev"
user). These do **not** work locally and need the real deployed backend:
notifications (the bell), the reports/asset-activity dashboards, and
search/analytics reports — they'll error or come back empty. Opening a
collection you don't own can also be denied. Say this plainly; don't
oversell option 2 as "everything works."

### If `"preview"`

Tell the customer, as a real documented fact (not an improvisation):
running `npx aem up` alone serves the site's raw EDS pages directly. It
does not start the Cloudflare Worker at all — `local.sh` runs the AEM
dev server and the Cloudflare worker as two independent background
processes, and everything in `cloudflare/src/auth.js`/`index.js`
(session cookies, Entra login, `DISABLE_AUTHENTICATION`) lives only
inside the worker process. So preview needs no secrets, no Content Hub
credentials, no Entra app, and none of the deploy steps. Start it, let
them click around, and stop here. Do **not** mark
`phases["backend-onboarding"].status` `"done"` if the customer indicated
they want more later — but if `"preview"` is genuinely all they want,
this is a complete, valid end state and the phase may be `"done"`.

### If `"local-no-login"`

Proceed through the local-run steps: B.7 (Content Hub creds) → B.9
(apply the auth bypass) → B.11 (boot & verify). **Skip the entire deploy
stage** — none of the Cloudflare-account intake, identity rename, or
remote push is needed to run locally. Placeholder resource ids in
`wrangler.toml` are fine for local dev (miniflare simulates the
bindings).

### If `"local-login"`

Proceed: B.7 (Content Hub creds) → B.9 (real Entra, bypass left off) →
B.11 (boot & verify). Same skip of the deploy stage.

### Re-entry / changing the choice later

If the customer previously chose a lighter option and now wants more
(same session or a future one): read `scopeChoice`, and proceed directly
to the next needed step for the new tier — say only the outcome
(*"Good — since you're already running locally, next I'll wire up real
search, which needs two values from your Content Hub."*), never step
names, "resuming," or the stored value. Update `scopeChoice` to the new
value. The same applies for a later request to actually deploy: move
into the deploy stage (below), which is otherwise never entered.

# Phase B — local run (B.7-B.11)

These steps get the portal running locally at the tier B.5 selected.
They are reached for `"local-no-login"` and `"local-login"` (and are
what a later upgrade from `"preview"` runs). None of them needs a
Cloudflare account, the intake file, or the identity rename — those are
deploy-only (the separate stage further below).

## B.7: Content Hub credential collection (`content-hub-creds-collected`)

As mentioned at the tier choice, real search needs two values from the
customer's Content Hub — collect them now. Ask for:

- **`AEM_ENV_ID`** — their AEM Program + Environment ID, `pXXXX-eYYYY`.
- **Content Hub OAuth Server-to-Server credentials** — client ID and
  secret, from an Adobe Developer Console project with access to that
  delivery environment's Dynamic Media / Content Hub API.

Never ask the customer to paste secret values into the chat:

1. Tell them to create `cloudflare/.secrets` (gitignored) from the
   template documented in `cloudflare/README.md` / root `README.md`.
2. Tell them exactly which two lines to add: `SPARK_DM_CLIENT_ID="..."`
   and `SPARK_DM_CLIENT_SECRET="..."`.
3. Confirm with them that they've done it — do not read the file's
   contents yourself to "verify."

The `cloudflare/.secrets` file must **exist** or `wrangler dev` won't
even boot (its `predev` hook hard-fails on a missing file) — so this
step is mandatory for both `"local-no-login"` and `"local-login"`, not
optional.

Also check whether `cloudflare/.secrets` has a `SPARK_COOKIE_SECRET`
line — required by `cloudflare/src/auth.js`'s `REQUIRED_ENV_VARS`
regardless of auth-bypass state. If missing, generate one locally with
`openssl rand -base64 32` and have the customer add it themselves.

Write only the non-secret `aemEnvId` into `customer.aemEnvId`. Mark step
`done` once the customer confirms all three lines are in place.

## B.9: Auth mode — apply the customer's tier choice (`auth-mode-applied`)

This step **acts** on the tier choice — it does not merely report state.
The `DISABLE_AUTHENTICATION` bypass block in `cloudflare/src/auth.js`
(lines ~161-172, inside `withAuthentication`) is a self-contained local
seam: `withAuthentication` only validates a locally-signed session
cookie and never itself contacts Microsoft (the Entra calls live only in
`/auth/login` and `/auth/callback`). Uncommenting that block makes
`withAuthentication` set a fabricated dev user and return, so every
downstream route (search, DM/assets) works with **no Entra config at
all**. Re-commenting restores real login.

**If `scopeChoice` is `"local-no-login"`:** edit `cloudflare/src/auth.js`
to **uncomment** the `DISABLE_AUTHENTICATION` block (lines ~161-172) —
uncomment exactly those lines, nothing else. Tell the customer plainly
this makes everyone a local-only fake admin (`dev@localhost`, `admin`/
`employee` roles), fine for local dev but a security hole if it ever
ships — it must be re-commented before any deploy (the deploy stage
enforces this). Re-state the honest limits from B.5: search, thumbnails,
previews, collections list, and the header work; notifications, reports,
and analytics dashboards do not (they need the deployed backend). Set
`customer.authBypassActive` to `true`.

**If `scopeChoice` is `"local-login"`:** leave `auth.js` untouched
(bypass stays commented, real login active). Walk the customer through a
real Microsoft Entra app registration — reuse the exact steps in the
deploy-readiness note (entra.microsoft.com → App registrations → New
registration → **Single-page application** redirect URI → copy the
Application (client) ID and Directory (tenant) ID) — and have them place
the resulting `MICROSOFT_ENTRA_TENANT_ID`/`MICROSOFT_ENTRA_CLIENT_ID`
into `wrangler.toml`'s `vars` (and `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET`
into `cloudflare/.secrets` if they want SMTP). Set
`customer.authBypassActive` to `false`.

Then set the local run environment for `npm run dev`, regardless of
branch:

- `AEM_PAGES_URL` = `https://main--{repo}--{org}.aem.page` (from B.2/B.3).
- `AEM_ENV_ID` = the value from B.7.
- `DISABLE_AUTHENTICATION` = `true` (this only takes effect for
  `"local-no-login"`, where the block is now uncommented; harmless
  otherwise).

Note `wrangler.toml`'s `HELIX_ORIGIN` isn't consulted by `local.sh` for
local dev (it always points the local worker at the locally-running
`aem up` server) — it matters only for CI/deploy, corrected in B.4
(Helix URL) and the deploy-stage rename (the rest). Mark step `done`.

## B.11: Boot verification (`boot-verified`)

Run `npm run dev` with the environment from B.9. Wait for both the AEM
dev server and the Cloudflare worker dev server to report ready (watch
for the script's own "Ready on http://localhost:{port}" line). Open the
**worker** port in the browser (not the aem-up port) — that's the one
that serves `/api/*`.

Once up, verify, in order:

1. **The server is serving this repo's own local files**, not a stale or
   unrelated cached directory — confirm a distinctive string from a
   local file actually appears in the served output.
2. Auth behavior matches the chosen tier: `"local-no-login"` should let
   you reach the app as the fake dev user with no login prompt;
   `"local-login"` should redirect to Microsoft sign-in.
3. A real search request returns results sourced from the customer's own
   Content Hub environment, and at least one asset thumbnail renders.

If search fails, check in order: wrong/missing
`SPARK_DM_CLIENT_ID`/`SECRET`, wrong `AEM_ENV_ID`, or the Content Hub
technical account lacking access to that delivery environment.

Mark step `done` once verified. If the customer only wanted to run
locally, set `phases["backend-onboarding"].status` to `"done"` — a
running local tier with no deploy is a complete, valid end state. Offer
the deploy stage below only if they want it; never force it.

---

# Phase B — deploy stage (deploy-only, opt-in)

**This entire stage is only for a customer who wants to deploy.** It is
offered *after* a tier is running locally, never as a prerequisite to
running. A customer who only runs locally leaves every step here
`pending` — that is a complete, valid end state, not an unfinished one.

**Who runs what (governs every step in this stage).** The agent
*prepares* — exact commands, edited config, a ready PR — but the
**customer performs** any step that (a) handles a real secret value,
(b) runs under their own Cloudflare/GitHub authenticated session, or
(c) mutates their production environment. The agent's job in each step
is to make it a single unambiguous command (or a one-click merge),
verify the pre-state, and confirm the result after the customer reports
back — never to perform the privileged action itself. The agent never
sees/types/reads back a real secret, and never pushes or merges to the
customer's `main`.

## D.1: Bypass gate (`deploy-bypass-gated`)

Do this **first**, before anything else in this stage. If
`customer.authBypassActive` is `true`, the repo is **not** deploy-ready:
a fabricated admin user must never ship. Re-comment the
`DISABLE_AUTHENTICATION` block in `cloudflare/src/auth.js` (lines
~161-172) — the exact inverse of the edit B.9 made — set
`customer.authBypassActive` to `false`, and tell the customer real login
is now required, which is why the Entra registration (D.6 / the note
below) matters. Refuse to proceed with deploy while the bypass is
active. Mark step `done` once re-commented.

## D.2: Intake file generation (`intake-file-generated`)

Several values need the customer to run a command or look something up
in their own Cloudflare account first — not answerable one-at-a-time in
chat, and needed only for deploy (local dev uses simulated bindings, so
these are irrelevant to running locally). Generate
`.internal/customer-config.json` pre-populated with these fields, each
`null` until filled in:

```json
{
  "cloudflareAccountId": null,
  "workersDevSubdomain": null,
  "workerName": null,
  "productionDomain": null,
  "kvNamespaceId": null,
  "d1DatabaseIds": {
    "userLogins": null,
    "auditEvents": null,
    "searchEvents": null
  },
  "secretsStoreId": null
}
```

Tell the customer, for each field, exactly how to get the value — the
**customer runs** these `wrangler` commands under their own account;
prefer the CLI wherever it gives an unambiguous answer, fall back to a
dashboard path only where no CLI getter exists:

- `cloudflareAccountId` — `wrangler whoami` (or dashboard: Workers &
  Pages → Overview → Account Details).
- `workersDevSubdomain` — dashboard only: Workers & Pages → **Change**
  next to "Your subdomain." If never set, they need to set it now — it's
  account-level, not per-worker.
- `workerName` — their own free choice; suggest a default derived from
  the repo name.
- `productionDomain` — optional. Their own DNS zone already added to
  Cloudflare. May leave blank and stay on `*.workers.dev` only for now.
- `kvNamespaceId` — `wrangler kv namespace create AUTH_TOKENS`.
- `d1DatabaseIds.userLogins` / `.auditEvents` / `.searchEvents` —
  `wrangler d1 create <name>` **once per binding**, three times with
  three different names; each prints its own `database_id`. Must end up
  as three distinct ids.
- `secretsStoreId` — `wrangler secrets-store store create`.

Tell the customer to fill this in at their own pace and let you know
when done. Mark step `blocked` until they confirm, then re-read the
file, confirm every field is non-null (except `productionDomain` if
intentionally skipped), and mark `done`.

## D.3: Repo identity rename (`repo-identity-rename-applied`)

Repoint every remaining file that identifies the upstream template's
*Cloudflare account* rather than this customer's own — everything here
depends on the intake file (D.2), unlike B.4's Helix-URL/README fix,
which already ran earlier and needed no account data. One bulk,
previewed, single-confirmation pass — not file-by-file confirmations,
since every change here is a mechanical substitution of values already
known by this point.

**Gather the substitution map** (old → new), reading old values live
from the files:

- Cloudflare worker name / account id: read `wrangler.toml`'s `name` /
  `account_id` → new values from the intake file.
- Production domain / workers.dev subdomain: read the current
  route/domain literals → new values from the intake file.
- KV namespace id, three D1 database ids, Secrets Store id: read current
  ids in `wrangler.toml` → new values from the intake file. **Note the
  known template bug**: the three D1 bindings currently share one
  `database_id` — the customer must end up with three *distinct* ids
  here, one per database.
- `AEM_ENV_ID`: read the current value in `wrangler.toml` → new value
  from `customer.aemEnvId`.

Mirror var changes into **both** `[env.production.vars]` and
`[env.branch.vars]` — the toml warns to keep them in sync.

**Files to update** (re-derive by searching, this is a starting point,
not a guarantee). Note `README.md` and `local.sh`'s `AEM_PAGES_URL`
default are **not** in this list — B.4 already corrected those, since
they needed no Cloudflare-account data at all:

- Functional/CI: `cloudflare/wrangler.toml`, `cloudflare/scripts/deploy.sh`,
  `.github/workflows/build.yaml`, `.github/workflows/release.yaml`,
  `package.json`, `cloudflare/package.json`, `sonar-project.properties`,
  `cloudflare/src/index.js` (CORS `allowedOrigins` — security-relevant),
  `cloudflare/src/user.js` (the `liveHosts` array — security/access-
  relevant: if the fork's real production host isn't listed, every
  request is treated as preview and requires the `preview` permission),
  `cloudflare/src/api/notifications.js` (default from-email),
  `cloudflare/src/api/analytics.js` (fallback analytics account id, two
  occurrences), `tests/shared/env.js`, `tests/integration/test-public-urls.sh`.
- Documentation (same values, same pass): `ARCHITECTURE.md`,
  `cloudflare/README.md`, `cloudflare/NOTES.md`, `.cursor/rules/aem.mdc`,
  `.github/pull_request_template.md`, `docs/api/API-SECURITY-REVIEW.md`,
  `docs/authoring/getting-started.md`, `docs/authoring/localization.md`,
  `docs/administering/permission-configuration.md`,
  `docs/authoring/blocks/*.md`, `docs/da-content/create-docs.py`,
  `docs/da-content/create-sheets.py`, `tests/integration/README.md`,
  `tests/integration/setup/auth.js`, `tests/integration/test-runner.test.js`,
  `tests/authz/helpers.js`.
- **Do not touch** `cloudflare/src/origin/__tests__/dm-analytics-search-type.test.js`
  — its domain-looking strings are arbitrary test fixture input to a
  referer-parsing function that only inspects the URL path.
- `blocks/search-results/components/adobe-pdf-viewer.js` has its own
  placeholder (`'REPLACE_WITH_SPARK_PDF_EMBED_CLIENT_ID'`) keyed by
  production domain — needs the customer's own Adobe PDF Embed API
  client id, a distinct credential, not derivable from this rename map.
  Note it in the completion report as a follow-up, not a blocker.

**Process:** build the full list of (file, line, old value, new value)
changes, show the complete diff/preview, get one confirmation, apply
all. After renaming `package.json` (root) and `cloudflare/package.json`,
regenerate the lockfiles via `npm install` — do not hand-edit them.

Mark step `done` once applied and confirmed.

## D.4: Push secrets to the remote Secrets Store (`remote-secrets-pushed`)

Critical distinction: the `cloudflare/.secrets` file (from B.7) populates
only the **local** simulated store — it never reaches the deployed
worker. There is no automation that pushes it. The deployed worker's
secrets are set by a **manual, per-secret** command the **customer
runs** under their own `wrangler` session. The agent supplies each
command with the `<name>` filled in; the customer runs it and enters the
value; the agent never sees the value.

For each secret the deploy needs, against the Secrets Store id now in
`wrangler.toml`:

```
npx wrangler secrets-store secret create <store-id> --scopes workers --name <SPARK_NAME>
```

Secrets to push: `SPARK_COOKIE_SECRET`, `SPARK_HELIX_ORIGIN_AUTHENTICATION`,
`SPARK_DM_CLIENT_ID`, `SPARK_DM_CLIENT_SECRET`, and — since deploy means
real login is active — `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET` (needed for
`/auth/*` and SMTP). Note `--scopes workers` and **no** `--local` (that
would target the local store again). Mark step `done` once the customer
confirms all are set.

## D.5: Migrate the remote D1 databases (`remote-d1-migrated`)

Local D1 setup uses `--local`; the real production databases need the
schema applied explicitly, and there is no migrations framework wired
up. The **customer runs**, once per database, under their own session:

```
npx wrangler d1 execute <db-name> --remote --file cloudflare/schema/<file>.sql
```

for `user_logins.sql`, `audit_events.sql`, `search_events.sql` against
the three databases. Only production has D1 (branch/preview deploys have
none), so this targets the production databases. Mark step `done` once
the customer confirms.

## D.6: Set the CI deploy token (`ci-token-set`)

Deploy runs in GitHub Actions and needs exactly one repo secret. The
**customer adds** `CLOUDFLARE_API_TOKEN` to their fork's GitHub repo
secrets (Settings → Secrets and variables → Actions → New repository
secret), scoped to deploy Workers on their account. The agent can't and
shouldn't set this. Mark step `done` once confirmed.

## D.7: Deploy via merge (`deployed-via-merge`)

Deploy is CI-driven, not a script: `.github/workflows/release.yaml` runs
`wrangler deploy --env production` on push to `main`, and `build.yaml`
auto-deploys a per-PR branch worker on pull requests. So **deploying =
merging to `main`**.

Do **not** use `npm run deploy` / `cloudflare/scripts/deploy.sh` — it's
stale (no `--env`, hardcoded upstream identity) and diverges from the CI
path. Tell the customer this explicitly if they reach for it.

The agent prepares and verifies the PR (all deploy steps above done,
bypass re-commented, CI token set) and confirms it's ready; the
**customer merges** — the agent never pushes or merges to their `main`.
Once merged, watch the Actions run and confirm the deploy succeeded.
Mark step `done`, and set `phases["backend-onboarding"].status` to
`"done"`.

## D.8: Updating values later

Tell the customer how to change a value after the initial setup — the
path differs by what kind of value it is:

- **A non-secret var** (e.g. `AEM_ENV_ID`, a domain/route,
  `MICROSOFT_ENTRA_CLIENT_ID`, session expiry): edit it in
  `wrangler.toml` — in **both** `[env.production.vars]` and
  `[env.branch.vars]`, which the toml itself warns to keep in sync — then
  **re-deploy by merging to `main`**.
- **A secret** (`SPARK_DM_CLIENT_SECRET`, `SPARK_COOKIE_SECRET`,
  `SPARK_MICROSOFT_ENTRA_CLIENT_SECRET`, etc.): update it **directly in
  the Secret Store, no redeploy needed** — re-run the D.4 command
  (`wrangler secrets-store secret create/update <store-id> --scopes workers --name <SPARK_NAME>`).
  This no-redeploy rotation is the whole reason the app uses Secret Store
  over baked-in worker secrets. Note that editing local
  `cloudflare/.secrets` does **not** touch the deployed store — it's a
  separate local copy, and the two can silently drift.
- **A D1 schema change**: re-run the D.5 remote `wrangler d1 execute
  --remote` against the affected database — there's no migrations
  framework to do this automatically.

This step is informational; mark `done` once conveyed.

## Phase B completion report

Summarize plainly: the tier that's running and verified; for a deploy,
every identity value renamed and where, and that the auth bypass is
re-commented; the true auth state; the known PDF-preview gap
(`adobe-pdf-viewer.js`); any intake fields left blank; the update paths
from D.8; and the state/intake file locations.
