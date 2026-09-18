# FINDINGS: Porting the Spark/Frescopamedia server layer to Adobe App Builder

**Goal:** Feasibility PoC (Project Archimedes): show what works and where the hard limits are.
**Scope:** only the `cloudflare/` Worker layer. EDS frontend unchanged. Deploy to default `adobeioruntime.net` URLs.
**Status:** deployed and verified live on Stage (`245266-sparkappbuilderpoc-stage`). Storage fully migrated from **D1 to native `@adobe/aio-lib-db`** (all 4 tables).

## Bottom line
Only one real blocker: the **1 MB response cap and no streaming**.

- App Builder runs the JSON APIs, auth/session, KV, and reporting data well (now on `aio-lib-db`).
- It cannot be the authenticated proxy that streams assets, pages, and images.
- Redirect tricks skip the auth layer. That auth is the whole point of the portal.
- Everything else ports or has a workaround.

## Cloudflare ↔ App Builder (+ aio-lib-db) comparison
Verdict key (most → least severe): 🔴 blocks a core function · 🟡 minor · ⚪ soft gap · 🟢 ported/closed. **Confirmed** = observed live in this PoC.

| Concern | Cloudflare (today) | App Builder (target) | Verdict |
|---|---|---|---|
| **Response size / streaming** | Streams unlimited bodies (page + asset pass-through) | 1 MiB cap on the response message [[0]](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings) | 🔴 **CRITICAL** — breaks >1 MB response [[example]](https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/en/asset-details?assetid=cf6d8df6-7d90-4036-8d94-fca27686bd89&fn=Campaign%20Brief%20for%20Frescopa%20Coffee%20Brand%20Launch%20in%20Europe%20-%20Modified%20(1).pdf) |
| **Request payload** | Large request bodies | Request body **≤ 1 MB** [[0]](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings) | 🟡 — ported POST bodies (audit events, collection/search writes) are small JSON well under 1 MB; only large uploads would hit it |
| **Branch previews** | Automatic per-branch URLs (EDS) | Manual **workspace pool** + CI allocate/deploy/undeploy | ⚪ soft gap (needs manual setup, not built-in) — out of PoC scope |
| **Analytics Engine** | CF Analytics Engine | Reproducible on `aio-lib-db` (event capture + aggregation) | 🟡 — capability present, minor degrade in high-volume ingestion |
| **Secrets** | Secret Store (RBAC + audit) | Action inputs / `.env` | 🟡 — weaker isolation |
| **Local dev** | Miniflare local KV/D1 | No local storage emulation; local dev hits cloud DB | 🟡 |
| **Relational data** (4 tables) | **D1** — SQL, JOINs, transactions, native binding | **App Builder Data Services** via **`aio-lib-db`** — NoSQL document; aggregation incl. `$lookup` | 🟢 — all 4 tables rewritten + **live**; txn/FK handled by modeling (embedded arrays) |
| **KV cache** (`AUTH_TOKENS`) | CF KV | **`aio-lib-state`** — KV, ~1 MB/item, TTL ≤ 365 d | 🟢 — ported |
| **Routing / entry** | All traffic through one Worker at site root | Action URL `/api/v1/web/<pkg>/<action>`, not a root | 🟢 — dispatcher + **Path A** self-host under prefix (live); true domain root needs CDN |
| **Reserved extensions** | None | `.svg/.json/.html/.text` paths intercepted → **400** (confirmed) | 🟢 — `/x-asset` proxy dodges it (live) |
| **Auth / JWT** | `jose` + Entra SSO | `jose` on Node 22, unchanged | 🟢 — ported; live SSO wired (`redirect_uri` registered in Entra) |
| **Cron** | `scheduled()` monthly | `/whisk.system/alarms` feed | 🟢 — ported (left un-triggered; handler is a no-op) |

**Pros of moving to App Builder:**
- Native to Adobe and IMS.
- JSON API, auth, and the reporting layer all run on-platform.
- Managed document DB with aggregation reporting.
- Simpler secrets and `.env`.

**Cons:**
- No large or streamed responses. This is structural.
- Cold-start and off-edge latency.
- No built-in per-PR previews.
- No relational SQL or transactions. Worked around by modeling.

### Verified runtime limits (Adobe I/O Runtime `system_settings`, Sep 2026)
| Limit | Value |
|---|---|
| Web-action response | **1 MiB (1,048,576 B)** whole message, not configurable, no streaming |
| Activation input payload | **1 MB** |
| Binary response | base64 + `isBase64Encoded: true` |
| Blocking timeout | 60 s (non-blocking up to 1 h) |
| Memory | 128 MB – 4 GB (default 256 MB) |
| Node.js | 22 supported | 

