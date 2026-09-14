# Feasibility Assessment: Migrating assethub-spark from Cloudflare Workers to Fastly Compute

> **Deliverable type:** feasibility / discovery assessment (not yet a migration execution plan).
> **Chosen strategy:** phased — **PoC spike first, then work toward production parity** (user-selected).
> **Bottom line:** ✅ **Feasible.** The core (edge auth-gateway + API proxy) is Web-standard and
> ports cleanly. There is exactly **one** hard gap — the **D1 relational store** — and it forces an
> external managed database. The previously-feared second gap (Analytics Engine) turns out to be
> **dormant legacy code** and can be deleted, not ported.

---

## Context

`assethub-spark` is an AEM Edge Delivery asset-portal demo whose backend is a **Cloudflare Worker**
(`cloudflare/`). The Worker is an **edge auth-gateway + API proxy**: it authenticates via Microsoft
Entra OIDC, mints an HS256 JWT session cookie, authorizes against EDS config spreadsheets, and
proxies Adobe Dynamic Media, the Content Optimization Agent (AI renditions), and the AEM/Helix
origin — plus a small D1-backed reporting/audit subsystem and user-simulation/permissions.

The team wants to know **whether this app can run on Fastly Compute** and **what it would take**.
This assessment (1) inventories the real Cloudflare surface area (from code, since config and docs
have drifted), (2) maps each dependency to its Fastly equivalent or documents the gap, and (3) rates
complexity, effort, and risk for a phased migration, with a **task-level execution plan and
verification checkpoints** so progress can be validated as we go.

**Method:** three parallel code audits (platform bindings/deploy, runtime-API usage, tests/dev/data)
cross-checked against current Fastly docs and verified first-hand on the pivotal analytics question.

---

## Headline finding: Analytics Engine is dead code (verified)

The initial audits found Analytics Engine (AE) code in `analytics.js` (`writeDataPoint` + ~30
ClickHouse-dialect SQL queries), which would have been the hardest gap. **First-hand verification
shows it is not a live dependency:**

- The route table is self-labelled **`// Analytics API (D1 search metrics only)`** (`index.js:158`).
- Only two analytics routes exist: `/api/analytics/search-metrics` → **D1**, and `/api/analytics/test`
  → the AE path (note the name *test*).
- The **only** shipping frontend consumer is `blocks/report-searches/data-calculations.js:43`, which
  calls `search-metrics` (**D1**). `report-asset-activity` uses the **D1** audit API; `report-hub` makes
  no fetches. **Nothing calls the AE path.**
- AE writes are guarded by `if (!env.SPARK_ANALYTICS_ENGINE)`, and that binding is **absent from
  `wrangler.jsonc`** → login/download AE writes are **no-ops** in the committed build.

