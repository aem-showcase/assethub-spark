# Onboarding skill: full fork-identity + backend/config plan

This document is the design plan behind
`.claude/skills/onboard-customer-portal/SKILL.md`. It records the reasoning
and code-verified findings that shaped the skill, so future changes to the
skill can be checked against the same evidence rather than re-derived from
scratch.

## Context

Earlier drafts of `onboard-customer-portal` undercounted scope twice:

1. First pass treated `wrangler.toml`/`local.sh` as almost entirely
   out-of-scope for a "local-only" flow. Checking a real fork and its own
   onboarding transcript showed the opposite: `HELIX_ORIGIN` in both
   `wrangler.toml` and `local.sh` stayed pointed at the upstream template's
   own origin after forking, silently serving the old template's content
   instead of the fork's own — a real, live bug, not a theoretical one.
   That pass also missed that `cloudflare/src/auth.js`'s
   `DISABLE_AUTHENTICATION` bypass inside `withAuthentication` is
   dead/commented-out code today, so "auth off locally" doesn't actually
   work without a code change the skill should detect and warn about, not
   silently assume works.

2. Second pass was told directly: think holistically about *everything*
   that must change for a fork to run and deploy correctly under the
   customer's own identity — not just the handful of files touched so far —
   and to derive this from reading the actual code, not infer it. A full
   repo grep plus a thorough audit turned up **~25 files** with hardcoded
   identifiers specific to the template instance (repo name, GitHub org,
   Cloudflare worker name/domain/account id, KV/D1/Secrets-Store resource
   ids, Entra tenant/client ids, an Adobe PDF Embed client id, and more),
   spanning functional code, CI workflows, package manifests, and
   documentation. Full inventory below.

   Two anomalies surfaced during the audit — a mismatch between the
   Secrets Store id in `wrangler.toml` vs. the one documented in
   `cloudflare/README.md`, and three D1 bindings sharing one
   `database_id` — turned out to be artifacts of the template's own account
   setup, not something the skill needs to diagnose. The customer
   provisions their **own** Cloudflare resources (their own Secrets Store,
   their own three separate D1 database ids, their own KV namespace), so
   once every id in `wrangler.toml` is the customer's own value, there's
   nothing left to reconcile — this collapses into "ask the customer for
   these resource ids" as part of identity collection, not a bug-diagnosis
   step.

The skill's own instructions must never hardcode
`assethub-spark`/`aem-showcase`-style literals — it derives the "old
identity" values by reading the fork's actual files, and derives the "new
identity" values from the customer/repo, then applies a rename generically.
Renames happen as one pass: collect the handful of real identity inputs
once, preview the full diff, single confirmation, apply everywhere
(functional, CI, package manifests, and docs together) — because these are
mechanical substitutions of already-known values, not judgment calls, so
splitting into multiple confirmation rounds adds friction without a real
safety benefit.

Branding/DA content/visual work remains out of scope — the skill only
touches identity/config, never brand/visual content. That work is a
separate, independently invoked effort (e.g. the `excat:*` skills).

## Complete inventory of what must change for a fork (code-verified)

### A. Identity inputs the skill must obtain (asked or derived)

| Input | How obtained | Why |
|---|---|---|
| GitHub org + repo | Derived: `git remote get-url origin` | Drives Helix origin URLs everywhere (`{repo}--{org}`) |
| AEM Code Sync installed on fork | Derived: active probe of `https://main--{repo}--{org}.aem.page` | Confirms the Helix site the above URLs point to actually exists |
| Cloudflare account id | Asked — not derivable from anything in the repo | Replaces `wrangler.toml`'s `account_id` |
| Cloudflare `workers.dev` subdomain | Asked — account-level Cloudflare setting (Workers & Pages → Settings → "Your subdomain"), not something the skill invents or derives; account owner may need to set it first if never configured | Replaces `WORKER_DOMAIN` default in `deploy.sh`, and the `*.workers.dev` literals in `index.js` CORS allowlist, `user.js` live-host list, `tests/shared/env.js` |
| Desired worker name (default suggestion: derived from repo name) | Asked, with a sensible default | Replaces the template's worker name in `wrangler.toml`, `deploy.sh`, `package.json` names |
| Desired production domain (or defer, staying on `*.workers.dev` only) | Asked — real DNS/zone the customer owns, cannot be derived | Replaces the template's domain in `wrangler.toml` routes, `index.js` CORS, `user.js`, `deploy.sh`, `release.yaml`, docs |
| `AEM_ENV_ID`, Content Hub OAuth S2S client id/secret | Asked | Real search |
| Microsoft Entra tenant id + client id (only if/when the customer does their own Entra app registration — separate from the `DISABLE_AUTHENTICATION` gap) | Asked, explicitly optional/deferred — see Entra section below | Replaces the template's own tenant/client ids so a fork's real login doesn't authenticate against the template owner's Entra tenant |
| Customer's own KV namespace id (`AUTH_TOKENS`) | Asked — created by the customer in their own Cloudflare account, not derivable | Replaces the template's KV namespace id |
| Customer's own D1 database ids — three separate ids, one per binding (`USER_LOGINS`, `AUDIT_EVENTS`, `SEARCH_EVENTS`) | Asked — created by the customer, must be three distinct ids to avoid the cross-contamination risk the template itself has | Replaces the template's shared `database_id` across all three bindings |
| Customer's own Secrets Store id | Asked — created by the customer in their own account | Replaces the template's Secrets Store id; since it's the customer's own store, there's no README-vs-config mismatch to reconcile |