## What ported (verified live on Stage)
Entry point: `…/api/v1/web/spark/dispatcher`. One `dispatcher` (`web: raw`) action emulates the itty-router Worker.

| Area | Outcome |
|---|---|
| Dispatcher / routing | ✅ Ported — `__ow_*`↔Fetch adapters (`lib/ow-http.js`), route table + CORS replace itty |
| Auth — session + Entra verify | ✅ Ported — `jose` HS256 session + Entra JWKS verify on Node 22; `GET /api/user` → 200 |
| Auth — unauth gate | ✅ Ported — public allow-list serves; all other routes 302 → Entra SSO (live) |
| Auth — live SSO round-trip | ✅ Ported and wired — `redirect_uri` registered in Entra; real SSO login works on Stage. `/auth/dev-login` stays as a PoC shortcut (remove before shared use) |
| KV (`AUTH_TOKENS` → aio-lib-state) | ✅ Ported — `storage/kv.js` get/put/delete |
| SQL (D1 → `aio-lib-db`, all 4 tables) | ✅ Ported (native) — smart_collections CRUD; audit event/summary/csv; search write + 16 metrics; user_logins upsert + CSV |
| DM proxy — ContentAI asset search | ✅ Ported — unchanged `dm.js` behind binding shim; real IMS S2S token exchange; returns real assets (JSON < 1 MB) |
| DM/Helix — asset & page delivery | ⚠️ Partial — small binaries 200; large/streamed → 1 MB cap; `.svg` etc → reserved-extension (Path A) |
| COA AI-image binaries | ⛔ Blocked by 1 MB response cap |
| Notifications / non-search analytics | 501 stub (by design) |
| Cron (alarms) | ✅ Ported — deployed, intentionally un-triggered (no-op handler) |

## Data store: `aio-lib-db` vs D1 (is a document DB enough?)
`aio-lib-db` is AWS DocumentDB (Mongo-compatible). Its aggregation pipeline (`$match/$group/$count/$lookup/$unwind/$project/$sort`) covers every report this app and the harder **koassets** app need: GROUP-BY, `COUNT(DISTINCT)`, monthly buckets, cohorts, and one self-JOIN.

The four gaps and how they're handled:
- **`COUNT(DISTINCT)` 16 MB `$addToSet` cap** → two-stage `$group` (never builds a big array). ✅
- **Null-key dedup** → partial unique index. ✅
- **No multi-doc transactions** → embed bounded children → single atomic `updateOne`; idempotent/saga otherwise. ⚠️ by design
- **No FK / cascade** → same embedding, else app-enforced. ⚠️ by design

**Conclusion:** the port is **done and proven live**. Transaction and FK guarantees moved from the DB into data modeling (for example `search_event_markets` FK became an embedded `markets[]`). Pick a purpose-built store only for strict multi-entity ACID or warehouse-scale OLAP. Report payloads still fall under the 1 MB response cap, so paginate and aggregate on the server. Full plan and status: **`docs/D1-TO-AIOLIBDB-PLAN.md`**. Follow-ups (non-blocking): search-event write hook, one-time backfill (needs CF D1 token), and Production `provisionRequest()`.

## Path A: browsable UI on the raw Runtime URL (no custom domain)
The routing and reserved-extension limits are engineering obstacles, not walls. Path A makes the whole portal work under the bare action prefix. It lives in `actions/lib/basepath.js` plus the dispatcher, driven by `BASE_PATH`.

What it does:
- Rewrites URLs on the server: HTML `href`/`src`, redirects and `Location`, CSS `url()`, and `localizePath()` JS.
- Adds an injected client shim.
- Uses a `/x-asset` proxy for reserved-extension assets.

**Verified live on Stage:** the Fréscopa home and `/en/search` render with styles, icons (via `/x-asset`), a live Smart Collections card, and **0 broken icons**. The SSO `redirect_uri` is correctly prefixed.

**It does not fix the 1 MB cap.** Any single asset over ~1 MB still 400s. So production parity still wants a CDN or edge in front, and the streaming asset tier stays off App Builder.

## Adapter gotchas (found wiring `dm.js`, handled in `lib/ow-http.js`)
- **Request body is base64** on `web: raw` (decode it always; `__ow_isBase64Encoded` is response-only).
- **Platform recomputes transfer headers.** Strip upstream `content-encoding`/`content-length`, `transfer-encoding`, `connection`, and `keep-alive`, or you get an HTTP 400 header/content mismatch.

## Sources
- **[0]** Adobe I/O Runtime System Settings (1 MB `result` + `payload` caps, not configurable): https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings
