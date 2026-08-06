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
      "steps": {
        "node-version-check": "pending",
        "fork-identity-resolved": "pending",
        "code-sync-verified": "pending",
        "intake-file-generated": "pending",
        "content-hub-creds-collected": "pending",
        "repo-identity-rename-applied": "pending",
        "auth-bypass-checked": "pending",
        "local-env-configured": "pending",
        "boot-verified": "pending",
        "deploy-readiness-noted": "pending"
      }
    }
  }
}
```

Step values are one of `pending`, `done`, or `blocked` (blocked = waiting
on something external — the customer fetching credentials, provisioning
Cloudflare resources, or installing Code Sync). Update `lastUpdated` and
the relevant step every time you complete or block on a step. Set a
phase's `status` to `"done"` only when every one of its steps is `done`.

If the file doesn't exist, create it with the schema above before doing
anything else in either phase. If it exists, read it and jump to the
first non-`done` step in the relevant phase — do not redo completed steps
or re-ask questions whose answers are already recorded under `customer`.

## Companion file: customer-config intake (Phase B only)

`.internal/customer-config.json` (also gitignored, same convention) holds
non-secret Cloudflare identity/resource values the customer must look up
themselves. Generated during Phase B step 4; described fully there. Not
used by Phase A.

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

State the hard rule plainly: never accept a pasted token in chat. If a
token appears in the conversation anyway, treat it as compromised, tell
the customer to revoke/rotate it immediately, and do not use it.

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

Using the org/repo from B.2, construct the expected Helix preview URL:

```
https://main--{repo}--{org}.aem.page
```

Fetch it. Determine the result:

- **Real content / 200** → Code Sync is installed and working. Mark step
  `done`.
- **404 / "site not found"** → Code Sync is not installed yet. Explain
  plainly that this is a required one-time GitHub-side step the customer
  must do themselves (the agent cannot install a GitHub App on their
  org): install the AEM Code Sync GitHub App on their forked repository.
  Point them to the aem.live documentation for exact steps (look it up,
  don't guess the URL). Mark step `blocked`, explain you'll re-check
  once they've done it, and stop here for this session if they need to
  go do it now.

Do not proceed past this step on an unverified assumption — a customer
whose Code Sync isn't installed will silently see the upstream
template's own demo content via the `aem up` fallback proxy instead of
their own.

## B.4: Intake file generation (`intake-file-generated`)

Several values need the customer to run a command or look something up
in their own Cloudflare account first — not answerable one-at-a-time in
chat. Generate `.internal/customer-config.json` pre-populated with these
fields, each `null` until filled in:

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

Tell the customer, for each field, exactly how to get the value —
prefer the `wrangler` CLI wherever it gives an unambiguous answer, fall
back to a dashboard path only where no CLI getter exists:

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

## B.5: Content Hub credential collection (`content-hub-creds-collected`)

Ask the customer for:

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

Also check whether `cloudflare/.secrets` has a `SPARK_COOKIE_SECRET`
line — required by `cloudflare/src/auth.js`'s `REQUIRED_ENV_VARS`
regardless of auth-bypass state. If missing, generate one locally with
`openssl rand -base64 32` and have the customer add it themselves.

Write only the non-secret `aemEnvId` into `customer.aemEnvId`. Mark step
`done` once the customer confirms all three lines are in place.

## B.6: Repo identity rename (`repo-identity-rename-applied`)

Repoint every file that currently identifies the upstream template
instead of this customer's fork. One bulk, previewed, single-confirmation
pass — not file-by-file confirmations, since every change here is a
mechanical substitution of values already known by this point.

**Gather the substitution map** (old → new), reading old values live
from the files:

- GitHub org/repo: read the current `HELIX_ORIGIN` in
  `cloudflare/wrangler.toml` (or `local.sh`'s `AEM_PAGES_URL` default) →
  new value from `customer.githubRepo`/`customer.githubOrg`.
- Cloudflare worker name / account id: read `wrangler.toml`'s `name` /
  `account_id` → new values from the intake file.
- Production domain / workers.dev subdomain: read the current
  route/domain literals → new values from the intake file.
- KV namespace id, three D1 database ids, Secrets Store id: read current
  ids in `wrangler.toml` → new values from the intake file.
- `AEM_ENV_ID`: read the current value in `wrangler.toml` → new value
  from `customer.aemEnvId`.

**Files to update** (re-derive by searching, this is a starting point,
not a guarantee):

- Functional/CI: `cloudflare/wrangler.toml`, `cloudflare/scripts/deploy.sh`,
  `.github/workflows/build.yaml`, `.github/workflows/release.yaml`,
  `local.sh`, `package.json`, `cloudflare/package.json`,
  `sonar-project.properties`, `cloudflare/src/index.js` (CORS
  `allowedOrigins` — security-relevant), `cloudflare/src/user.js` (the
  `liveHosts` array — security/access-relevant: if the fork's real
  production host isn't listed, every request is treated as preview and
  requires the `preview` permission), `cloudflare/src/api/notifications.js`
  (default from-email), `cloudflare/src/api/analytics.js` (fallback
  analytics account id, two occurrences), `tests/shared/env.js`,
  `tests/integration/test-public-urls.sh`.
- Documentation (same values, same pass): `README.md`, `ARCHITECTURE.md`,
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

## B.7: Auth-bypass check (`auth-bypass-checked`)

Read `cloudflare/src/auth.js` and check whether the
`DISABLE_AUTHENTICATION` bypass block inside `withAuthentication` is
active code or commented out.

If commented out (as of this writing, it is — lines ~161-172): tell the
customer plainly that setting `DISABLE_AUTHENTICATION=true` will **not**
actually disable login today. Every route still requires a valid session
cookie via the normal Entra flow. Give the exact file/line location. Ask
whether they want to proceed anyway with real auth required locally, or
pause until they/their engineering team restores the bypass block.

Do not edit `auth.js` yourself. Record `customer.authBypassActive` as
`true` or `false` based on what you found, and mark this step `done`
either way — "done" means "the true state is now known," not "the bypass
works."

Still set `DISABLE_AUTHENTICATION=true` in the local env regardless.

## B.8: Local environment configuration (`local-env-configured`)

`wrangler.toml`'s `HELIX_ORIGIN` isn't consulted by `local.sh` for local
dev (it always points the local Cloudflare worker at the locally-running
`aem up` server) — but it matters for CI/deploy, already corrected in B.6.

Set for the `npm run dev` invocation:

- `AEM_PAGES_URL` = `https://main--{repo}--{org}.aem.page` (from B.2/B.3).
- `AEM_ENV_ID` = the value from B.5.
- `DISABLE_AUTHENTICATION` = `true`.

