# Fastly Migration — Execution Log

Chronological record of what was **actually done** and the **outcomes**, as we execute the plan in
[`assethub-migration-fastly.md`](./assethub-migration-fastly.md). The plan holds *intent*; this log
holds *what happened*. Newest entries at the bottom.

- **Spike project** (throwaway, outside the repo): `~/dev/fastly-spike`
- **Fastly account:** own dev account (jfait@adobe.com); CLI v16.0.0.

---

## 2026-09-11 — Phase −1 (pre-setup) + Phase 0 (runtime spike)

### Phase −1 — Pre-setup ✅ (checkpoint met)
- **T-Pre.1** Fastly free developer account created. It's an isolated personal account — the "company
  name" field is cosmetic (the earlier "all services on adobe" / "astra-dev" labels were just that field,
  **not** membership in Adobe's Fastly org).
- **T-Pre.2** Fastly CLI **v16.0.0** installed + authenticated. `fastly whoami` → *John Fait*; token
  *Astra-Fastly-Token* stored as default.
  - ⚠️ Gotcha: `brew install fastly/tap/fastly` failed on macOS 26.6.2 ("Command Line Tools too outdated"
    — no bottle → source build). **Fix:** installed the prebuilt `fastly_v16.0.0_darwin-arm64` binary from
    GitHub releases into `/opt/homebrew/bin` (user-writable, on PATH) — no compile, no CLT update.
  - ⚠️ `fastly profile create` is **deprecated** in v16 → used **`fastly auth login`** (prompts to paste
    the token; avoids exposing it on the command line, unlike `fastly auth add --api-token=`).
- **T-Pre.5** Entra values confirmed from `cloudflare/src/config.js`: tenant `983cbc50-…`, client
  `93e6431f-…`, JWKS `https://login.microsoftonline.com/common/discovery/keys`.
- Pending (non-blocking): **T-Pre.3** Turso, **T-Pre.4** real id_token, **T-Pre.6** Dynamic Backends request.

### Phase 0 — Runtime-compat spike ✅ (Viceroy/local)
- Scaffolded `~/dev/fastly-spike` from the default JS starter (`@fastly/js-compute ^3.45`).
  - ⚠️ Gotcha: the first `fastly compute init` accidentally ran in the **repo root** (the `mkdir && cd`
    didn't take effect), overwriting 5 tracked files (`.gitignore`, `LICENSE`, `README.md`, `package.json`,
    `package-lock.json`) + adding artifacts. **Fully reverted** via `git checkout` + `rm`. Re-ran with an
    explicit `--directory` (which requires the dir to already exist).
- Added `jose` + `itty-router` → **both bundle cleanly to Wasm** (`bin/main.wasm` ≈ 11.9 MB). ✅ Confirms
  the default starter's `js-compute-runtime` bundles npm deps with **no extra bundler config**.
- Declared `entra_jwks` backend (`login.microsoftonline.com`) in `fastly.toml`
  (`[local_server.backends]` + `[setup.backends]`).

**Checkpoint 0 results** (`GET /spike/all` under `fastly compute serve`):

| Check | Result |
|---|---|
| HS256 sign/verify (session-cookie path) | ✅ pass |
| RS256 sign/verify (`crypto.subtle` + jose) | ✅ pass |
| Real Entra JWKS fetched over declared backend | ✅ 200, **6 keys** |
| itty-router routing (`/spike/ping`) + backend fetch | ✅ pass |
| `crypto.randomUUID`, `crypto.subtle` present | ✅ |
| jose **`createRemoteJWKSet`** | ❌ **`AbortSignal is not defined`** |

- Perf: first request **559 ms** wall (incl. live Entra fetch), **7.7 MB** heap — within limits (heap
  cap 128 MB; the 50 ms cap is CPU, not I/O wait).

**🔑 Key finding — `createRemoteJWKSet` is unusable on js-compute** (the `AbortSignal` global it relies on
for its internal fetch timeout is missing). The app's **`auth.js:87` currently uses it → Entra login would
break on Fastly as-is.**
- **Proven workaround (both halves passed in the spike):** fetch the JWKS over a **declared backend** →
  **`createLocalJWKSet`** → **`jwtVerify`**; cache the JWKS in **KV** (we lose jose's built-in remote
  caching). → drives a small `auth.js` refactor in **T1.3**.