### B. Functional/CI files — must be corrected for the fork to run/deploy correctly

| File | Category |
|---|---|
| `cloudflare/wrangler.toml` | worker name, Cloudflare account id, D1 database ids (three, must be distinct), production route/zone, KV namespace id, Secrets Store id, `HELIX_ORIGIN` (repo+org), `AEM_ENV_ID`, `MICROSOFT_ENTRA_TENANT_ID`/`CLIENT_ID` |
| `cloudflare/scripts/deploy.sh` | `REPO`, `ORG`, `WORKER`, `WORKER_DOMAIN` — drives Helix origin + worker URL construction at deploy time |
| `.github/workflows/build.yaml` | Helix origin + route built from repo/org/domain — PR/branch CI deploys target wrong origin/domain if unchanged |
| `.github/workflows/release.yaml` | GitHub Environments UI shows wrong URL after prod deploy if unchanged |
| `local.sh` | `AEM_PAGES_URL` default, `AEM_ENV_ID` default, placeholder `git remote add origin` — local dev content source + env id defaults |
| `package.json` (root), `cloudflare/package.json` | npm package identity |
| `package-lock.json`, `cloudflare/package-lock.json` | generated — regenerate via `npm install` after renaming `package.json`, don't hand-edit |
| `sonar-project.properties` | wrong value pushes analysis to wrong/inaccessible SonarQube project |
| `cloudflare/src/index.js` | **security-relevant**: CORS `allowedOrigins` — fork's real frontend origin gets CORS-rejected unless added |
| `cloudflare/src/user.js` | **security/access-relevant**: `liveHosts` array — if the fork's real production host isn't recognized as "live," every request is treated as preview and requires the `preview` permission, locking out most users from the fork's own production site |
| `cloudflare/src/api/notifications.js` | default from-email — fork should send from their own domain |
| `cloudflare/src/api/analytics.js` | fallback analytics account id (two occurrences) — wrong/inaccessible account if env var also unset |
| `blocks/search-results/components/adobe-pdf-viewer.js` | already has an explicit unfilled placeholder (`REPLACE_WITH_SPARK_PDF_EMBED_CLIENT_ID`) — PDF preview silently won't work for the fork's real domain until filled with the customer's own Adobe PDF Embed API client id, a separate credential to register, not derivable |
| `tests/shared/env.js` | `production`/`preview` base URLs, branch-URL template literal — fork's own integration/authz test suite silently tests the template owner's environments unless changed |
| `tests/integration/test-public-urls.sh` | default `HOST` — wrong default target unless overridden per-invocation |

### C. Documentation/cosmetic — wrong but not behavior-breaking; included in the same rename pass since it's the same mechanical substitution

`README.md`, `ARCHITECTURE.md`, `cloudflare/README.md`, `cloudflare/NOTES.md`,
`.cursor/rules/aem.mdc`, `.github/pull_request_template.md`,
`docs/api/API-SECURITY-REVIEW.md`, `docs/authoring/getting-started.md`,
`docs/authoring/localization.md`, `docs/administering/permission-configuration.md`,
`docs/authoring/blocks/*.md` (9 files), `docs/da-content/create-docs.py`,
`docs/da-content/create-sheets.py`, `tests/integration/README.md`,
`tests/integration/setup/auth.js`, `tests/integration/test-runner.test.js`,
`tests/authz/helpers.js` — all reference the template's repo/org/domain in
prose, example links, or human-facing instructional strings (console
messages, DA-upload print statements). None of these drive runtime
behavior, but a customer's own README/docs describing the template owner's
demo instead of their own fork is a real onboarding-quality problem, and
every one of these is the same handful of substitution values already
collected in section A — so they're fixed in the same pass, not treated as
separate scope.

One exception found and correctly excluded: **test fixture URLs** in
`cloudflare/src/origin/__tests__/dm-analytics-search-type.test.js` use
domain-looking strings only as arbitrary test input to a referer-parsing
function that only inspects the path — functionally identical regardless of
domain. Not part of the rename; touching it would be cosmetic churn with
zero behavior change.

## Auth-bypass gap

`cloudflare/src/auth.js`'s `DISABLE_AUTHENTICATION` bypass inside
`withAuthentication` is commented out. Setting the env var today only
affects the `/public/welcome` special case; every other route still
requires a real session cookie. The skill statically checks this block's
state, tells the customer plainly if it's inactive with the exact file/line
location, and asks whether to proceed with real auth on (they complete a
real Entra login once, which requires their own
`MICROSOFT_ENTRA_TENANT_ID`/`CLIENT_ID`) or pause until the block is
restored by them/their engineering team. The skill never edits `auth.js`
itself — that's a code change, not a config value, and outside its job.
Records `authBypassActive: true|false` in the state file regardless of
choice.

## Entra app registration — required before any real deploy

Verified directly in code: `cloudflare/src/auth.js`'s `REQUIRED_ENV_VARS`
(`MICROSOFT_ENTRA_TENANT_ID`, `MICROSOFT_ENTRA_CLIENT_ID`, `COOKIE_SECRET`)
is checked inside the `authRouter`'s `before` middleware, which 503s on any
`/auth/*` request if these are missing. This check is **independent of
`DISABLE_AUTHENTICATION`** — it fires regardless of the auth-bypass state.
So: local dev can run indefinitely on the bypass (once restored) or on the
template's own placeholder Entra values sitting unused in `wrangler.toml`,
but a real deploy where the customer wants their own users logging in
genuinely needs a real Entra app registration — this isn't optional, it's a
hard requirement, confirmed via Microsoft's own Entra documentation:

- An IT admin in the customer's own Microsoft 365/Entra tenant (any
  tier — no Entra ID P1/P2 required, works on the free tier bundled with
  any Microsoft 365/Azure subscription) goes to entra.microsoft.com →
  **App registrations → New registration**, names it, and — critically —
  registers the redirect URI under the **Single-page application**
  platform (not "Web"), pointing at the customer's real login callback URL.
  This matches the code's flow exactly: redirect to `/authorize`, validate
  the returned `id_token` via JWKS, no client secret involved — the
  public-client/PKCE pattern, which Microsoft's docs require to be
  registered as SPA, not Web.
- After registration, the **Application (client) ID** and **Directory
  (tenant) ID** shown on the app's Overview page map directly to
  `MICROSOFT_ENTRA_CLIENT_ID` / `MICROSOFT_ENTRA_TENANT_ID`. No extra API
  permission setup needed for basic sign-in (`User.Read` is granted by
  default; `openid`/`profile`/`email` are implicit).
- Separately, `cloudflare/README.md` documents that the **same app
  registration** is also used for SMTP OAuth2 email sending, which needs a
  **Web** platform config (confidential client, generates a client secret)
  with `SMTP.Send` + `offline_access` delegated permissions and admin
  consent, plus its own `localhost:3939` redirect for the one-time token
  setup script. This is a normal, supported combination — one app
  registration can hold multiple platform configs (an SPA entry for login
  alongside a Web entry for SMTP) simultaneously, not two separate app
  registrations.

