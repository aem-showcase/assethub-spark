# FINDINGS — Porting the Spark/Frescopamedia server layer to Adobe App Builder

**Goal:** Feasibility PoC per Project Archimedes action item — *"show what works or if there are hard limits."*
**Scope:** Only the `cloudflare/` Worker layer; EDS frontend unchanged. Deploy to default
`adobeioruntime.net` URLs. **Storage decision (updated):** the PoC first kept **Cloudflare D1** over
its HTTP API (zero migration); the storage layer has since been **fully migrated to the native
`@adobe/aio-lib-db`** document DB — **all four D1 tables now run on-platform** (see the "Storage: D1 →
aio-lib-db (DONE)" banner below and `docs/D1-TO-AIOLIBDB-PLAN.md`).

Status legend: **Confirmed** = observed in this PoC · **Identified** = from PDF + code mapping,
not yet exercised in deployed code.

> ### ✅ Storage: D1 → `aio-lib-db` (DONE — verified live on Stage, 2026-09-14)
> The relational layer is **off Cloudflare D1 entirely**. All four features run natively on
> `@adobe/aio-lib-db` (managed NoSQL document DB, v1.0.3), verified end-to-end on the Stage namespace:
> - **smart_collections** — CRUD · **audit_events** — POST `/event` + GET `/summary` (10 aggregations,
>   incl. timeline) + `/export.csv` · **search_events** — write with **embedded `markets[]`** + all 16
>   metric pipelines · **user_logins** — login upsert-by-email (dedup, `$setOnInsert` first-login) + CSV.
> - Adapter `actions/storage/db.js` (OAuth S2S → IMS token, cached client + index bootstrap); the 4
>   handlers live in `actions/api/*-db.js`. The D1-over-HTTP shim (`actions/storage/sql.js`) is **no
>   longer on any request path** — it survives only as the read-source for the one-time backfill
>   (`scripts/migrate-d1-to-db.mjs`).
> - **Two documented follow-ups** (not blocking): (a) **search-event live writes** — the read side is
>   fully ported; the *write* trigger sits inside the reused CF DM flow (`writeSearchEvent`, raw SQL)
>   and needs a CF-side hook to retarget, so live search rows are populated via the migration script;
>   (b) the **backfill run** needs a Cloudflare D1 API token in `.env`, and **Production** needs a
>   one-time `provisionRequest()` (Stage is provisioned).

## PoC decisions & caveats
- **SQL store (superseded → done):** the PoC began by keeping **Cloudflare D1** over its HTTP REST API
  (zero migration; rejected Turso/Neon as incidental). That D1-over-HTTP path has since been **replaced
  by the native `@adobe/aio-lib-db` document DB for all four tables** — the SQL→document rewrite that
  limit #5 / the "Data-store deep dive" analysed is now **implemented and running** (see banner above).
- **Cloudflare D1 token — now only for the one-time backfill.** D1 is no longer read at runtime; a
  scoped D1 API token is needed **only** to run `scripts/migrate-d1-to-db.mjs` (read source rows →
  `aio-lib-db`). Use an **account-owned (service) token** (`Account · D1 · Edit`), not a personal one,
  and drop it after the backfill.
- **Runtime target:** Stage workspace, default `adobeioruntime.net` URLs; no CDN, no custom domain,
  no branch previews (all out of PoC scope).
- **Secrets:** reuse the 4 existing CF secret values via `.env` / action inputs (see limit #12); the
  `aio-lib-db` layer adds OAuth Server-to-Server creds (`OAUTH_CLIENT_ID/SECRET/SCOPES`) for IMS auth.

---

## Hard-limit table (running)

Ordered by severity. 🔴 = blocks a core portal function · 🟠 = significant rework/degradation · 🟡 = minor.

| # | Hard limit | Severity | Status | Evidence / where it bites | Workaround |
|---|---|---|---|---|---|
| 1 | **1 MB web-action response cap + NO streaming** — a web action must return one buffered result ≤ **1 MB** (non-configurable); binary must be base64 (`isBase64Encoded`), ~33% overhead → **~0.75 MB effective**. The worker's core job is **streaming pass-through** of pages + asset binaries. | 🔴 **CRITICAL** | **CONFIRMED BY DEPLOYED CODE** — empirical probe on the live dispatcher: bodies up to **1,024,000 B → HTTP 200**; at **1,048,576 B (exactly 1 MiB) → HTTP 400** `{"error":"Response is not valid 'message/http'."}`. The platform rejects the whole activation, not truncates. | `dm.js:1079 new Response(response.body,…)` streams multi-MB DM assets; `coa.js:180` streams AI image binaries; catch-all streams every HTML page + fonts/icons via `originHelix`. All exceed/stream. | **No true fix.** For binaries/large pages: **302-redirect** to origin/presigned URL instead of proxying → but that **bypasses the auth/access-control layer** the worker exists for. Only small JSON stays in-band. |
| 2 | **1 MB inbound activation payload cap** — request body ≤ 1 MB. | 🟠 Med | **Confirmed** (activation payload = 1 MB) | `coa.js` POST (prompt + assets), `auditPostEvent` batches, any upload. | Keep POST bodies small; redirect/chunk larger ones. |
| 3 | **Cold starts** — idle actions spin up a container (~100s ms → seconds). CF Workers (V8 isolates) have **none**. Adds latency in front of *every* request. | 🟠 Med | **Confirmed** (OpenWhisk container model) | Every proxied page/API call pays it when cold. | Keep-warm ping; accept for PoC. |
| 4 | **Not on the edge** — regional data centers, not edge PoPs; extra RTT proxying EDS/DM which are edge-fronted. | 🟠 Med | **Confirmed** | `…adobeioruntime.net` is regional. | CDN in front later; accept for PoC. |
| 5 | **No *relational / SQL* database** — storage = `aio-lib-state` (KV), `aio-lib-files` (blob), `aio-lib-db` (managed **NoSQL** document DB, Mongo-style, GA ~Mar 2026). None give D1-style **relational SQL + transactions** (which the PDF's own requirements ask for). | 🟠 Med | **RESOLVED for this app** — all 4 D1 tables **migrated to `aio-lib-db`** and verified live (SQL→aggregation rewrite done; `$group`/two-stage-distinct/embedded-array-`$unwind`). | 4 D1 bindings; `api/audit.js`, `analytics.js`, `smart-collections.js`, `user-logins.js` → now `actions/api/{smart-collections,audit,search,user-logins}-db.js`. | **Done: rewrote onto `aio-lib-db`** (100% on-platform). Residual gaps (multi-doc transactions + FK) handled by data modeling — e.g. `search_event_markets` FK collapsed into an **embedded `markets[]`** array. *(Note: large query results/CSV still hit #1.)* |
| 6 | **No native branch previews** — 1 workspace = 1 namespace; no `{ref}--{repo}--{owner}` URLs. | 🟠 Med | **Confirmed** | Project ships only `Stage` + `Production` workspaces. | Custom GitHub App + naming scheme (parity, out of scope). |
| 7 | **Routing / entry model** — action URLs are `/api/v1/web/<pkg>/<action>`, not a site root; no "all traffic through one worker" without a CDN. | 🟠 Med | **Confirmed** | `action_url` base `…adobeioruntime.net`. | `dispatcher` web action emulates the router. **Path A (implemented)** self-hosts the whole site under the action prefix via `BASE_PATH` rewriting — no custom domain needed (see "Path A" below). A real domain root still needs a CDN. |
| 8 | **No local storage emulation** — `aio app dev` hits the real cloud State/Files/DB; no Miniflare-style local D1/KV. | 🟡 Low | Identified | — | Point local dev at cloud `aio-lib-state` / `aio-lib-db`. |
| 9 | **No Analytics Engine** — CF-proprietary telemetry has no equivalent. | 🟡 Low | Identified | `api/analytics.js`, `config.ANALYTICS_ACCOUNT_ID`. | The D1-backed **search-metrics** report is ported to `aio-lib-db` (`/api/analytics/search-metrics`); the remaining **Analytics-Engine** endpoints (downloads/logins telemetry) stay `501`. |
| 10 | **No `request.cf`** — TLS version, geo, etc. not exposed. | 🟡 Low | Identified | `withTlsCheck` reads `request.cf.tlsVersion`. | Drop the TLS check (TLS at Adobe edge). |
| 11 | **State is KV, not a full DB** — 1 MB/item, ~10 GB/pack, TTL ≤ 365 days. | 🟡 Low | Identified (reconciled) | `AUTH_TOKENS` in `token-refresh.js`, `auth.js`. | `aio-lib-state` is adequate for a token cache. |
| 12 | **Secrets model differs** — no per-account Secret Store w/ RBAC+audit; secrets become action default params / `.env`. | 🟡 Low | Identified | `wrangler.jsonc` `secrets_store_secrets` (4). | Inject via action inputs / `.env`; weaker isolation posture. |
| 13 | **Reserved content-extension collision on path-proxying** — a web action's response is projected by the invocation URL's trailing extension. `.json`, `.html`, `.http`, `.text`, `.svg` are **reserved** OpenWhisk web-action extensions. Any proxied asset path ending in one is intercepted by that projection instead of passing through. | 🟠 Med → 🟡 (mitigated) | **CONFIRMED BY DEPLOYED CODE** — live: delivering `…/as/frescopa-logo-inverted.svg` (7 KB, well under 1 MB) → **HTTP 400** `Response type in header did not match generated content type`; the same asset as `.png`/no-extension/`.jpeg` → **HTTP 200** with the real binary. | DM/Helix deliver assets at `/api/adobe/assets/{id}/as/{name}` — every **`.svg`** logo/icon (and any `.json`/`.html`/`.text` asset) breaks; `.png`/`.jpg`/`.mp4`/`.webp` are unaffected. | **NOT absolute — URL-shape only. Path A works around it:** route reserved-suffix requests through a non-reserved endpoint (`/x-asset?p=<subpath>`). Verified live: raw `/favicon.svg` → 400, but `/x-asset?p=/favicon.svg` → **200 `image/svg+xml`**. (Also required treating `image/svg+xml` as *binary/base64* in `toOwResponse`, else the platform 400s the string body.) |

**Not a hard limit (ports with rework):**
- **Cron** — monthly `0 0 1 * *` (`scheduled/token-refresh.js`) → Runtime **`/whisk.system/alarms`** trigger. Ported but **left un-triggered on purpose** (handler is a no-op; see the Cron row in the results table for the activation commands).
- **Middleware/router** — `itty-router` → hand-rolled route table in the dispatcher.
- **Origin `fetch()`** — outbound to Helix/DM/COA/D1-HTTP works on Node **(but the *response* it returns is bound by #1)**.
- **Node 22** — supported (`nodejs:22`); ESM handled by the `aio app build` bundler.
- **Time/memory** — 60 s blocking timeout, 128 MB–4 GB memory — both fine for a proxy.

**Headline (corrected after audit):** for an **asset-distribution portal**, the dominant blocker is **not**
SQL — it's **#1: the 1 MB response cap + no streaming**. The worker exists to **stream pages and
asset/image binaries through an auth + access-control layer**; App Builder web actions structurally
**cannot return large or streamed bodies**, so the "serve the whole site + media through our edge
layer" model does not fit. What *does* port well: the **JSON `/api/*` endpoints and the auth/session
logic** (all naturally < 1 MB). What breaks: the **DM asset proxy, COA image proxy, and full-site
HTML/font/icon pass-through**. Any redirect-based workaround moves large responses *around* the action
— which defeats the per-request access control that is the portal's reason to exist. **This is the key
Archimedes finding: App Builder suits sprinkled JSON/business logic, not a full asset-serving edge proxy.**

### Runtime limits verified (Adobe I/O Runtime `system_settings`, Sep 2026)
| Limit | Value | Source |
|---|---|---|
| Web action response (result) | **1 MB**, not configurable | `system_settings.md` |
| Activation input payload | **1 MB** | `system_settings.md` |
| Streaming | **Not supported** (buffered request/response) | `understanding-runtime` |
| Binary response | base64 + `isBase64Encoded: true` | OpenWhisk web actions |
| Blocking timeout | **60 s** (non-blocking up to 1 h) | `system_settings.md` |
| Memory | 128 MB – 4 GB (default 256 MB) | `system_settings.md` |
| Code package | 22 MB · Logs 10 MB/activation | `system_settings.md` |
| Node.js | 22 supported (24 on Stage) | runtime `runtimes` doc |
| Cold starts | Yes (container spin-up) | `understanding-runtime` |

## Reconciliation with the PDF storage row
PDF (App Builder column): *"State (KV time limited), Files, AWS DocumentDB, I/O Events"*. Verified
against live Adobe docs (Sep 2026):
- **State** = `aio-lib-state` — KV, 1 MB/item, ~10 GB/pack, **TTL up to 365 days** (much less "time
  limited" than the PDF implies).
- **Files** = `aio-lib-files` — blob, 200 GB/file, presigned URLs.
- **AWS DocumentDB** = now shipped as **`aio-lib-db`** — managed **NoSQL document DB** (Mongo-style,
  16 MB/doc, per-workspace isolated), **GA ~Mar 2026** (newer than the PDF snapshot).
- **I/O Events** = event bus, not storage; not needed for this port.
**Takeaway:** the PDF row is directionally correct but predates `aio-lib-db` GA. The real gap is
*relational SQL*, not "a database." The PoC took both on-platform paths in sequence: first kept
D1-over-HTTP (zero rewrite), then **completed the rewrite onto `aio-lib-db`** (100% on-platform;
**reporting IS supported** via the aggregation pipeline — now demonstrated live). The residual gaps
(multi-doc transactions + FK) are handled by data modeling (see "Data-store deep dive"); e.g. the
`search_event_markets` child table became an embedded `markets[]` array.

---

## What ported cleanly / needed rework / was stubbed

**Deployed PoC (Stage):** `https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher`
— a single `dispatcher` (`web: raw`) action emulates the itty-router Worker; one non-web
`cron-token-refresh` action stands in for `scheduled()`. All rows below were exercised live.

| Area | Outcome | Verified on the deployed action |
|---|---|---|
| **Dispatcher / routing** | ✅ **Ported** (rework) | `web: raw` action + `__ow_*`→Fetch `Request` and `Response`→`{statusCode,headers,body}` adapters (`lib/ow-http.js`). Route table + reflective CORS replace itty. |
| **Auth — session + Entra crypto** | ✅ **Ported** (reuse) | `jose` HS256 session sign/verify + Entra `id_token` JWKS verify run unchanged on Node 22. `GET /api/user` → 200 with cookie. |
| **Auth — unauthenticated gate (Worker parity)** | ✅ **Ported** (reuse) | Mirrors the Worker's `withAuthentication`/`redirectToLoginPage` **and its public/gated boundary**: a small allow-list serves without auth (`/public|tools|scripts|styles|blocks|fonts|icons/*`, `favicon.ico`, `robots.txt`); **every other route — pages like `/en/search` AND `/api/*` — is 302-redirected into the Entra SSO flow** (`login.microsoftonline.com/…/authorize`), NOT answered with a bare 401. The original URL is preserved in an `AuthReturn` cookie. Verified live: `/en/search` and `/api/adobe/assets/contentai/search` with no session → **302** to Microsoft (`redirect_uri=…adobeioruntime.net/auth/callback`); `/styles/styles.css` → **200** (public); `/` → **302** to `/en/`. |
| **Auth — live Entra SSO round-trip** | ⚠️ **Ported, not wired** | `/auth/login`→Entra and `/auth/callback` (id_token verify) are implemented and the redirect fires, but the `adobeioruntime.net` `redirect_uri` isn't registered in the Entra app, so the round-trip can't *complete* from here. Mechanism proven; registration is a one-time external config step. A **PoC-only `/auth/dev-login`** mints a test session to exercise the authed paths — **must be removed before shared use.** |
| **Auth — roles/permissions, sudo** | ⛔ **Omitted (PoC)** | Worker resolves these from Helix `config/access/*` sheets + writes login analytics. The login-analytics write **is now ported** (`user_logins` upsert on the auth callback → `aio-lib-db`); the access-sheet role/permission resolution is still left out to keep the PoC focused. |
| **KV (`AUTH_TOKENS` → aio-lib-state)** | ✅ **Ported** (rework) | `storage/kv.js` mimics the CF KV `get/put/delete`. `GET /api/kv-demo` increments a State-backed counter across calls (1→2…). ⚠️ State keys must match `^[A-Za-z0-9-_.]+$` (no `:`). |
| **SQL (D1 → `aio-lib-db`, all 4 tables)** | ✅ **Ported → native** (rework) | **Migrated off D1 to the native `@adobe/aio-lib-db` document DB.** `actions/storage/db.js` (IMS-token adapter) + `actions/api/{smart-collections,audit,search,user-logins}-db.js`. Verified live on Stage: Smart Collections **CRUD**; audit **POST `/event` (204) / GET `/summary` (200, 10 aggregations) / `/export.csv` (200)**; search **write + all 16 metric pipelines (200)**; user_logins **upsert-by-email + CSV**. FK `search_event_markets` collapsed into an embedded `markets[]` array; `COUNT(DISTINCT)` → two-stage `$group`. The old D1-over-HTTP shim (`storage/sql.js`) is off the request path (migration read-source only). |
| **Stubs (notifications / non-search analytics)** | ✅ **As designed** | Now only `/api/messages*` (notifications) and the **Analytics-Engine** endpoints under `/api/analytics/*` (other than the ported `search-metrics`) → **501** with `x-appbuilder-limit` + machine-readable reason. Audit, search-metrics, user-logins CSV are **no longer stubs** — they run on `aio-lib-db`. |
| **DM proxy — ContentAI asset search** | ✅ **Ported** (reuse) | **`cloudflare/src/origin/dm.js` runs UNCHANGED** behind a binding shim (`AUTH_TOKENS`→aio-lib-state, `DM_CLIENT_ID/SECRET`→secret-shaped `{get}`, Analytics Engine→no-op, `ctx.waitUntil`→shim). Live `POST /api/adobe/assets/contentai/search` performs the **real IMS S2S `client_credentials` token exchange** (token cached in State as `dm-token-*`), injects the admin auth clause, and returns **real Frescopa assets as JSON** — **identical output local ↔ Stage** (JSON < 1 MB fits). |
| **DM proxy — asset/rendition delivery** | ⚠️ **Partial — bounded by limits #1 & #13** | Small binaries proxy live: `…/as/dripmachine.png` → **200** real PNG. But **large renditions/originals/video (67 MB mp4) exceed 1 MB → limit #1** (`toOwResponse` 502 / platform 400), and any **`.svg`/`.json`/`.html` asset path → limit #13** (HTTP 400 extension collision). Renditions auto-optimize so *some* fit, but full-fidelity delivery does not. |
| **Origin proxy (Helix)** | ⚠️ **Partial — bounded by limit #1** | `origin/helix.js` fetches the real EDS origin; small assets serve (favicon/robots/CSS/JS 200). `toOwResponse` returns **502 `x-appbuilder-limit: response-1mb`** above 1 MB. The **platform itself** rejects ≥1 MiB with HTTP 400 (see limit #1) — **empirically confirmed** via `/api/limit-probe?bytes=N`. |
| **Origin proxy (COA AI-image binaries)** | ⛔ **Blocked by limit #1** | Multi-MB AI-image streaming cannot be returned buffered; would require auth-bypassing redirects. Not ported. |
| **Cron (alarms)** | ✅ **Ported** (rework) — **intentionally left un-triggered** | `cron-token-refresh` non-web action deployed; the schedule maps to the Runtime **alarms feed** (`/whisk.system/alarms`, `0 0 1 * *`). **The trigger/rule are deliberately NOT wired** because the handler is a **no-op** — it mirrors the Worker's `scheduled()`, which is itself a placeholder (email OAuth was removed). Wiring it would fire an empty tick; it demonstrates nothing until real refresh logic exists. Port is proven; activation is a two-command post-deploy step (below) if/when needed. |
| **Deploy + verify** | ✅ **Done** | `aio app deploy` (namespace `245266-sparkappbuilderpoc-stage`); all endpoints smoke-tested live. |

> **Activating the cron (only if real refresh logic is added).** The action is deployed but has no
> trigger bound, by design (the handler is a no-op). To schedule it, create an alarms-fed trigger and a
> rule that binds it to the action:
> ```bash
> aio runtime trigger create monthlyRefresh \
>   --feed /whisk.system/alarms/alarm --param cron "0 0 1 * *"
> aio runtime rule create refreshRule monthlyRefresh cron-token-refresh
> ```
> Until then it is intentionally dormant — wiring it would only fire an empty monthly tick.


### Bottom line
The **JSON API + auth/session + KV + relational data (now native `aio-lib-db`) + DM ContentAI asset
search** layers **port cleanly and are running live** on App Builder — including the **unchanged
`dm.js` proxy** doing a real IMS S2S token exchange and returning real assets, and **all four former-D1
tables migrated to the on-platform document DB**. The **asset/page/image proxy does not** — the deployed
code hits the **1 MiB / no-streaming wall (HTTP 400, limit #1)** and the **reserved content-extension
collision (HTTP 400, limit #13)**, empirically confirming the headline finding: **App Builder fits the
portal's business logic (incl. its relational/reporting layer), not its role as an authenticated
asset-serving edge proxy.**

## Cloudflare ↔ App Builder capability comparison

Focused side-by-side on two decisions that shape any production port. Each has its own
detail table below the summary.

| # | Concern | Cloudflare (today) | Adobe App Builder (target) | Verdict |
|---|---|---|---|---|
| **1** | **Per-PR preview / branch URLs** (open PR → isolated deploy → URL → auto-teardown) | **Automatic, zero-config** via EDS/Helix: push a branch → `branch--repo--owner.aem.page` instantly; ephemeral, per-commit, no setup | **No native ephemeral previews.** Must **pre-create a workspace pool** (`pr-01…pr-N`), each with **API entitlements + credentials + Entra redirect URI wired once**; CI then **allocates a free slot → `aio app deploy --workspace pr-N` → `undeploy` on close**. Pool size caps concurrent previews; needs allocation/locking | ⚪ **Soft gap** — achievable via workspace pool + CI, but assembled manually vs built-in |
| **2** | **Relational data store** (Smart Collections, audit, search, user-logins) | **D1** — relational **SQLite**: full **SQL, JOINs, transactions**, native Worker binding | **No relational SQL**, but a full document DB: **`aio-lib-db`** = **DocumentDB/Mongo** (`insertOne/find/updateOne`, `$gte/$in/$set`; aggregation pipeline **with `$lookup` (joins)** for reporting; **no multi-doc transactions/FK**; IMS-token auth) and **`aio-lib-state`** = **KV** (TTL ≤ 365 d, ~1 MB/item, no query). Porting = **schema + query rewrite** — **DONE for all 4 tables, verified live** | 🟢 **Closed for this app** — the SQL→document rewrite is **implemented on `aio-lib-db`** (reporting incl. two-stage distinct + embedded-array unwind runs live); the general gaps (multi-doc transactions + FK) were handled by modeling |

### Item 1 detail — per-PR preview flow (the two halves)

| Sub-step | Cloudflare / EDS | App Builder |
|---|---|---|
| Create environment | automatic on push | **one-time** pool setup (entitlements + creds + Entra redirect URI per slot) |
| Deploy | automatic | `aio app deploy --workspace pr-N` (supported, easy) |
| URL | ephemeral per branch/commit | one per pooled workspace |
| Teardown | automatic on branch delete | `aio app undeploy` → release slot back to pool |

Why a **pool** (not create-per-PR): a workspace must already have its **API services/entitlements
added** and **credentials generated** before CI can authenticate a deploy — permission-gated, mostly
manual steps. Do them once per slot up front; CI only does the cheap allocate-and-deploy. `adobe/aio-apps-action`
deploys to **pre-existing** workspaces only; fully dynamic create is possible via the Console API but
you must also provision services + generate creds (+ register the Entra redirect URI for this app).

### Item 2 detail — data store capability grid

| Capability | CF **D1** | **`aio-lib-db`** | **`aio-lib-state`** |
|---|---|---|---|
| Model | Relational SQL (SQLite) | NoSQL document (Mongo-like) | Key-value |
| JOINs (read) | ✅ | ✅ via `$lookup` | ❌ |
| Aggregation reporting | ✅ SQL | ✅ pipeline (`$group`/`$count`) | ❌ |
| Multi-doc transactions | ✅ | ❌ (design around) | ❌ |
| Referential integrity / FK | ✅ | ❌ (app-enforced) | ❌ |
| Ad-hoc queries | ✅ SQL | ✅ Mongo-style filters | ❌ (key lookup only) |
| Native to platform | ✅ binding | ✅ (IMS-token auth) | ✅ (namespace auth) |
| Limits | SQLite scale | document store | ~1 MB/item, TTL ≤ 365 d |
| Effort to adopt for this app | — (was current) | **schema + query rewrite — DONE (all 4 tables live)** | fits token cache only |
| PoC choice | migration read-source only | **adopted (all 4 tables)** | **used for `AUTH_TOKENS`** |

### Data-store deep dive — is `aio-lib-db` enough for reporting-style products?

**Question:** beyond this PoC, can a document DB (`aio-lib-db` = **AWS DocumentDB**, Mongo-compatible
API 8.0) back the *reporting* features these portals need — or is relational SQL actually required?

**Evidence from two real apps in this architecture:**
- **assethub-spark** (this repo): the 4 D1 features use **zero JOINs and zero transactions** — Smart
  Collections is plain CRUD, user-logins is upsert-by-email, audit is append + `GROUP BY/COUNT`. Its
  heavy analytics run on **CF Analytics Engine, not D1**.
- **koassets** (`~/Work/Git/aem/assets/ASTRA/koassets`, same CF architecture): a *harder* test — it
  deliberately **moved analytics into D1** (permanent `login_events`/`search_events`/`download_events`)
  and runs real dashboards: `GROUP BY month/role/geo`, `COUNT(DISTINCT koid)`, first-touch cohorts
  (`GROUP BY koid HAVING MIN(ts) BETWEEN`), one **self-JOIN** (first download by month+country), plus a
  rights-request **workflow** (`rights_requests` + comment child tables). Still **no `.batch()` /
  transactions** anywhere.

**Capability check (verified against DocumentDB / `aio-lib-db` docs):** the aggregation pipeline supports
`$match/$group/$count/$lookup/$unwind/$project/$sort/$limit/$skip`. Every koassets report maps —
GROUP-BY counts, `COUNT(DISTINCT)`, monthly buckets, cohorts (`$group`+`$min`), and the self-join
(`$lookup`).

**The four genuine gaps — and whether implementation overcomes them:**

| Gap | Overcome? | How |
|---|---|---|
| `COUNT(DISTINCT)` 16 MB `$addToSet` group cap | ✅ fully | **two-stage `$group`** (`{_id:{bucket,koid}}` → count) — never builds a big array |
| Null-key dedup (SQLite "NULLs distinct") | ✅ fully | **partial unique index** (`partialFilterExpression:{koid:{$exists:true}}`) — DocumentDB 5.0+ |
| No multi-document transactions (`aio-lib-db` exposes none) | ⚠️ by design | **embed bounded children in the parent doc** → the multi-write becomes one atomic `updateOne`; cross-collection cases use idempotent writes / saga |
| No FK / referential integrity / cascade | ⚠️ by design | same embedding removes the reference; else app-enforced integrity |

**16 MB per-document limit** — not a wall, a modeling rule: **embed bounded children** (comment threads);
keep **unbounded data as standalone docs** (one per event, so the growing event tables never approach
it); **bucket** large arrays; **externalize big blobs to `aio-lib-files`** with a reference. Note the
tension: embedding is what grants single-doc atomicity (fixes the transaction gap) *and* removes the FK
— but an *unbounded* child forces a referenced collection again, re-introducing app-enforced integrity.
Per-entity rule: **bounded child → embed; unbounded child → reference/bucket.**

**Conclusion.**
- **Porting this D1 app to `aio-lib-db` is done and proven** — the four tables were rewritten
  (SQL → `find`/`aggregate`), deployed, and verified live on Stage. The only lasting change is that
  **transaction/FK guarantees moved from the DB into application code / data modeling** (e.g. the
  markets FK became an embedded array). A *harder* app like koassets (self-JOINs, cohorts, workflow
  child tables) maps the same way.
- **A future greenfield product** with the same reporting shape is **cleanly supported** — document-first
  modeling makes these patterns natural, with no rewrite or migration.
- **Draw the line** (pair with, or use instead, a purpose-built store) when the product needs **strict
  multi-entity ACID** (ledgers/inventory) or **warehouse-scale real-time OLAP** (billions of events,
  sub-second BI) — DocumentDB aggregation is not a columnar analytics engine. Also: report *payloads*
  returned per call remain bound by the **1 MB action response cap (#1)** → paginate / aggregate
  server-side.

> **Executable migration plan + implementation status:** the concrete step-by-step to *replace* D1 with
> `aio-lib-db` in this repo (Console provisioning, per-table collection model + index plan, SQL→aggregate
> rewrite inventory, data migration, parity tests, cutover/rollback) lives in
> **`docs/D1-TO-AIOLIBDB-PLAN.md`**. Status: **✅ IMPLEMENTED & VERIFIED LIVE** — all 4 tables on
> `aio-lib-db`; remaining follow-ups are the search-event write hook and the one-time backfill run
> (needs a CF D1 token); Production needs a one-time `provisionRequest()`.

### Path A — self-hosting the UI on the raw Runtime URL (no custom domain)
The prefix problem (#7) and the reserved-extension problem (#13) are **not** absolute — only the 1 MB
cap (#1) is. **Path A** makes the *whole browsable portal* work on the bare
`…adobeioruntime.net/api/v1/web/spark/dispatcher/` URL, with **no custom domain/CDN**, by rewriting URLs
so everything stays under the single action prefix. Implemented in `actions/lib/basepath.js` +
dispatcher wiring, driven by the `BASE_PATH` input (empty locally = root; set to the action path on Stage).

**How it works (all server-side + one injected client shim):**
1. **Served HTML rewrite** — root-absolute `href`/`src` (`/scripts`, `/styles`, `/en`, …) are prefixed
   with `BASE_PATH`; reserved-suffix refs (`/favicon.svg`) are routed to `/x-asset?p=…`.
2. **Redirect + `Location` rewrite** — the app's own 302s (root→`/en/`, SSO `redirect_uri`, login return)
   and upstream Helix redirects are prefixed, so navigation stays under the action.
3. **`/x-asset` proxy endpoint** — a non-reserved path that re-proxies `?p=<subpath>` to Helix, dodging
   the reserved-extension gateway (#13) for `.svg`/`.json`/`.html` assets.
4. **Injected `<head>` shim** — pins `window.hlx.codeBasePath = BASE_PATH` (so EDS loads blocks/styles
   under the prefix) and patches `fetch`/`XHR` to remap **runtime-constructed** root-absolute and
   same-origin-absolute requests (EDS fragments, API calls, block data). To avoid the transient 404 of
   the old observe-then-rewrite approach, it also patches the DOM **at the source** —
   `HTMLImageElement.src`, `Element.innerHTML`/`insertAdjacentHTML`, and `setAttribute` — so injected
   `<img src="/icons/*.svg">` are correct on their FIRST request; a `MutationObserver` remains as a
   backstop. The remap is idempotent (already-based paths are canonicalized before re-routing).
5. **`localizePath()` rewrite (programmatic navigation)** — the app navigates via
   `window.location.href = localizePath('/search')`, a **full-page navigation** the shim *cannot* hook
   (the `Location` interface is `[LegacyUnforgeable]`). Since nearly all such nav funnels through the
   frontend's `localizePath()` (`scripts/locale-utils.js`), the dispatcher rewrites that one proxied JS
   module on the fly (`rewriteLocalizeJs`): it renames the original function and exports a wrapper that
   prefixes `codeBasePath` (skipping resource/proxy paths; idempotent for already-based results). Fails
   closed — if the source marker ever changes it no-ops. **Verified live on Stage:** clicking **Search**
   now navigates to `…/dispatcher/en/search?query=…&sortType=topResults&…` (was hitting the bare domain
   root → 404). This is self-contained in the App Builder deploy (no frontend/main-branch change), so it
   travels to the Production workspace unchanged.
6. **CSS `url()` rewrite** — CSS background/mask icons (`mask: url('/icons/arrow-black.svg')`) are fetched
   by the browser relative to the ORIGIN root, bypassing every JS hook. The dispatcher rewrites
   root-absolute `url(/…)` in proxied `text/css` (`rewriteCss`): reserved-ext assets → `/x-asset`, the
   rest base-prefixed. This took the search page from **16 → 1** raw `.svg` 404s — the remaining one is a
   genuine origin 404 (the icon file doesn't exist on the branch; it 404s on production too).

**Verified live on Stage (headless Chrome against the raw URL):** the full Fréscopa home renders —
styles applied, category carousel **icons load** (svg via `/x-asset`), and the **"Featured Smart
Collections"** section shows the real live-DA "Spring Launch 2026 campaign" card with its DM thumbnail.
The `/en/search` results page renders with **0 broken icons** (all `/icons/*.svg` route via `/x-asset`);
the only residual 404s are **origin/content** (missing `chevron-down.svg`, absent `configs.json`/
`placeholders.json`, and search-index rows pointing at DM asset URNs that don't exist in the repo — all
404 on the origin itself, independent of Path A). `smart-collections` block `data-block-status="loaded"`,
`codeBasePath` correct. Auth redirect_uri is also correctly prefixed to `…/dispatcher/auth/callback`.
Screenshot proof in the session
artifacts (`stage-pathA-home.png`).

**Residual limits Path A does NOT fix:**
- 🔴 **1 MB / no-streaming (#1) is untouched** — any single asset > ~1 MB (large originals, fonts, video,
  full-fidelity renditions) still 400s. EDS auto-optimized page media happens to fit; arbitrary assets do not.
- **Transient/cosmetic 404s:** the browser's implicit `/favicon.ico` root request (un-interceptable), and
  a few DOM-injected icon `<img>` whose *initial* root request fires before the `MutationObserver`
  rewrites them — they then reload correctly via `/x-asset` (final page has 0 broken images).
- **Fragility:** the shim covers `fetch`/`XHR`/DOM mutations, but any URL an unported script builds in an
  exotic way (Workers, `sendBeacon`, CSS `url()` in JS-authored styles) could still escape. Fine for a
  demo; a real deployment should use a CDN/custom-domain root (Path B) instead of URL rewriting.

**Takeaway:** a browsable, authenticated UI on the raw Runtime URL is achievable and is demonstrated —
so #7 and #13 are *engineering* obstacles, not walls. The one true wall remains #1 (streaming/large
assets), which is why production parity still wants an edge/CDN in front and the streaming asset tier
kept off App Builder.

### Adapter-level portability gotchas (found & fixed while wiring `dm.js`)
Two behaviours that are invisible locally but break on Stage — worth flagging for anyone porting a
Fetch-based proxy to `web: raw`:
1. **Request body is base64.** A `web: raw` action always delivers `__ow_body` **base64-encoded**
   (the `__ow_isBase64Encoded` flag is response-only), so the adapter must decode unconditionally.
   Symptom before fix: `Unexpected token 'e', "eyAicXVlcn"… is not valid JSON`.
2. **The platform recomputes transfer headers.** Passing the upstream `content-encoding`/`content-length`
   back (after `fetch()` already decompressed) makes the declared encoding disagree with the bytes →
   HTTP 400 `Response type in header did not match generated content type`. The adapter now strips
   `content-encoding`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`.
Both are handled in `lib/ow-http.js`; the local harness (`scripts/local.mjs`) mirrors the base64 request
contract so local behaviour matches Stage.