**Verdict:** the runtime is viable — the load-bearing auth crypto works on Fastly, and Phase 0 caught a
concrete incompatibility cheaply with a validated fix. Biggest migration risk substantially retired.

**Still open for a "complete" Checkpoint 0:** deploy once to the real edge (`fastly compute publish`);
end-to-end verify of a **real** Entra id_token against the fetched keys (needs T-Pre.4).

### Phase 0 — deploy to real edge (finishing CP0)
- ⚠️ Gotcha (attempt 1): `fastly compute publish` failed — **Fastly API 400: "Your current plan doesn't
  include Compute."** The account ran fine locally (Viceroy) but couldn't create a *live* service until
  Compute was enabled on the plan. (Matches the Phase −1 free-account note.)
- ✅ Resolved: **Compute enabled** via the Fastly control panel → Products page. Also set a **$10/month
  spend alert** on the account as a cost guardrail.
- ✅ **Deployed.** Service `oHCof7oHEfxKUEvhrxb4TB` (version 1), URL
  **https://formally-modern-bird.edgecompute.app**. Backend `entra_jwks` auto-created from `[setup.backends]`.
  Manage: https://manage.fastly.com/configure/services/oHCof7oHEfxKUEvhrxb4TB
- ✅ **Edge verification matches Viceroy exactly** (`GET /spike/all`, `serviceVersion:"1"` = real edge):
  HS256 ✅, RS256 ✅, real Entra JWKS over backend ✅ (200, 6 keys), routing ✅. `createRemoteJWKSet` ❌
  (`AbortSignal is not defined`) — the corrected check now reads cleanly (`worked:false`, reason logged).
- 🏁 **Checkpoint 0 COMPLETE** (local **and** real edge). Only optional item left: real Entra id_token
  end-to-end verify (needs T-Pre.4).
- Cost guardrail: **$10/mo spend alert** set on the account. The spike service is a throwaway — can be
  deleted anytime with `fastly service delete --service-id oHCof7oHEfxKUEvhrxb4TB` (or via the dashboard).

### Plan update — Phase 1 split into 1a / 1b
- Split Phase 1: **1a = the portal (no DB)** (login, browse, search, view/download, notifications); DB-backed
  tracking **degrades to log-only** (audit POST logs the event it *would* write, returns 200, no write) so we
  can watch it fire. **1b = reporting/audit** (add Turso, wire the DB, flip log-only → real writes). Plan
  restructured accordingly.

### Phase 1a — start
- Created branch **`fastly-poc`**; real port lives in **`fastly/`** (parallel to `cloudflare/`, untouched).
- **T1a.1** config: `fastly/fastly.toml` (6 backends from `config.js` + local config store), `fastly/package.json` (jose, itty-router, escape-html).
- ✅ **First vertical slice works (T1a.2 + T1a.4): Helix proxy + adapter layer.**
  - Built the two platform seams: `src/platform/env.js` (Cloudflare-style `env` from Fastly Config/Secret
    stores) and `src/platform/backends.js` (host→declared-backend router). Ported `origin/helix.js`
    (dropped CF ports-redirect + `cf.cacheEverything` → `CacheOverride`) and `config.js` (verbatim); minimal
    `index.js` (itty-router + Helix catch-all).
  - Verified on Viceroy: **`/en/` → 200 serving the real "Fréscopa Asset Library" page through Fastly**;
    `/public/welcome` → 200; `/__health` → ok. ~313 ms first hit, 43 ms warm, 7.7 MB heap.
  - Only `env.js` + `backends.js` are Fastly-aware → keeps a future "both Cloudflare and Fastly" path open.
  - Slice limits (next steps): `/` still 404 (root redirect not ported); `/api/*` proxies to Helix (auth,
    DM/COA, search not wired yet).