The skill surfaces this as an explicit, separate checklist item for anyone
proceeding past local dev toward a real deploy — distinct from the
auth-bypass gap (about the app's own dead code) and distinct from
identity-rename (about replacing the template's *placeholder* Entra values
once the customer has their own real ones). The skill does not perform the
Entra registration itself (it's the customer's own tenant, out of the
skill's reach) — it gives the concrete steps above and asks for the
resulting tenant id/client id once done.

## Intake file — one place for non-secret identity/resource values

Several required values (Cloudflare account id, `workers.dev` subdomain, KV
namespace id, three D1 database ids, Secrets Store id) can't be usefully
"asked in chat" the way a yes/no or a short string can — the customer has to
go look them up first, and typing several UUIDs back and forth through chat
is error-prone and easy to lose track of mid-session.

Design: a single intake file, `.internal/customer-config.json` (gitignored,
same convention as the state file), which the skill generates pre-populated
with every needed field plus lookup instructions per field — preferring the
`wrangler` CLI over dashboard navigation wherever it's authoritative and
unambiguous:

| Field | How the customer gets it |
|---|---|
| `cloudflareAccountId` | `wrangler whoami`, or dashboard: Workers & Pages → Overview → Account Details |
| `workersDevSubdomain` | Dashboard only (no CLI getter exists): Workers & Pages → **Change** next to "Your subdomain" |
| `workerName` | Free choice — skill suggests a default derived from the repo name |
| `productionDomain` | Customer's own DNS zone they've added to Cloudflare (optional — may leave blank to stay on `*.workers.dev` only) |
| `kvNamespaceId` | `wrangler kv namespace create AUTH_TOKENS` — id is in the command output |
| `d1DatabaseIds.userLogins` / `.auditEvents` / `.searchEvents` | `wrangler d1 create <name>` once per binding — each prints its own `database_id`; must be three distinct ids |
| `secretsStoreId` | `wrangler secrets-store store create` — id is in the command output |
| `aemEnvId` | From the customer's Adobe program/environment (`pXXXX-eYYYY`) |
| `microsoftEntraTenantId` / `microsoftEntraClientId` | From their Entra app registration's Overview page — only needed once they're ready to move past the auth-bypass gap |

The skill generates this file, tells the customer to fill it in at their own
pace (no chat back-and-forth needed for these specific values), and only
reads it once they confirm it's complete. Real secrets (`DM_CLIENT_ID`/
`SECRET`, the Entra client secret for SMTP) are explicitly **not** in this
file — those still go straight into `cloudflare/.secrets` by the customer,
preserving the "agent never reads secret values back" boundary. This file
only holds resource identifiers and non-secret config, which the skill
*can* read and propagate directly since none of it is sensitive — it's the
equivalent of information visible in a dashboard URL, not a credential.

## Step sequence

State file: `.internal/onboarding-state.json` (gitignored via existing
`.internal` entry), schema with a `customer` block plus
`phases["backend-onboarding"].steps`:

1. **`node-version-check`** — `.nvmrc` vs `node --version`.
2. **`fork-identity-resolved`** — derive `{org}/{repo}` from
   `git remote get-url origin`.
3. **`code-sync-verified`** — probe `https://main--{repo}--{org}.aem.page`;
   404 → explain installing AEM Code Sync GitHub App, mark `blocked`, stop.
4. **`intake-file-generated`** — generate `.internal/customer-config.json`
   pre-populated with every field from the intake-file table above, plus
   lookup instructions per field. Tell the customer to fill it in at their
   own pace and confirm when done.
5. **`content-hub-creds-collected`** — ask conversationally for
   `AEM_ENV_ID` and Content Hub OAuth S2S client id/secret — real secrets go
   straight into `cloudflare/.secrets`, never read back by the agent;
   `AEM_ENV_ID` alone is recorded in the state file.
6. **`repo-identity-rename-applied`** — read the completed intake file plus
   the derived org/repo plus `AEM_ENV_ID`, generate a full diff across
   every file in inventory sections B and C (functional/CI and docs
   together, one pass), show the complete preview, get one confirmation,
   apply. The skill's own logic reads the *current* hardcoded values from
   the files themselves (never hardcodes template-specific literals in its
   own instructions) so it works the same on any upstream template name.
   Regenerate lockfiles via `npm install` after `package.json` name
   changes, rather than hand-editing them.
7. **`auth-bypass-checked`** — as described above; record
   `authBypassActive`.
8. **`local-env-configured`** — set `AEM_PAGES_URL`, `AEM_ENV_ID`,
   `DISABLE_AUTHENTICATION=true` for the `npm run dev` invocation.
9. **`boot-verified`** — run `npm run dev`; confirm the dev server is
   actually serving this repo's own local files and not a stale/cached
   directory (a real failure mode seen in practice); confirm auth-redirect
   behavior matches step 7's recorded state; confirm a real search request
   returns the customer's own Content Hub results.
10. **`deploy-readiness-noted`** — informational-only, since this skill
    stays local-only and never deploys itself. Reports: (a) the Entra app
    registration requirement, since `REQUIRED_ENV_VARS` blocks `/auth/*`
    regardless of auth-bypass state; (b) that restoring the auth-bypass
    dead code or accepting real login is mandatory in production either
    way; (c) any intake-file fields left blank that a real deploy would
    need.

## Completion report

States: full list of identity values applied and where; the true current
auth-bypass state; local boot + search verification result; the deploy
checklist from step 10; that branding/content is a separate, not-yet-invoked
step; that PDF preview (`adobe-pdf-viewer.js`) remains on a placeholder
client id until the customer registers their own Adobe PDF Embed API
credential (a known gap, not blocking since search doesn't depend on it).

## Verification

- Re-read the finished SKILL.md against the full inventory above —
  specifically confirm no step silently skips section B/C files.
- Dry-run resumability against hand-crafted state-file fixtures and
  hand-crafted `.internal/customer-config.json` fixtures (empty, partially
  filled, fully filled) for `intake-file-generated`,
  `repo-identity-rename-applied`, `deploy-readiness-noted`.
- If a live fork becomes available: confirm the rename pass catches every
  file in section B without needing any file path hardcoded in the skill
  itself; confirm `DISABLE_AUTHENTICATION` is correctly reported as
  currently ineffective rather than claimed as working; confirm the skill
  never asks for a Cloudflare resource id directly in chat once the intake
  file exists — it should point at the file instead.