**Conclusion:** AE is leftover from an in-progress AE→D1 migration (searches already moved). Treat the
AE write path, `executeReportQuery`, the ClickHouse query builders, and `ANALYTICS_API_TOKEN` as
**delete-not-port**. This removes the biggest risk/effort item and the `api.cloudflare.com` backend.
_(Worth a one-line confirmation from the team that the `/test` endpoint isn't used by any out-of-band
admin tooling before deletion — all in-repo evidence says it's safe.)_

---

## Reference: Fastly Compute platform capabilities (researched Sep 2026)

| Capability | Cloudflare | Fastly Compute equivalent | Verdict |
|---|---|---|---|
| Runtime | V8 isolates | **StarlingMonkey** (SpiderMonkey→Wasm) via `@fastly/js-compute` | Portable; validate deps |
| Deploy/config | `wrangler` + `wrangler.jsonc` | `fastly` CLI + `fastly.toml` | Rewrite config & CI |
| Plain vars | `vars` | **Config Store** (5 stores, 500 entries, 8 000-char values, POP-cached) | Direct |
| Secrets | Secret Store `.get()` | **Secret Store** (64 KB/secret, **max 5 reads/request**) | Direct (mind 5-read cap) |
| Runtime KV | Workers KV | **KV Store** (25→100 MB/value, versionless, eventually consistent) | Direct; TTL/list differ |
| Geolocation | `request.cf.country` | `fastly:geolocation` `getGeolocationForIpAddress()` | Direct (code change) |
| WebCrypto | `crypto.subtle` | `crypto.subtle`: digest, sign/verify (**HMAC, RSASSA-PKCS1-v1_5, ECDSA, RSA-PSS**), JWK import, `randomUUID`, `getRandomValues` | Portable — **validate for `jose`** |
| Outbound fetch | any URL, free | **Backends required**: static (32/exec) or **Dynamic Backends** (auto-from-URL, 200/svc, **enable per service**) | Declare all backends |
| **Relational DB** | **D1 (SQLite)** | **None native** → external (Turso/libSQL over HTTP, or Postgres/PlanetScale) | ⚠️ **THE gap** |
| Queryable analytics | Analytics Engine | None (log-streaming to external sink) | n/a — **AE is dead code here** |
| Cron | Cron Triggers | **None** (external scheduler) | Trivial — handler is a no-op |
| `ctx.waitUntil` | supported | Different post-response model | Medium |
| Cache API / `cacheEverything` | `caches.*`, `cf` opts | `CacheOverride` / core cache | Portable (different API) |
| Local dev / test | `wrangler dev`, `@cloudflare/vitest-pool-workers` | **Viceroy** (`fastly compute serve`), `@fastly/compute-testing` | ⚠️ Test/dev-tooling rework |
| Limits | generous | 128 MB heap, **50 ms CPU/req**, 100 MB cache obj, 32 backend subreqs (**10 on trial**) | Watch query-heavy paths |

_Sources: docs.fastly.com/products/compute-resource-limits, /products/edge-data-storage;
fastly.com/documentation (KV/Config/Secret stores, dynamic backends, Viceroy); js-compute reference
docs (SubtleCrypto, geolocation); docs.turso.tech (libSQL HTTP/serverless driver)._

**Confirmed ABSENT in this app → zero migration work:** HTMLRewriter, Cache API (`caches.*`),
WebSocket, Durable Objects, R2, Queues, Workflows, `passThroughOnException`, `nodejs_compat`,
email/`send_email`.

---

## Cloudflare surface area actually used (reconciled from code)

**Runtime is genuinely Web-standard** — no `nodejs_compat`, no `node:*`/`Buffer`/`process.env`; deps
are `itty-router`, `jose`, `escape-html`. Good portability to js-compute.

| Primitive | Binding(s) | Used for | Fastly target | Effort |
|---|---|---|---|---|
| **D1 (SQLite)** | `USER_LOGINS`, `AUDIT_EVENTS`, `SEARCH_EVENTS` — **1 physical DB** (`3db42334…`), +`search_event_markets` | login tracking, asset-activity audit, search metrics; ~32 `.prepare()` sites, `.batch()`, `last_insert_rowid()`, UPSERT, `INSERT OR IGNORE`, `strftime`/`DATE()` | **Turso/libSQL** (recommended — SQLite dialect, least churn) over a backend | **High** |
| KV | `AUTH_TOKENS` (IMS token cache, TTL+metadata), `MESSAGES` (notifications CRUD, `list({prefix})`) | token cache, notifications | Fastly **KV Store** | Medium |
| Secret Store | `COOKIE_SECRET`, `HELIX_ORIGIN_AUTHENTICATION`, `DM_CLIENT_ID`, `DM_CLIENT_SECRET` (+`ANALYTICS_API_TOKEN` → drop) | cookie signing, origin auth, DM/IMS creds | Fastly **Secret Store** (12 `.get()` sites) | Low-med |
| Plain vars | `HELIX_ORIGIN`, `DISABLE_AUTHENTICATION`, `DEBUG_ANALYTICS` | config | **Config Store** | Trivial |
| Outbound backends | 6 hosts: Adobe IMS, DM delivery (`delivery-*.adobeaemcloud.com`), COA, COA image hosts, Helix origin (`*--*--*.aem.page/live`), Entra JWKS | proxy + auth | Declared / **Dynamic Backends** | Low (mandatory) |
| `ctx.waitUntil` | — | fire-and-forget download/search tracking (`dm-analytics.js:340`) | Fastly async-after-response pattern | Medium |
| `request.cf.tlsVersion` | — | block TLS 1.0/1.1 (`index.js:42`) | Fastly TLS/downstream API | Low |
| `cf.cacheEverything` + `Cache-Control` | — | edge cache for Helix/sheets; `no-store` for token/archive polling | `CacheOverride` | Low-med |
| Cron Trigger | `'0 0 1 * *'` → `handleScheduledTokenRefresh` | **no-op placeholder** | external scheduler *if ever needed* | Trivial |
| Deploy | `wrangler-action@v4`, Versions + preview-aliases, per-PR worker+route on `frescopamedia.com` | CI/CD, PR previews | `fastly` CLI + versioning/activation + preview services | Medium-high (Phase 2) |
| Tests | `@cloudflare/vitest-pool-workers` — 23 files / 5 297 lines run in workerd | unit/integration | node-vitest / Fastly test story | Medium-high |

**DELETE (dormant/legacy, not ported):** Analytics Engine subsystem (`SPARK_ANALYTICS_ENGINE`,
`ANALYTICS_API_TOKEN`, `executeReportQuery`, ClickHouse builders, `/api/analytics/test`); the no-op
cron + `scheduled/token-refresh.js`; broken `cleanup.yaml` (references a missing script). Documented-
but-absent features (SAVED_SEARCHES / RIGHTS_REQUESTS KV, SMTP/email) are already not in the build.

---

## D1 replacement — options analysis (the one hard gap)

> 📊 **Deep-dive companion:** [`db-options-comparison.md`](./db-options-comparison.md) — full cost-by-tier tables
> (2026-09-14 pricing), paying-customer suitability, and a **multi-tenancy** analysis (per-customer DB vs shared).
> The summary below still drives the PoC decision.

D1 is the only dependency with no Fastly-native equivalent, so its replacement is the most consequential
decision in the migration. **Two hard constraints shape the choice:**

1. **Fastly Compute cannot open raw TCP sockets** (Wasm sandbox). The database must be reachable via an
   **HTTP/fetch-based driver** through a declared backend. This rules out pointing at plain Postgres/MySQL
   over a normal TCP connection pool — only serverless/HTTP drivers qualify.
2. **SQLite-dialect compatibility minimizes churn.** The app has ~32 prepared-statement sites and 3
   `schema/*.sql` files using SQLite-isms: `.batch()`, `last_insert_rowid()`, `INSERT … ON CONFLICT DO
   UPDATE`, `INSERT OR IGNORE`, `strftime()`, `DATE(...)`, `AUTOINCREMENT`, and a FK with `ON DELETE
   CASCADE`. A SQLite-compatible target ports these almost unchanged; a different engine means rewriting
   queries, schema, **and the SQL-dialect test assertions**.

### Comparison

| Option | Fastly-compatible driver | Dialect vs SQLite | Query/schema/test rewrite | Ops burden | Free tier |
|---|---|---|---|---|---|
| **1. Turso (managed libSQL)** ⭐ | ✅ `@libsql/client/web` / `@tursodatabase/serverless` (fetch) | **Same (SQLite)** | **Minimal** | None (managed) | Yes |
| 2. Self-hosted libSQL (`sqld`) | ✅ same libSQL HTTP protocol | Same (SQLite) | Minimal | **High (you run it)** | N/A (self-host) |
| 3. Neon (serverless Postgres) | ✅ `@neondatabase/serverless` (fetch/WS) | Different (Postgres) | **Moderate–high** | None (managed) | Yes |
| 4. PlanetScale (serverless MySQL) | ✅ `@planetscale/database` (fetch) | Different (MySQL) | **Moderate–high** | None (managed) | Limited/paid |
| 5. Keep Cloudflare D1 over its HTTP API | ✅ D1 REST API (fetch) | Same (SQLite) | ~none | None | Yes |

### Option details

**1. Turso (managed libSQL) — RECOMMENDED**
- *Pros:* libSQL is a SQLite fork, so `schema/*.sql` and the ~32 query sites (incl. `.batch()`,
  `ON CONFLICT`, `INSERT OR IGNORE`, `strftime`) port with minimal change; the **fetch-based driver** is
  purpose-built for edge/no-socket runtimes like Fastly; **edge replicas** cut read latency (matters since
  we lose D1's co-location); managed (no ops); generous free tier for the PoC.
- *Cons:* another third-party vendor/account; still need a thin D1→libSQL shim to match
  `.prepare().bind().first()/.all()/.run()/.batch()` + `last_insert_rowid()`; writes go to a single
  primary (write latency from distant POPs); relatively young product.

**2. Self-hosted libSQL server (`sqld`)**
- *Pros:* identical SQLite dialect + HTTP protocol benefits as Turso, but **no vendor**; full control;
  open source; can co-locate near the AEM/Adobe origins.
- *Cons:* **you operate it** — HA, backups, scaling, patching, TLS endpoint; no turnkey global edge
  replication; highest ops burden of the SQLite-compatible options.

**3. Neon (serverless Postgres)**
- *Pros:* mature, robust Postgres; **serverless HTTP/WebSocket driver** works on edge; autoscaling;
  **branching** (nice for per-PR previews); strong ecosystem; generous free tier.
- *Cons:* **Postgres dialect ≠ SQLite** → rewrite the ~32 query sites + schema (`strftime`→`to_char`,
  `DATE()`→`date_trunc`, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`, `last_insert_rowid()`→`RETURNING
  id`, `AUTOINCREMENT`→`GENERATED … AS IDENTITY`) **and** the SQLite-dialect test assertions; more effort
  and regression surface.

**4. PlanetScale (serverless MySQL / Vitess)**
- *Pros:* very scalable (Vitess); **fetch-based HTTP driver**; good DX and branching.
- *Cons:* **MySQL dialect ≠ SQLite** → same rewrite burden as Neon; Vitess discourages/omits FKs, so
  `search_event_markets`'s `ON DELETE CASCADE` moves to app logic; free tier has been curtailed (cost);
  MySQL-specific date functions.

**5. Keep Cloudflare D1, accessed over its HTTP API (transitional only)**
- *Pros:* **zero** schema/query/data-migration work; the app keeps talking SQLite; fastest way to get the
  Worker running on Fastly.
- *Cons:* **retains a hard Cloudflare dependency** — which defeats much of the migration's purpose; adds
  D1 REST API latency + rate limits; not a clean end-state. Useful only as a stepping stone to prove the
  compute move first and decouple the DB later.

### Recommendation (holds)
**Turso/libSQL** remains the recommendation. It is the **only** option that satisfies *both* hard
constraints at once: fetch/HTTP-native for Fastly's no-socket runtime **and** SQLite-dialect compatible,
so the schema, the ~32 query sites, and the existing SQL-dialect test assertions survive with minimal
rewrite. Neon and PlanetScale are perfectly viable Fastly-compatible databases, but each forces a dialect
rewrite (queries + schema + tests) that adds effort and risk for no benefit this app specifically needs.
Self-hosted libSQL keeps the dialect win but trades managed simplicity for ops burden — reconsider only
if vendor-independence or origin co-location is a hard requirement. D1-over-HTTP is a legitimate
*transitional* shortcut for the PoC if we want to defer the data-tier decision, but not an acceptable
production end-state (still tethered to Cloudflare).

> **Caveat that could flip the pick:** if the team already runs **Postgres** elsewhere (shared ops,
> existing expertise, one DB technology to maintain), **Neon** becomes the strongest alternative and the
> dialect rewrite may be worth it for organizational consistency. Worth confirming before Phase 1 (T1.6).

---

## Execution overview & effort

Estimates assume one engineer familiar with the code. **Do the runtime-compat spike (Phase 0) first** —
it retires the biggest "will it even work" unknown for the least cost.

| Phase | Goal | Effort | Checkpoint proves |
|---|---|---|---|
| **0 — Runtime spike** | De-risk auth crypto + routing on StarlingMonkey | **days** | The runtime is viable |
| **1 — PoC** | Get the app running on Fastly (greenfield data) | **~2–4 weeks** | Demoable end-to-end on a Fastly URL |
| **2 — Production parity** | Data migration, full tests, CI/previews, perf, cutover | **~1.5–3 months** | Production-ready |

The task-level breakdown and per-checkpoint verification follow.

---

## Detailed execution plan — tasks, sub-tasks & checkpoints

> 📋 **Execution progress, checkpoint results, and findings are logged in
> [`fastly-migration-log.md`](./fastly-migration-log.md).** The plan holds intent; the log holds what
> actually happened.

### Phase −1 — Pre-setup (your part: accounts & tooling — do this first)

> **DECISION (2026-09-10): Use your own free Fastly account for the PoC; AEM Edge Functions
> (CS-provisioned Fastly) is the production target (Phase 2), not the PoC starting point.**
> *Why:* fastest start, and the spike needs **direct** access to Fastly primitives (Viceroy,
> KV/Secret/Config stores, Dynamic Backends, `log-tail`) that a CS-provisioned account may gate behind
> `aio cli`. Proving *"does our code run on Fastly Compute?"* in isolation keeps the PoC clean; the code
> ports either way (both are Fastly Compute). **Flip to AEM's only if** company policy bars a
> personal/company Fastly account for this, **or** the AEM-EF team can hand over a provisioned account
> *today* with direct Fastly CLI + store access.
> *Parallel (non-blocking) discovery for the production path:* (1) is a Fastly account provisioned for
> this project's CS environment? (2) direct Fastly access or only `aio cli`? (3) direct access to
> KV/Secret/Config + Dynamic Backends?

**Fastly account — yes, create a free developer account.** ✅ It's the right starting point for the PoC.
- Two flavors: the current **free tier** (now requires a credit card to curb abuse, no paid commitment)
  and the **Compute development trial** (~$50/mo test credits; not for production, no SLA/support).
- ⚠️ **Trial/free accounts have lower limits:** ~**10 backend subrequests/request** (vs 32 prod) and
  **60 s** wall time. Fine for the PoC — but the **audit-summary** endpoint (`api/audit.js`
  `auditGetSummary`) issues ~10 DB queries; against an external DB that's ~10 backend subrequests in a
  single request, right at the trial ceiling. Mitigation is Task **T2.1** (consolidate those queries) or
  run that path on a production account.
- Sign-up: fastly.com → create account → verify. Then install the CLI and authenticate (T-Pre.2).

**Other accounts:**
- **Turso** (managed libSQL) free tier — the PoC database. *(Decision point: Turso/libSQL vs self-hosted
  libSQL vs Postgres — see "Key decisions". Recommended: Turso/libSQL, because the SQLite dialect means
  the existing `schema/*.sql` and most of the ~32 query sites port unchanged.)*
- **No new Adobe accounts.** Reuse existing IMS S2S creds (`DM_CLIENT_ID`/`SECRET`), the Helix origin
  token, and the Entra app registration. ⚠️ The Entra app's **redirect URIs must add the new Fastly
  hostname(s)** (T1.3) or OIDC login will fail on Fastly.

**Tooling:**
- Fastly CLI — `brew install fastly/tap/fastly`; then `fastly profile create` (paste an API token).
- `@fastly/js-compute` SDK (bundled by the CLI); **Viceroy** local server via `fastly compute serve`.
- Node ≥ 18 (repo CI already uses Node 24).

**Free-account limits & workarounds (none block Checkpoint 0):**
- **Deploy + test:** the free trial deploys Compute services and **auto-assigns a `*.edgecompute.app`
  domain** — a testable URL with no custom-domain setup; `fastly log-tail` works. Most of Phase 0 runs on
  **Viceroy (local)** anyway, which has no account limits.
- **Dynamic Backends — the one gotcha:** a free account **may need a support request** to enable it. It
  does *not* block Phase 0 — declare **static backends** for the known hosts (Entra JWKS, Turso, test
  origin) and use the `createLocalJWKSet` fallback (T0.2). **Request it on day 1 (T-Pre.6)** because
  Phase 1 needs it for the *variable* Helix/DM/COA-image hosts.
- **Data stores aren't needed for Phase 0** (the spike hardcodes a throwaway secret). Even so, trials
  include **1 Secret Store** and KV allows **250k ops/month** — ample for the PoC.
- **Per-request caps** (10 backend subrequests, 60 s) are far above the spike's 1–2 small fetches.
- **Sign-up:** the free tier requires a **credit card** (abuse-prevention gate, no paid commitment).

- [ ] **T-Pre.1** Create Fastly account (free tier or dev trial).
- [ ] **T-Pre.2** Install Fastly CLI (`brew install fastly/tap/fastly`); create a **Personal API token**
  in the Fastly dashboard (**Account → API tokens → Create token**, scope: *global*, or at least Compute
  read/write); run `fastly profile create` and paste it; verify with `fastly whoami`.
- [ ] **T-Pre.3** *(for T0.4 / Phase 1 data tier)* Create a Turso free-tier DB (`turso db create spark-poc`
  or via the UI); capture its **HTTPS URL** + **auth token**. Optional for the spike; required for Phase 1.
- [ ] **T-Pre.4** *(for the T0.2 crypto test)* Capture one real Entra **`id_token`** — log into the current
  app and, in DevTools, copy the `id_token` from the OIDC callback. *(Or skip it and tell me — I'll wire a
  throwaway RSA keypair/JWKS instead.)*
- [ ] **T-Pre.5** Confirm the Entra values we'll test against — **JWKS URL, issuer/tenant, client id
  (audience)** — from `cloudflare/src/config.js`. I can pull these; you just confirm they're current.
- [ ] **T-Pre.6** *(do early — approval may take time)* Request **Dynamic Backends** access for your
  account via Fastly support. Needed for Phase 1's variable hosts; Phase 0 works without it (static
  backends + `createLocalJWKSet`).

> ✅ **CHECKPOINT — Pre-setup done:** `fastly whoami` works; *(optional)* Turso URL reachable; *(optional)*
> an Entra `id_token` in hand. Nothing in the app has changed yet — you're ready for Phase 0.

---

### Phase 0 — Runtime-compat spike (days)

Throwaway project on a scratch branch; goal is to prove the load-bearing pieces run on StarlingMonkey
**before** investing in the full port. Runs **mostly on Viceroy (local)**, but **deploy once to a real
Fastly service** at the end — Viceroy approximates the edge but isn't identical (esp. backend fetch), so
one real deploy confirms it. Doubles as your account/CLI shakedown. **Needs:** T-Pre.1–T-Pre.2 done
(add T-Pre.3 only if you do the optional T0.4).

- [ ] **T0.1 — Scaffold a Fastly Compute JS service**
  - `fastly compute init` → choose **JavaScript** → the default starter kit, in a scratch dir on branch
    `spike/fastly-runtime`. Produces `fastly.toml`, `package.json`, `src/index.js`.
  - `npm install`; `fastly compute build` (bundles JS → Wasm); `fastly compute serve` (Viceroy on
    `http://127.0.0.1:7676`). Confirm the starter responds.
- [ ] **T0.2 — Validate the auth-crypto stack (the #1 risk)**
  - Copy the **actual** `cloudflare/src/util/http.js` `createSignedCookie`/`validateSignedCookie`;
    exercise the **HS256** `SignJWT → jwtVerify` round-trip with a `TextEncoder`-encoded secret.
  - **The crux — Entra RS256 via JWKS over a Fastly backend.** `createRemoteJWKSet(new URL(jwksUrl))`
    then `jwtVerify(idToken, JWKS, …)`. jose calls `fetch()` **internally without naming a backend**, so
    it only resolves if **Dynamic Backends are enabled** (service setting on deploy; enable for Viceroy
    too). Proving this is the whole point. **Fallback if it fails:** pre-fetch the JWKS over an explicitly
    named backend and use `createLocalJWKSet(jwks)` instead.
  - You need a **real Entra `id_token`** to verify — capture one from a live login to the current app
    (DevTools → the OIDC callback `id_token`), or generate a throwaway RSA keypair + JWKS to test offline.
  - Confirm `crypto.randomUUID()`, `crypto.subtle`, `TextEncoder`.
  - **How to run:** expose a `GET /spike/crypto` route that runs all checks and returns e.g.
    `{hs256:true, rs256:true, jwksFetch:true}`; hit it under `serve` **and** on the deployed service.
- [ ] **T0.3 — Validate routing + outbound backends**
  - Port a 2-route skeleton on `itty-router` + the `util/itty.js` CORS wrapper; confirm routing/CORS.
  - Locally, declare backends under `[local_server.backends]` in `fastly.toml`; on deploy, enable
    **Dynamic Backends**. Confirm a `fetch` to a backend returns 200.
- [ ] **T0.4 — (Recommended) Validate the libSQL client on Fastly** *(needs T-Pre.3)*
  - Retire the **other** hard integration in the same spike: `@libsql/client/web` (fetch-based)
    connecting to the Turso DB via a declared backend — run one `CREATE TABLE` + `INSERT` + `SELECT`.

> ✅ **CHECKPOINT 0 — "The runtime is viable."**
> **Works / testable** (via `/spike/*` routes, under Viceroy **and** on one deployed service):
> (a) HS256 cookie sign+verify, (b) real RS256 Entra token verified via **JWKS fetched over a Fastly
> backend** (the #2 risk), (c) itty-router + CORS, (d) an outbound backend fetch, (e) *(if T0.4)* a
> libSQL query to Turso.
> **Why it matters:** the cheapest possible proof that the auth layer + HTTP plumbing (+ optionally the
> DB driver) survive the V8→SpiderMonkey change. **If any fail, we learn it in days — before the full port.**
> **Not yet done:** any real app code, data, or config.

---

### Phase 1 — PoC: get the app running on Fastly (~2–4 weeks)

Target: a deployed Fastly preview running the real app. **Split into 1a (no DB) → 1b (DB)** so we get a
working portal early and isolate the one hard gap.

**Working approach:** on a **git branch** (`fastly-poc`), in a **parallel `fastly/` directory** — leave
`cloudflare/` untouched as reference + fallback. Iterate locally with Viceroy; deploy the branch to a
Fastly preview for end-to-end validation. Don't merge to `main` or touch `cloudflare/` during the PoC.

#### Phase 1a — the portal (no database)

Everything a user touches — login, browse, search, view/download, notifications — none of which needs the
relational DB (permissions come from EDS config sheets, not the DB). DB-backed reporting/audit is deferred
to 1b; its writes **degrade to log-only** so we can watch them fire without a DB.

> **Status (detail in `fastly-migration-log.md`):** ✅ **all 1a ports done** — T1a.1 config, T1a.2 router/utils,
> T1a.3 auth (real Entra login validated on :8787), T1a.4 **Helix + DM + COA proxies** (search returns real
> assets locally; COA renditions work end-to-end), T1a.5 KV adapter, T1a.6 degrades (audit/analytics log-only,
> smart-collections `[]`, `/api/*` JSON-404), **notifications** (degrade to EDS system notifications without KV),
> **page-access control** (ported as read-and-reconstruct — Fastly backend responses have no `.clone()`).
> ✅ edge deploy done (non-secret paths verified). ⏳ remaining for the Checkpoint 1a **finale**: (1) the edge
> **login** — blocked on the Entra redirect-URI admin step (see log); (2) a re-`publish` to push the
> COA/notifications/page-access routes to the edge.

- [x] **T1a.1 — Project scaffold & platform config**
  - Create `fastly/` (Compute project) on branch `fastly-poc`; author `fastly.toml`. Build uses
    `js-compute-runtime` (bundles npm deps — validated in Phase 0: jose + itty-router bundle clean).
  - **Config Store:** `HELIX_ORIGIN`, `DISABLE_AUTHENTICATION`, `DEBUG_ANALYTICS`.
  - **Secret Store:** `COOKIE_SECRET`, `HELIX_ORIGIN_AUTHENTICATION`, `DM_CLIENT_ID`, `DM_CLIENT_SECRET`.
  - **Backends (6):** IMS, DM delivery, COA, COA-image, Helix origin, Entra JWKS —
    `[local_server.backends]` + `[setup.backends]`; SNI where the cert host differs. *(No Turso backend yet.)*
- [x] **T1a.2 — Entry/router & shared utils**
  - Port `index.js` (router, `withAuthentication`, TLS guard, page-access catch-all).
  - Port `util/itty.js` (CORS) and `util/http.js` (cookies + signed cookies). Pure utils (`authz`,
    `log-utils`, `trusted-hosts`, `constants/*`, `config.js`) port as-is.
- [x] **T1a.3 — Auth + user**
  - Port `auth.js` + `user.js`; Secret Store `.get()` → Fastly Secret Store.
  - **JWKS fix (Phase 0):** replace `createRemoteJWKSet` → fetch the Entra JWKS over the declared backend
    + `createLocalJWKSet` + cache in KV.
  - Cookie `Domain`/`SameSite`/`Secure` + CORS allowlist include the Fastly host; add the Fastly host to
    the Entra app redirect URIs.
  - `upsertUserLogin` (DB) → **log-only degrade** (T1a.6).
- [x] **T1a.4 — Origin proxies**
  - `helix.js` (EDS proxy; origin-auth secret; `cacheEverything` → `CacheOverride`), `dm.js` (DM proxy;
    `getIMSToken` via KV `AUTH_TOKENS`; `decodeJwt`), `coa.js` + COA image (`trusted-hosts`),
    `asset-access.js` (as-is).
- [x] **T1a.5 — KV migration → Fastly KV Store**
  - `AUTH_TOKENS` (IMS token cache: get/put with an in-value expiry timestamp) and `MESSAGES`
    (notifications CRUD + `list({prefix})`).
- [x] **T1a.6 — Graceful degrade for DB paths (log-only)**
  - No DB binding is configured in 1a. Instead of silent no-ops, make the DB writes **log-only** so we can
    watch them fire in `log-tail`:
    - **Audit POST** (`/api/audit/event`): `console.log('[audit:degraded] would write', event)` → return
      `200`; **no write.**
    - Search/login tracking (`analytics-helper` `writeSearchEvent`, `upsertUserLogin`): same log-only pattern.
  - **Report reads** (`/api/analytics/search-metrics`, `/api/audit/*`): return an empty result with a
    `degraded: true` flag so the report pages render instead of erroring.
- [ ] **T1a.7 — Delete dead code & re-home async**
  - Delete the AE subsystem + the no-op cron/`scheduled`. Replace `ctx.waitUntil` tracking with Fastly's
    post-response pattern (or run synchronously for the PoC).
- [ ] **T1a.8 — Local run, smoke tests, deploy preview**
  - `fastly compute serve` (local uses `DISABLE_AUTHENTICATION=true`; full OIDC only on the deployed
    preview). `fastly compute publish` to a preview; `fastly log-tail` to watch the degrade logs.

> ✅ **CHECKPOINT 1a — "The portal runs on Fastly (no DB)."** On the deployed preview:
> - **Login** via Entra → session cookie set, `request.user` populated.
> - **Browse/search** assets (Helix + DM proxy) → images render.
> - **View/download** an asset → the audit event appears in `log-tail` as `[audit:degraded]` (logged, not written).
> - **Notifications** CRUD works (KV).
> **Not yet:** report/audit dashboards (render empty/degraded), historical data.

#### Phase 1b — reporting/audit (wire the database)

> **PoC decision (2026-09-14): wire the EXISTING Cloudflare D1 over its REST API** — don't stand up a new vendor
> DB yet. Rationale: **zero data migration** (real audit/search/login/smart-collection data appears in reports
> immediately), **zero dialect rewrite** (still SQLite), and it **decouples the compute migration from the
> data-tier vendor decision** (change one variable at a time). D1's REST `/query` is fetch-based → works from
> Fastly's no-socket runtime. Explicitly **transitional**: the production DB-vendor choice (Turso recommended;
> Neon/others per [`db-options-comparison.md`](./db-options-comparison.md)) and the data migration off Cloudflare
> move to **Phase 2 (T2.1)**.

- [ ] **T1b.1 — D1-over-HTTP client shim**
  - `platform/d1-http.js`: expose the D1 binding API (`.prepare().bind().first()/.all()/.run()` + `.batch()`,
    `last_row_id`) over the Cloudflare D1 REST API (`POST /accounts/{acct}/d1/database/{dbId}/query`, Bearer token).
  - The 4 bindings (`USER_LOGINS`, `AUDIT_EVENTS`, `SEARCH_EVENTS`, `SMART_COLLECTIONS`) all map to the **one**
    physical DB (`3db42334-…`) → one client, four env keys. Declare a `cf_api` backend (`api.cloudflare.com`).
  - Secrets/config (user-provided): `CF_API_TOKEN` (Secret Store, D1 read/write scope), `CF_ACCOUNT_ID` +
    `CF_D1_DATABASE_ID` (config store).
- [ ] **T1b.2 — Wire consumers + flip degrades → real reads/writes**
  - Port `api/audit.js`, `api/user-logins.js`, **`api/smart-collections.js`**, and the D1 parts of
    `api/analytics.js` (`writeSearchEvent`, `searchMetricsApi`, `analytics-helper` fan-out) to the shim via the
    env bindings. Flip the T1a.6 log-only writes **and the `/api/smart-collections` `[]` degrade** to real
    reads/writes; report reads return real data.
- [ ] **T1b.3 — Verify reports + smart collections populate**
  - `report-searches` (search metrics), `report-asset-activity` (audit), user-logins export, and
    **smart-collections list/save** — all read/write live data from the existing D1. **Decide:** point at the
    shared demo DB (real data; PoC writes land in it) or a cloned PoC copy (isolated).

> ✅ **CHECKPOINT 1b — "Reporting/audit works; full PoC parity."** A search shows in the Search report; an
> asset view/download shows in the Asset Activity report; login history records. Everything from 1a stays green.
> **Not yet done (Phase 2):** the production DB-vendor pick + data migration off Cloudflare, full test suite,
> per-PR previews, perf tuning, prod hardening, domain cutover.

---

### Phase 2 — Production parity (~1.5–3 months)

- [ ] **T2.1 — Data-tier hardening**
  - Production libSQL/Turso (or chosen DB); creds via Secret Store; edge replicas for read latency.
  - **Migrate existing D1 data** (export from Cloudflare D1 → import to libSQL).
  - Verify all ~32 query sites + `.batch()` + `last_insert_rowid()`; **consolidate the audit-summary
    ~10-query fan-out** (single round-trip / CTE) to fit the CPU + subrequest budget (esp. trial's 10).
- [ ] **T2.2 — Full test suite re-home**
  - Move all 23 files off `@cloudflare/vitest-pool-workers` to node-vitest (+ `@fastly/compute-testing`
    for integration). Rewrite the live-KV `notifications.test.js`. SQLite-dialect assertions stay valid
    on libSQL. **Add the missing auth-crypto coverage** (HS256 + Entra JWKS).
- [ ] **T2.3 — CI/CD parity**
  - `fastly` deploy workflows; versioning/activation; secret + config provisioning.
  - Rebuild **per-PR ephemeral preview services** + routing (replaces the Cloudflare per-PR
    worker+route automation in `build.yaml`). Delete the broken `cleanup.yaml` or re-implement.
  - Replace cron only if the monthly job ever gains real work.

> **Parity note — per-branch/PR preview URLs & Entra callbacks (raw Fastly vs `.aem.run`).**
> Two very different models; **prefer the AEM one** for parity:
>
> - **Raw Fastly Compute** (our PoC account): the `edgecompute.app` domain is **auto-assigned & random per
>   service** (not controllable — e.g. `annually-positive-egret`, spike `formally-modern-bird`), and there is
>   **no built-in per-branch preview** like Cloudflare Pages. Hosting multiple PRs at once = DIY: **one service
>   per PR + a custom domain you own + TLS**, scripted in CI. Only a custom domain gives clean names, e.g.
>   `pr-123.spark.preview.frescopamedia.com`.
> - **AEM CS-provisioned Fastly / Edge Functions (`*.aem.run`)** — the parity target: **branch-derived** URLs
>   using the **same `<branch>--<site>--<org>` convention EDS already uses** for this repo (`assethub-spark` /
>   `aem-showcase`). Controlled by the git branch name, multiple live simultaneously, no per-service plumbing —
>   the Cloudflare-Pages-like experience. **Prefer this over hand-rolling service-per-PR on raw Fastly.**
>
> | Branch | Content (EDS, exists today) | Edge Function (`.aem.run`) |
> |---|---|---|
> | `main` | `main--assethub-spark--aem-showcase.aem.live` | `main--assethub-spark--aem-showcase.aem.run` |
> | `dev` | `dev--assethub-spark--aem-showcase.aem.page` | `dev--assethub-spark--aem-showcase.aem.run` |
> | PR `pr-123` | `pr-123--assethub-spark--aem-showcase.aem.page` | `pr-123--assethub-spark--aem-showcase.aem.run` |
>
> (EDS sanitizes branch names — lowercased, non-alphanumerics → `-`; `<branch>--<repo>--<owner>` must fit a
> 63-char DNS label, so long names get truncated/hashed.)
>
> **Entra implication:** every distinct preview **hostname** needs its own callback. (**Path** wildcards like
> `…/*` *were* honored in this tenant — verified 2026-09-14, `…edgecompute.app/*` matched `/auth/callback` at
> runtime — but per-branch previews vary the **host/subdomain**, where wildcards are far more restricted; don't
> assume they work.) Register **stable** branches (`main`, `dev`) once in a **dedicated non-prod
> Entra app** — keeps dev/preview/branch callbacks off the production app (Mohit + jfait aligned, 2026-09-14,
> reuse existing app for the PoC only). Handle **ephemeral PR** callbacks via register-on-demand in CI, or
> funnel PR previews through one long-lived preview branch. (See the Entra notes in `fastly-migration-log.md`.)

- [ ] **T2.4 — Perf, cache & cutover**
  - Cache parity via `CacheOverride`; header hygiene; verify **no** authenticated/DM responses are cached.
  - Load-test DB-backed report/audit paths against the 50 ms CPU + subrequest limits.
  - Rebuild local dev tooling (`predev`, `local.sh`, seed scripts) on Viceroy.
  - Domain cutover (`frescopamedia.com`) with a **rollback plan**; wire real-time logging/observability.

> ✅ **CHECKPOINT 2 — "Production-ready."** Existing data present on Fastly; all tests green on the new
> runtime; CI + per-PR previews working; perf validated within limits; domain cut over with a tested
> rollback. Cloudflare can be decommissioned.

---

### Phase 2b — Hardening & accumulated TODOs (captured during the 1a port)

_Running list of work deferred or discovered while porting 1a, so it isn't lost. Not blocking the PoC._

**Finish the 1a portal (remaining ports):**
- [ ] **Page-access control** — port `origin/page-access.js` + re-enable it in the `index.js` catch-all
  (currently deferred → all authenticated users see all pages). Reads proxied HTML → must strip
  `accept-encoding` on that read (compression gotcha below).
- [ ] **COA proxy** — port `origin/coa.js` → `/api/adobe/coa/generate` + `/api/adobe/coa/image` (+ trusted
  hosts). COA-returned image hosts (`*.adobe.io`/`*.adobeaemcloud.com`) likely need Dynamic Backends.
- [ ] **Notifications** — port `api/notifications.js` (+ `util/notifications-helpers.js`) → `/api/messages/*`
  over the KV `MESSAGES` store (`list({prefix})`, get/put/delete).

**Correctness / hardening (found during the port):**
- [ ] **Secret-read caching (Fastly 5-reads/request cap).** The env adapter opens the Secret Store per
  `.get()`; one request can read several secrets (e.g. `DM_CLIENT_ID` twice + `COOKIE_SECRET`). Cache
  per-request to stay under the limit.
- [ ] **Required-secret value check.** `authRouter.before` checks `!env.COOKIE_SECRET`, but the adapter
  binding is always truthy, so it doesn't catch an *empty* secret value → `/auth/login` 500s (crypto
  "keyData length 0") instead of a clean 503 when `COOKIE_SECRET` isn't set. Check the resolved value.
- [ ] **Compression on bodies we read.** Fastly doesn't auto-decompress subrequest bodies. Fixed for
  `fetchHelixSheet`; still TODO wherever we read a proxied body — `dm-analytics` (`clonedResponse.json()`
  on the DM search response) and the page-access HTML read.
- [ ] **`response.clone()` unavailable on Fastly backend responses (SECURITY-relevant).** Guarded in
  `handleSearchAnalytics` (log-only, fine). But `enforceAssetMetadataAuthorization` (the `/metadata` GET
  access check for external users) also uses `clone()` — must switch to read-and-reconstruct
  (`arrayBuffer()` → `new Response`) so the authorization check actually runs instead of erroring/being
  skipped.
- [ ] **`ctx.waitUntil` replacement.** Fire-and-forget analytics currently floats (no `waitUntil` on
  Fastly) → may not finish before teardown. OK while log-only; choose a real post-response pattern (or run
  inline) when analytics goes real in 1b.
- [ ] **JWKS cache in KV.** `auth.js` caches the Entra JWKS in a module-level var (per-instance) — move to
  KV so it's shared across instances/POPs.
- [ ] **TLS-version enforcement.** CF's `withTlsCheck` (`request.cf.tlsVersion`) was dropped; re-add via
  Fastly's downstream TLS API if 1.0/1.1 blocking is required.
- [ ] **KV Store not enabled on the account (403 on `kv-store create`).** Enable the KV Store product in
  the Fastly dashboard, then declare `auth_tokens`/`messages` + provision on the edge to restore IMS-token
  caching and back notifications. The KV adapter degrades to no-persist meanwhile (nothing breaks).
- [ ] **Edge `preview` permission.** `createSession` treats hosts other than `localhost`/`frescopamedia.com`
  as non-live → requires the `preview` permission; handle `*.edgecompute.app` so edge login resolves full
  permissions.

**Deploy prep (Checkpoint 1a edge deploy):**
- [ ] Provision edge stores via `fastly` CLI: Config Store (`HELIX_ORIGIN`, `DISABLE_AUTHENTICATION=false`,
  `DEBUG_ANALYTICS`), Secret Store (real `COOKIE_SECRET`, `DM_CLIENT_ID/SECRET`,
  `HELIX_ORIGIN_AUTHENTICATION`), KV stores.
- [ ] Register the edge `*.edgecompute.app` `/auth/callback` in the Entra app redirect URIs.
- [ ] Verify Helix `Host`/`override_host` behavior on the edge (set only for local_server so far).
- [ ] Request **Dynamic Backends** access (T-Pre.6) for the variable Helix/DM/COA-image hosts.

**Cleanups to fold in (from the assessment):**
- [ ] Delete the dead AE subsystem, the no-op cron, and the broken `cleanup.yaml` when the CF worker is retired.

---

## Risk & effort register

Ordered most-severe first (effort × risk). **Gap?** = has no clean Fastly-native equivalent.
Effort/Risk scale: 🔴 High · 🟡 Medium · 🟢 Low.

| # | Area | Effort | Risk | Gap? | Mitigation / note |
|---|---|:---:|:---:|:---:|---|
| 1 | **D1 relational store → external DB** | 🔴 | 🔴 | **Yes** | The one hard gap. Turso/libSQL keeps SQLite dialect (see options analysis). |
| 2 | **Auth crypto** (`jose` HS256 + Entra RS256 JWKS) | 🟡 | 🟡 | Partial | **Phase 0 ✅ validated (Viceroy):** HS256, RS256, and JWKS-over-backend all pass. `createRemoteJWKSet` fails (`AbortSignal` missing) → use manual fetch + `createLocalJWKSet` + KV cache (**T1.3**). Risk 🔴→🟡; remaining: deploy-edge + real-token verify. |
| 3 | **`ctx.waitUntil`** fire-and-forget tracking | 🟡 | 🔴 | **Yes** | No post-response primitive on Fastly → writes become blocking, adding latency (compounded by external-DB RTT). **T1.7**. |
| 4 | **Reporting/audit CPU + subrequest budget** | 🟡 | 🔴 | No | Heavy in-JS aggregation + ~10 DB round-trips (`auditGetSummary`) vs **50 ms CPU** & **10-subreq trial cap**. Consolidate queries (**T2.1**). |
| 5 | **Test suite re-home** (23 files / 5,297 lines) | 🔴 | 🟡 | No | All run in `workerd` via vitest-pool-workers → node-vitest/Fastly; rewrite live-KV test; add auth-crypto tests. **T2.2**. |
| 6 | **CI/CD + per-PR preview infra** | 🔴 | 🟡 | Partial | Rebuild ephemeral worker+route automation on Fastly versioning/activation. **T2.3**. |
| 7 | **Cache correctness** (`cacheEverything`/`no-store` → `CacheOverride`) | 🟡 | 🟡 | No | Getting it wrong caches **authenticated/DM** responses — correctness/security. **T1.4, T2.4**. |
| 8 | **KV migration** (`AUTH_TOKENS`, `MESSAGES`) | 🟡 | 🟡 | Partial | No native per-key TTL (implement in-value); eventual consistency → watch redundant IMS token fetches / rate limits. **T1.5**. |
| 9 | **Declare 6 backends + Dynamic Backends** | 🟢 | 🟡 | No | Mandatory or every `fetch` fails; enabling Dynamic Backends also unblocks `jose` JWKS (#2). **T1.1**. |
| 10 | **Secret Store** (`.get()`, 12 sites) | 🟡 | 🟢 | No | Mechanical; mind the **5-reads/request** cap. **T1.1/T1.3**. |
| 11 | **Dev tooling → Viceroy** (`predev`, `local.sh`, seed scripts) | 🟡 | 🟢 | No | Rebuild local stack + store fixtures. **T2.4**. |
| 12 | **Deployment model** (Versions/preview-aliases → activation) | 🟡 | 🟢 | No | Different but well-trodden. **T2.3**. |
| 13 | **Config Store** (vars) + **`request.cf.tlsVersion`** | 🟢 | 🟢 | No | Direct mappings (Config Store; Fastly TLS API). |
| 14 | **Cron trigger** | 🟢 | 🟢 | Yes* | No Fastly scheduler, but *moot* — handler is a no-op. Only matters if scheduled work returns. |
| 15 | **Analytics Engine** | — | — | Yes† | †Dead code — **delete, don't port** (see headline finding). Not live work. |

**Takeaway:** after **D1 (#1)**, the items to worry about most are **auth crypto (#2)** and the **`waitUntil`/latency interaction (#3)** — both cheap to *de-risk early* in Phase 0/1 but expensive if found late. The biggest pure-*effort* sinks after D1 are the **test re-home (#5)** and **CI/preview infra (#6)**, both Phase 2.

---

## Areas to focus on / be careful of

1. **Auth crypto on a new runtime is the top risk — and it's untested.** `dm.test.js` mocks `jose`;
   `http.test.js` covers only cookie headers. The HS256 session-cookie sign/verify and Entra RS256
   JWKS path have **no executed-crypto tests**. A SpiderMonkey/js-compute switch could break login
   silently. This is exactly why **Phase 0 / T0.2** comes first.
2. **D1 was co-located (sub-ms); an external DB adds a network round-trip per query.** Query-heavy
   endpoints (audit summary ~10 parallel queries; search/report metrics) must fit the **50 ms CPU** +
   **subrequest** budget (**10 on trial**, 32 prod). libSQL/Turso edge replicas + query consolidation
   (T2.1) mitigate.
3. **Config ↔ code drift (already resolved by this audit).** The true binding set is *not* in
   `wrangler.jsonc` — `MESSAGES`, the AE binding, `ANALYTICS_API_TOKEN`, the cron, and
   `DISABLE_AUTHENTICATION`/`DEBUG_ANALYTICS` exist only in code. Build the Fastly config from
   **code ground-truth**, not `wrangler.jsonc` or the docs.
4. **Docs are unreliable for sizing.** `ARCHITECTURE.md`/`README` reference `wrangler.toml`, phantom KV
   namespaces, a removed email subsystem, and inconsistent AE dataset names. Treat `src/` as truth.
5. **KV semantics differ.** `AUTH_TOKENS` relies on per-key TTL expiration + `getWithMetadata`;
   `MESSAGES` on `list({prefix})`. Fastly KV Store TTL/list semantics differ — implement expiry/list
   logic in-app (T1.5).
6. **`waitUntil` fire-and-forget tracking** must still fire on Fastly without adding latency to the
   proxied response (T1.7).
7. **Cache correctness.** The `no-store` paths for token/archive polling and DM delivery must map
   correctly to `CacheOverride`, or you risk caching authenticated/DM responses (T1.4, T2.4).
8. **Per-PR preview infra is Cloudflare-specific** (per-PR worker + route automation). Rebuilding
   ephemeral Fastly preview services is real Phase-2 CI work (T2.3).
9. **`DISABLE_AUTHENTICATION` must never ship enabled** on Fastly (per this repo's own prior incident).
10. **Entra redirect URIs** must include the new Fastly hostname(s) or OIDC login fails (T1.3).
11. **Cleanup opportunities** the migration should fold in: delete dormant AE code, the no-op cron, and
    the broken `cleanup.yaml`.

---

## Key decisions for the follow-up migration plan
- **Fastly account / deployment target — DECIDED (2026-09-10):** own free Fastly account for the PoC;
  **AEM Edge Functions** (CS-provisioned Fastly) as the production home. See the Phase −1 decision note.
- **External DB target:** see **D1 replacement — options analysis** above — recommended **Turso/libSQL**;
  strongest alternative is **Neon (Postgres)** if the team already standardizes on Postgres.
- **Historical D1 data:** migrate vs start fresh (PoC = fresh; production parity = migrate — T2.1).
- **Login/download telemetry:** currently OFF (dormant AE). If it must return, design it into D1/audit,
  not AE. (Per-asset activity already lives in `audit_events`.)
- **Fire-and-forget** analytics pattern and **per-PR preview** strategy on Fastly.
- **Repo layout:** new `fastly/` tree alongside `cloudflare/` (parallel, easy rollback) vs a branch that
  replaces `cloudflare/`.

## Verification (how we'll prove it, per checkpoint)
- **Checkpoint 0:** Viceroy-local spike passes HS256 + Entra-JWKS crypto and a backend fetch.
- **Checkpoint 1:** deployed Fastly preview — login (Entra), a search (→ D1 `search-metrics`), a proxied
  DM asset fetch, notifications CRUD (→ KV), and both D1 reports all work; auth-crypto unit tests green.
- **Checkpoint 2:** data migrated, all 23 test files green on node-vitest/Fastly, per-PR previews live,
  perf within limits, domain cut over with rollback tested.