- ✅ **Auth ported (T1a.3).** Verbatim copies: `util/http.js` (HS256 cookies), `util/log-utils.js`,
  `util/itty.js` (CORS), `auth/permissions.js`, most of `user.js`. Adapted: `util/helixutil.js` (backend
  fetch + CacheOverride), `auth.js` (**`createRemoteJWKSet` → backend JWKS fetch + `createLocalJWKSet`** per
  the Phase 0 finding; re-enabled `DISABLE_AUTHENTICATION` local bypass; login tracking → **log-only**),
  `index.js` (cookie mw → authRouter → public static → auth gate → `/api/user` → Helix). `env.js` hardened
  to never 500 on a missing secret; added a local dev `COOKIE_SECRET` (fake) to `fastly.toml`.
  - Verified on Viceroy: `/api/user` → 200 (bypass dev user); `/` → 302 `/en/`; `/en/` + `/public/welcome`
    → 200 (real content); **`/auth/login` → 302 to Microsoft with a signed `State` cookie**.
  - Bug found + fixed during validation: HS256 sign with an empty key ("keyData length 0") because no local
    secret store existed → added the local `COOKIE_SECRET` + hardened `secretBinding`.
  - Local limits: full OIDC *callback* needs a real Entra round-trip (deploy step); page-access control and
    the DM/COA/notifications/report `/api/*` routes are next.
- ✅ **DM proxy ported (T1a.4 + T1a.5 KV).** Verbatim copies: `origin/asset-access.js`,
  `origin/dm-analytics.js`, `constants/countries.js`, `dm-api-contract.js`,
  `collections/collection-search-constants.js`, `util/constants.js`. Adapted `origin/dm.js` (import paths;
  IMS + DM-delivery + collection fetches → declared backends; `CacheOverride('pass')` on DM responses).
  Added a **log-only `analytics-helper.js`** (T1a.6) and a **KV Store adapter** (`AUTH_TOKENS` IMS-token
  cache; value+metadata envelope). Wired `/api/adobe/assets/*` in `index.js`.
  - Full DM chain compiles/bundles (12.3 MB wasm).
  - Verified on Viceroy: the DM route is reached and the **`ims` backend fetch works** — `getIMSToken`
    actually called Adobe IMS and got `400 invalid_client` (empty client_id — no DM creds locally), then
    degraded cleanly to `401` (no crash). Proxy path proven end-to-end to the IMS backend; only real DM
    credentials are missing to deliver assets/search.
  - CF→Fastly gotcha (earlier, T1a.3): `fetchHelixSheet` requested gzip/br and `response.json()` choked on
    compressed bytes ("malformed UTF-8") — Fastly doesn't auto-decompress subrequest bodies like CF. Fixed
    by dropping `accept-encoding` on bodies we read.
  - Next to SEE assets/search: supply real `DM_CLIENT_ID`/`DM_CLIENT_SECRET` (local secret store from
    `cloudflare/.secrets`, or the deployed Secret Store).
- ✅ **DM proxy fully working with real creds (local).** Wired DM/Helix secrets via env-sourced
  `[local_server.secret_stores]` (`env = "SPARK_*"`, loaded from `cloudflare/.secrets` with
  `set -a; . cloudflare/.secrets; set +a` before serve — never committed).
  - `/api/adobe/assets/contentai/tags` → **200**; asset **search → 200, 225 matches** for "coffee"
    (real Fréscopa assets: "Coffee Unsplash Copy", "Coffee Summer", …). IMS token generated + cached.
  - Two more CF→Fastly bugs found + fixed: (1) `backendFor(url)` received a **URL object** but read
    `input.url` (undefined) → `new URL(undefined)`; now handles string/Request/URL. (2) **`response.clone()`
    is not a function** on a Fastly backend-fetch response — guarded in `handleSearchAnalytics` (log-only
    in 1a). ⚠️ The same `clone()` is used by `enforceAssetMetadataAuthorization` (a SECURITY check on
    `/metadata` GETs) — must switch to read-and-reconstruct so the check isn't skipped (added to Phase 2b).
- ✅ **Facets fix (search UI left panel).** Facets were blank because the origin serves a **newer frontend**
  (`main` +2 commits) that calls **`/api/smart-collections`** — an endpoint NOT in our checkout (e43c420;
  it's a D1-backed feature added to main after our pull). Unrouted → fell through to the Helix proxy →
  HTML → `smart-collections-panel.js` crashed on `JSON.parse`/`undefined.length` → aborted the whole
  left-panel render (facets included). **Root cause = version drift (origin ahead of checkout)** — same
  class as the header issue, not a Fastly defect.
  - Fix: (1) `/api/smart-collections` → Phase-1a **degrade to `[]`** (D1 feature; real writes in 1b);
    (2) added the **`/api/*` → JSON-404 catch-all** (had been omitted from the CF port) so any unported
    `/api/*` (e.g. `/api/messages`) returns clean JSON instead of Helix HTML that breaks frontend
    `JSON.parse`. Verified: smart-collections → `200 []`, messages → `404 {json}`, search still 200/225.
  - ✅ **Resolved (version drift):** committed the port (WIP commit `eacc11c`) and **merged `origin/main`**
    into `fastly-poc` — now **0 behind**. Clean merge (our port is all new files under `fastly/` + `docs/`,
    no overlap with `cloudflare/src`). The merge brought the **real Smart Collections feature**
    (`cloudflare/src/api/smart-collections.js` + `cloudflare/schema/smart_collections.sql` + frontend) —
    so the source is now in-tree to port for **1b** (our 1a `[]` degrade stands meanwhile) — plus a
    wrangler bump + a UTC fix. Nothing pushed (local branch only).

### Phase 1a — edge deploy (Checkpoint 1a in progress)
- ✅ **Deployed to the real Fastly edge.** Service `6gEvztcAfMsbzzeBfCfBNP` →
  **https://annually-positive-egret.edgecompute.app**. `fastly compute publish` created + linked 6 backends,
  config store `config` (`HELIX_ORIGIN`, `DISABLE_AUTHENTICATION=false`, `DEBUG_ANALYTICS`), and an (empty)
  Secret Store `secrets` (id `eq5bTaECkxcr1sNwHJY1AZ`).
- ⚠️ **KV Store not creatable on this account (403).** `kv-store create` → 403 (config-store + secret-store
  both succeed) → KV is a product not enabled on the account (like Compute earlier). Dropped
  `[setup.kv_stores]` from the deploy and **hardened the KV adapter to fully no-throw** — the IMS token
  cache just doesn't persist; nothing breaks. Enable KV Store on the account to restore caching + for
  notifications (Phase 2b). Also: first publish attempt rolled back cleanly on the 403 (no orphan service).
- ✅ **Edge verified (no-secret paths):** `/public/welcome` → 200 (real "Sign in — Fréscopa Asset Portal"
  via the edge Helix proxy); `/` → 302 `/en/`; `/en/` → 302 to the login page (real auth active).
- ⏳ **Remaining for full Checkpoint 1a (user steps):** (1) set the 4 secret values (from `cloudflare/.secrets`
  via `fastly secret-store-entry create --stdin` — the CLI guard blocks the model from handling secret
  values); (2) register `https://annually-positive-egret.edgecompute.app/auth/callback` in the Entra app
  redirect URIs. Then: login → browse → search on the edge.

### Phase 1a — edge secrets set + verified (2026-09-14)
- ✅ **Secret values set on the edge** (user ran the `create` commands; the CLI guard blocks the model from
  handling secret values). All 4 entries now in Secret Store `secrets` (id `eq5bTaECkxcr1sNwHJY1AZ`):
  `COOKIE_SECRET`, `DM_CLIENT_ID`, `DM_CLIENT_SECRET`, `HELIX_ORIGIN_AUTHENTICATION`. Values sourced from the
  local `cloudflare/.secrets` dotfile and pushed up via `fastly secret-store-entry create --stdin`.
  - **Where they live:** *remotely, in Fastly's Secret Store*, attached to service `6gEvztcAfMsbzzeBfCfBNP` —
    **not Cloudflare** (Cloudflare was never contacted; `cloudflare/.secrets` is just a local file that holds
    the same values). Distinct from the *local* dev secrets in `fastly.toml` `[local_server.secret_stores]`.
- ✅ **Verified from the edge:** `/auth/login` flipped **500 → 302** to Microsoft (was 500 while the store was
  empty — `COOKIE_SECRET` couldn't sign the State cookie). **No redeploy needed** — secrets read per-request.
- ⚠️ **Expected vs actual (UI):** per Fastly's docs the store *should* be **visible/browsable** in the control
  panel at **Resources → Secret stores** (click the store name → see its entries) — but on this account it
  **wasn't**. The page rendered a **"Purchase Secret Stores" product splash** instead (screenshot
  2026-09-14 9.52 AM). So the store is confirmed present + working via CLI/API and the live edge, yet
  **invisible in the web UI**. Likely cause: the product isn't formally purchased/enabled on the free/trial
  plan, so the CLI-created store (trial allowance) doesn't surface in the UI. Re-check after any plan upgrade /
  product enablement.
- 📍 **Viewing on this (free/trial) account — workaround:** the control-panel **Resources → Secret stores**
  page shows the **"Purchase Secret Stores" product splash** (product not enabled on the plan), so the store
  **can't be browsed in the UI** even though it exists and works. Use the **CLI** as the window:
  `fastly secret-store list` + `fastly secret-store-entry list --store-id eq5bTaECkxcr1sNwHJY1AZ` — shows
  entry **names + SHA-256 digests**, never plaintext (write-only by design). Same pattern as KV (403, not
  enabled); Secret Stores has a **trial allowance of 1 store**, which we're using. Service config + linked
  resources page still loads: https://manage.fastly.com/configure/services/6gEvztcAfMsbzzeBfCfBNP.
- 📏 **Trial limits confirmed (fine for the PoC):** Compute trials include **1 secret store** (we use exactly
  1) and our 4 entries fit. Platform caps to watch: **max 5 secret reads per Compute request** — our hot paths
  read up to **4** (`COOKIE_SECRET` + the 3 DM/Helix secrets), so we're under it, but adding a 5th secret read
  in one request path would hit the cap (consolidate secrets, or ask Fastly to raise it — do NOT purchase for
  this). Also **64 KB max per secret**. (Paid plans: min 10 secrets, more purchasable.)
- 💵 **Decision — stay on the free/trial plan; do NOT purchase Secret Stores.** Purchasing only buys the UI
  browse view + higher store/secret limits, none of which the PoC needs (store is live, edge reads it, CLI is
  the admin surface). Production parity will run on **AEM's CS-provisioned Fastly**, not this personal account,
  so anything bought here is thrown away at the parity step. Keeps within the $10/mo spend guardrail.
- ✅ **Account/linkage verified** (answering "are the secrets on the right account?"): one CLI token
  (`jfait@adobe.com`) owns the deployed service `6gEvztcAfMsbzzeBfCfBNP` (**Customer ID
  `71KGnpsVlxUjClSnLuOIHI`**; "Astra-Dev" is just this personal account's cosmetic company-name label — not a
  separate org). The service's **active version 1** links resource `secrets` → **`eq5bTaECkxcr1sNwHJY1AZ`**
  (secret-store, link `558ncr6XmMUJ0ykKpmCYc3`) and `config` → `Lgx3DQsHvYCEaJpwyqEV43`. Same token lists that
  store's 4 entries; plus the runtime proof (live edge read `COOKIE_SECRET`, 500→302). → **secrets are on the
  same account as the service and linked to the live version.** The "no secret stores" UI = product-not-purchased
  splash, not a wrong account.

### Phase 1a — edge login blocked on Entra redirect URI (admin needed) (2026-09-14)
- ⛔ **Blocker:** the edge callback `https://annually-positive-egret.edgecompute.app/auth/callback` must be
  added to the Entra app's redirect URIs, but that requires editing the **app registration** in its home tenant
  **`983cbc50-8ad1-4dde-b705-7c80477a4186`**, which **jfait cannot access** — App registrations search returns
  nothing; the portal only offers "Enterprise applications" (the read-only service principal, where redirect
  URIs can't be edited). Redirect URIs are editable only on the app registration in its home tenant.
- 👤 **Owner to ask:** the Entra app + auth code were set up by **Mohit Arora** (`mohitar@adobe.com`, commit
  `2abe4f20`, 2026-08-11). Requested (via jfait): add the one redirect URI, **or** add jfait as an **Owner** of
  app `93e6431f-…` so future PoC/parity hostnames can be self-managed.
- ✅ **NOT a feasibility blocker:** real Entra login on Fastly is already proven locally (`:8787`, against this
  same app). This only gates the *edge-hostname* login proof (final check for CP1a). Everything else on the edge
  is verified (public pages, redirects, `/auth/login` → 302 to Microsoft).
- Alt (lower priority, not pursuing): throwaway Entra tenant jfait controls → register a PoC app → point Fastly
  config at its IDs. Only if the admin path stalls — it re-proves already-proven OIDC and adds config churn.

### Phase 1a — remaining ports done: page-access, notifications, COA (2026-09-14)
Completed the last three 1a ports (branch `fastly-poc`, under `fastly/`); built clean to wasm and smoke-tested
on Viceroy with real DM/COA creds (`DISABLE_AUTHENTICATION=true` locally).
- ✅ **Page-access control** (`origin/page-access.js` — verbatim pure logic; wired into the Helix catch-all in
  `index.js`). CF used `response.clone().text()`, unavailable on Fastly backend responses, so ported as
  **read-and-reconstruct**: `await response.text()` → parse `<meta exclude-roles>` → re-serve
  `new Response(html, …)`. Added a `request.stripAcceptEncoding` flag → `helix.js` drops `accept-encoding` on
  the catch-all's HTML fetch: Fastly doesn't auto-decompress subrequest bodies, so a gzip/br body would make
  `.text()` garbage and the exclusion check **fail-OPEN** (security). Static/media routes keep compression.
- ✅ **Notifications** (`api/notifications.js` — verbatim). Needed a KV-adapter fix: Fastly `KVStore.list()`
  returns `{ list:[name] }` but this code (CF-shaped) expects `{ keys:[{name}] }` — adapted in `env.js`.
  Degrades cleanly with no KV: GET `/api/messages` → **200 serving EDS system notifications** (sys-3/sys-4);
  POST → 200 returning the object (put no-ops). Flips to real persistence when a KV Store is linked (no code
  change).
- ✅ **COA proxy** (`origin/coa.js` + `util/trusted-hosts.js`). Both outbound fetches via `fetchBackend` +
  `CacheOverride('pass')`. **Works end-to-end locally:** POST `/api/adobe/coa/generate` → **200 with a real
  COA response** (IMS token minted, `coa` backend reached; COA correctly reported it couldn't verify the fake
  test asset). SSRF trusted-host gate verified: `/api/adobe/coa/image` with missing/untrusted `src` → 400.
  ⚠️ `originCoaImage` fetches whatever host COA returns — DM/COA hosts hit declared backends; other
  `*.adobe.io` hosts would need Dynamic Backends (T-Pre.6 / Phase 2b).
- **Smoke matrix (Viceroy :7676):** `/`→302, `/api/user`→admin dev user, `/api/messages`→200 (system), POST→200,
  coa/image 400/400, coa/generate→200 (real COA), `/en/`→200 (page-access admin-bypass). Build → clean wasm.
- ⚠️ Gotcha (env): a **stale viceroy from an earlier session was still bound to :7676** (serving old wasm) —
  the first restart failed with "Address already in use". Killed PID + parent, restarted clean.
- **Not locally testable** (the auth-bypass dev user is always admin): the page-access **exclusion** branch —
  needs a real non-admin login on the edge. Logic is verbatim CF (already unit-tested there) + the new
  read-and-reconstruct path.
- **Scope note:** `util/authz.js`, `util/notifications-helpers.js`, `util/email-validator.js` intentionally NOT
  ported — only consumed by 1b/parity code (audit/analytics/scheduled), not the 1a routes.
- ⏭️ **Phase 1a ports are now COMPLETE.** The new routes aren't on the edge yet (needs a re-`publish`). The
  CP1a *finale* still waits on the edge **login** (Entra redirect-URI admin step above); do the re-publish
  together with the login unblock, or anytime.

### Phase 1a — EDGE LOGIN WORKS ✅ (Checkpoint 1a core proven on the edge) (2026-09-14)
- 🎉 **Real Entra login succeeds on the live Fastly edge** (`annually-positive-egret.edgecompute.app`) — jfait
  signed in end-to-end. Proves the load-bearing auth path (OIDC `id_token`/`form_post` → HS256 session cookie →
  JWKS verify over the declared backend) works on Fastly Compute **in production**, not just locally / on :8787.
  The single biggest migration risk is now retired on the real edge.
- 🔎 **Observed (correcting earlier caution):** the admin registered a **path wildcard** redirect URI
  `https://annually-positive-egret.edgecompute.app/*` and it **DID match** our exact `/auth/callback` at runtime.
  So **path** wildcards ARE honored in this tenant/app config. ⚠️ Per-branch `.aem.run` previews would vary the
  **host/subdomain**, where wildcards are far more restricted — do not assume those work (not verified).
- Auth + Helix + DM were already in edge **version 1**, so login/browse/search needed no re-publish.
- ⏭️ Next: (1) confirm browse/search on the edge; (2) **re-publish** to push the new COA / notifications /
  page-access routes to the edge; (3) CP1a then fully green (core already is).
- ✅ **Browse/search confirmed on the edge** (jfait: search returns real assets, thumbnails render) → DM proxy
  + IMS token work in production. **Checkpoint 1a CORE (login + browse + search) is fully green on the edge.**

### Phase 1a — re-published new routes: service version 2 (2026-09-14)
- ✅ **`fastly compute publish` → service `6gEvztcAfMsbzzeBfCfBNP` version 2 active.** Pushed the COA /
  notifications / page-access routes to the edge. `[setup]` was skipped (existing service) so the 6 backends +
  config store + secret store links **carried forward from v1** unchanged — no new secrets/config needed.
- ✅ **Edge health (unauthenticated):** `/`→302, `/public/welcome`→200, `/auth/login`→302, and the newly-routed
  `/api/messages` + `/api/adobe/coa/image` now return **302 (auth gate)** instead of the old `/api/*` JSON-404
  — confirming the new routes shipped and sit behind `withAuthentication`.
- Functional verification of the new routes = a logged-in browser test (route logic already validated locally
  on Viceroy): notifications (messages/bell UI) and AI renditions ("generate mode" in the search bar). COA
  image streaming for non-declared `*.adobe.io` hosts still needs Dynamic Backends (T-Pre.6 / 2b).
- 🏁 **Checkpoint 1a is functionally complete on the edge** (core verified; new routes deployed + gated). The
  PoC now runs the full portal on Fastly Compute. Remaining program work is Phase 1b (Turso/DB) and Phase 2/2b.

### Phase 1b approach decided — start on the existing Cloudflare D1 over HTTP (2026-09-14)
- 🧭 **Decision (jfait):** for the PoC, wire the **existing Cloudflare D1** (id `3db42334-…`) via its **REST API**
  instead of standing up Turso now. Why: zero data migration (real reports immediately), zero dialect rewrite
  (still SQLite), and it decouples the compute migration from the data-tier vendor pick. D1 REST `/query` is
  fetch-based → works from Fastly. **Transitional** — the vendor pick (Turso recommended) + data migration off
  Cloudflare move to Phase 2 (T2.1). Plan Phase 1b re-scoped accordingly.
- 🔎 Finding: the 4 D1 bindings (`USER_LOGINS`/`AUDIT_EVENTS`/`SEARCH_EVENTS`/`SMART_COLLECTIONS`) all target
  **one** physical DB (`3db42334-a8ba-48cc-b5bd-84f7e1b04eb2`) → one HTTP client, four env keys.
- 📄 New reference doc `docs/db-options-comparison.md`: cost-by-tier (2026-09-14), paying-customer suitability,
  multi-tenancy (per-tenant DB vs shared; Turso/Nile best for multitenant), and a "why not AWS/Azure" section
  (filtered by the no-TCP constraint; Aurora Serverless + RDS Data API is the only viable hyperscaler option and
  is dominated by Neon).
- ✅ **DB choice decided (2026-09-15): use the EXISTING shared `spark-audit-events` DB** (`3db42334-…`) — it holds
  all tables (audit_events, search_events + search_event_markets, user_logins, smart_collections); the other 3
  wrangler binding names are config labels for the same one DB.
- ⏳ Pending user input to build T1b.1: **`CF_API_TOKEN`** (D1 read/write, must be minted) in the Secret Store —
  the only remaining blocker. Known from `cloudflare/wrangler.jsonc`: `CF_ACCOUNT_ID` =
  `5950b56d4c83856bae7035a7b9e7ce99`, `CF_D1_DATABASE_ID` = `3db42334-a8ba-48cc-b5bd-84f7e1b04eb2` (one physical
  DB behind all 4 bindings: spark-{user-logins,audit-events,search-events,smart-collections}).

### Phase 1b — D1-over-HTTP shim built + smart-collections wired (2026-09-15)
- ✅ **Built the D1-over-HTTP client** (`platform/d1-http.js`): a Cloudflare-D1-compatible client over the D1 REST
  `/query` API (`prepare().bind().first()/.all()/.run()` + sequential `.batch()`), so the app's D1 code runs
  unchanged from Fastly. Degrades (empty reads / no-op writes + a one-time `[d1:degraded]` log) when
  account/db/token are absent — nothing 500s.
- ✅ **Wired `env.js`:** one client backs all 4 bindings (USER_LOGINS/AUDIT_EVENTS/SEARCH_EVENTS/SMART_COLLECTIONS)
  → the single physical DB. Added `cf_api` backend (api.cloudflare.com) to `backends.js` + `fastly.toml`;
  `CF_ACCOUNT_ID` + `CF_D1_DATABASE_ID` to the config store; `CF_API_TOKEN` to the local secret store
  (env `SPARK_CF_API_TOKEN`).
- ✅ **Ported `api/smart-collections.js`** (+ `smart-collections/smart-collection-types.js`); flipped the index.js
  `[]` degrade → the real API.
- 🐛 **Fix:** the local `DISABLE_AUTHENTICATION` bypass user had no `sub` → sub-scoped consumers (smart-collections,
  audit) 401'd locally before reaching D1. Added `sub: 'local-dev'` to the bypass user (real users get
  `idToken.oid`). Edge unaffected.
- **Validated on Viceroy (no token → degrade path):** clean wasm build; GET `/api/smart-collections` → **200 []**,
  POST → **201** (write no-op'd), `[d1:degraded]` logged; `/api/messages` + `/en/` unaffected. **Real-D1 path
  pending the token.**
- ⏭️ Next: user sets `CF_API_TOKEN` → validate smart-collections against **real D1** (read live rows) → then port
  the remaining consumers (`user-logins`, `audit`, `analytics` D1 parts) on the proven shim. Deploy note: on the
  edge, `[setup]` runs only on first publish, so the new `cf_api` backend + `CF_ACCOUNT_ID`/`CF_D1_DATABASE_ID`
  config + `CF_API_TOKEN` secret must be added to the live service via CLI at deploy (not auto-created by publish).
- ✅ **SHIM PROVEN against real D1 (2026-09-15).** Token verified live (`SELECT COUNT(*) FROM smart_collections`
  → 4; table list matches). Full CRUD round-trip through the shim via Viceroy: POST create → 201 (wrote a real
  row), GET → returned it **plus 2 real org-visible collections already in the DB** ("Spring Launch 2026
  campaign", "Created-by-app-builder"), DELETE → 204, GET → gone. Proves `prepare/bind/all/run`, numbered params
  (incl. `?8` reuse), `meta.changes` 404-detection, and response parsing all work against live Cloudflare D1.
  Test row cleaned up (no residue). → shim is trustworthy; safe to port the remaining consumers on it.
- ⏳ **Only remaining user step for CP1a:** register redirect URI
  `https://annually-positive-egret.edgecompute.app/auth/callback` in the Entra app `93e6431f-…`
  (Azure Portal → App registrations → **Authentication → Web → Redirect URIs**). Then login → browse →
  search on the edge = **Checkpoint 1a complete**.