Mark step `done`.

## B.9: Boot verification (`boot-verified`)

Run `npm run dev` with the environment from B.8. Wait for both the AEM
dev server and the Cloudflare worker dev server to report ready (watch
for the script's own "Ready on http://localhost:{port}" line).

Once up, verify, in order:

1. **The server is serving this repo's own local files**, not a stale or
   unrelated cached directory — confirm a distinctive string from a
   local file actually appears in the served output.
2. Auth-redirect behavior matches what B.7 recorded.
3. A real search request returns results sourced from the customer's own
   Content Hub environment.

If search fails, check in order: wrong/missing
`SPARK_DM_CLIENT_ID`/`SECRET`, wrong `AEM_ENV_ID`, or the Content Hub
technical account lacking access to that delivery environment.

Mark step `done` once verified.

## B.10: Deploy readiness note (`deploy-readiness-noted`)

Informational only — this phase never deploys. Tell the customer plainly
what's still needed before any real deploy:

- **A real Microsoft Entra app registration**: `cloudflare/src/auth.js`'s
  `REQUIRED_ENV_VARS` hard-blocks `/auth/*` (503) if
  `MICROSOFT_ENTRA_TENANT_ID`/`CLIENT_ID` are missing, regardless of
  auth-bypass state. Their IT admin: entra.microsoft.com → **App
  registrations → New registration** → redirect URI under **Single-page
  application** platform → copy the **Application (client) ID** and
  **Directory (tenant) ID**. No premium license tier required. If they
  also want SMTP, the same registration can hold an additional **Web**
  platform config with a client secret.
- **The auth-bypass gap itself** — either it stays unresolved (real
  login required everywhere deployed) or their engineering team restores
  the bypass block — their call.
- **Any intake-file fields left blank** — note which ones.

Mark step `done` once reported, and set
`phases["backend-onboarding"].status` to `"done"`.

## Phase B completion report

Summarize plainly: what's now configured and verified; every identity
value renamed and where; the true auth-bypass state; the deploy
checklist; the known PDF-preview gap; the state/intake file locations.
