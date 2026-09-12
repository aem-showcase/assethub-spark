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
  - ⚠️ **Decision to revisit:** our branch is 2 commits behind `origin/main`; the deployed frontend is
    ahead of our worker code. Consider rebasing `fastly-poc` onto `origin/main` so ports match the live
    frontend (and to port the real smart-collections for 1b).
