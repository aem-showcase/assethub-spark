# FINDINGS — Porting the Spark/Frescopamedia server layer to Adobe App Builder

**Goal:** Feasibility PoC (Project Archimedes) — *"show what works or the hard limits."*
**Scope:** only the `cloudflare/` Worker layer; EDS frontend unchanged; deploy to default `adobeioruntime.net` URLs.
**Status:** deployed + verified live on Stage (`245266-sparkappbuilderpoc-stage`). Storage fully migrated **D1 → native `@adobe/aio-lib-db`** (all 4 tables).

## Bottom line
The single true blocker is the **1 MB response cap + no streaming**. App Builder cleanly hosts the portal's **JSON APIs, auth/session, KV, and relational/reporting data** (now on `aio-lib-db`) — but **not** its role as an authenticated **asset/page/image streaming proxy**. Redirect workarounds bypass the auth layer that is the portal's whole purpose. Everything else ports or is mitigated.

## Cloudflare ↔ App Builder (+ aio-lib-db) comparison
Verdict key (most → least severe): 🔴 blocks a core function · 🟡 minor · ⚪ soft gap · 🟢 ported/closed. **Confirmed** = observed live in this PoC.

| Concern | Cloudflare (today) | App Builder (target) | Verdict |
|---|---|---|---|
| **Response size / streaming** | Streams unlimited bodies (page + asset pass-through) | 1 MiB cap on the response message [[0]](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings) | 🔴 **CRITICAL** — breaks >1 MB response [[example]](https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/en/asset-details?assetid=cf6d8df6-7d90-4036-8d94-fca27686bd89&fn=Campaign%20Brief%20for%20Frescopa%20Coffee%20Brand%20Launch%20in%20Europe%20-%20Modified%20(1).pdf) |
| **Request payload** | Large request bodies | Request body **≤ 1 MB** [[0]](https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings) | 🟡 — ported POST bodies (audit events, collection/search writes) are small JSON well under 1 MB; only large uploads would hit it |
| **Analytics** | CF Analytics Engine | No equivalent; **search-metrics ported** to `aio-lib-db`, rest → `501` | 🟡 |
| **Secrets** | Secret Store (RBAC + audit) | Action inputs / `.env` | 🟡 — weaker isolation posture |
| **Local dev** | Miniflare local KV/D1 | No local storage emulation; dev hits cloud | 🟡 |
| **`request.cf`** (TLS/geo) | Exposed | Not available | 🟡 — drop TLS check (TLS at Adobe edge) |
| **Branch previews** | Automatic per-branch URLs (EDS) | Manual **workspace pool** + CI allocate/deploy/undeploy | ⚪ soft gap — out of PoC scope |
| **Routing / entry** | All traffic through one Worker at site root | Action URL `/api/v1/web/<pkg>/<action>`, not a root | 🟢 — dispatcher + **Path A** self-host under prefix (live); true domain root needs CDN |
| **Reserved extensions** | None | `.svg/.json/.html/.text` paths intercepted → **400** (confirmed) | 🟢 — `/x-asset` proxy dodges it (live) |
| **Auth / JWT** | `jose` + Entra SSO | `jose` on Node 22, unchanged | 🟢 — ported (live SSO needs `redirect_uri` registered in Entra) |
| **Cron** | `scheduled()` monthly | `/whisk.system/alarms` feed | 🟢 — ported (left un-triggered; handler is a no-op) |

**Pros of moving to App Builder:** native to Adobe/IMS; JSON API + auth + relational/reporting layer all run on-platform; managed document DB with aggregation reporting; simpler secrets/`.env`. **Cons:** no large/streamed responses (structural), cold-start + off-edge latency, no built-in per-PR previews, no relational SQL/transactions (worked around by modeling).

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
Entry point: `…/api/v1/web/spark/dispatcher` — one `dispatcher` (`web: raw`) action emulates the itty-router Worker.

| Area | Outcome |
|---|---|
| Dispatcher / routing | ✅ Ported — `__ow_*`↔Fetch adapters (`lib/ow-http.js`), route table + CORS replace itty |
| Auth — session + Entra verify | ✅ Ported — `jose` HS256 session + Entra JWKS verify on Node 22; `GET /api/user` → 200 |
| Auth — unauth gate | ✅ Ported — public allow-list serves; all other routes 302 → Entra SSO (live) |
| Auth — live SSO round-trip | ⚠️ Ported, not wired — needs `adobeioruntime.net` `redirect_uri` registered; PoC `/auth/dev-login` for testing (remove before shared use) |
| KV (`AUTH_TOKENS` → aio-lib-state) | ✅ Ported — `storage/kv.js` get/put/delete |
| SQL (D1 → `aio-lib-db`, all 4 tables) | ✅ Ported (native) — smart_collections CRUD; audit event/summary/csv; search write + 16 metrics; user_logins upsert + CSV |
| DM proxy — ContentAI asset search | ✅ Ported — unchanged `dm.js` behind binding shim; real IMS S2S token exchange; returns real assets (JSON < 1 MB) |
| DM/Helix — asset & page delivery | ⚠️ Partial — small binaries 200; large/streamed → 1 MB cap; `.svg` etc → reserved-extension (Path A) |
| COA AI-image binaries | ⛔ Blocked by 1 MB response cap |
| Notifications / non-search analytics | 501 stub (by design) |
| Cron (alarms) | ✅ Ported — deployed, intentionally un-triggered (no-op handler) |

## Data store: `aio-lib-db` vs D1 (is a document DB enough?)
`aio-lib-db` = AWS DocumentDB (Mongo-compatible). Aggregation pipeline (`$match/$group/$count/$lookup/$unwind/$project/$sort`) covers every report this app and the harder **koassets** app need (GROUP-BY, `COUNT(DISTINCT)`, monthly buckets, cohorts, one self-JOIN).

The four gaps and how they're handled:
- **`COUNT(DISTINCT)` 16 MB `$addToSet` cap** → two-stage `$group` (never builds a big array). ✅
- **Null-key dedup** → partial unique index. ✅
- **No multi-doc transactions** → embed bounded children → single atomic `updateOne`; idempotent/saga otherwise. ⚠️ by design
- **No FK / cascade** → same embedding, else app-enforced. ⚠️ by design

**Conclusion:** porting is **done and proven live**; transaction/FK guarantees moved from the DB into data modeling (e.g. `search_event_markets` FK → embedded `markets[]`). Use a purpose-built store only for strict multi-entity ACID or warehouse-scale OLAP. Report payloads still bound by the 1 MB response cap → paginate/aggregate server-side. Full plan + status: **`docs/D1-TO-AIOLIBDB-PLAN.md`**. Follow-ups (non-blocking): search-event write hook, one-time backfill (needs CF D1 token), Production `provisionRequest()`.

## Path A — browsable UI on the raw Runtime URL (no custom domain)
The routing and reserved-extension limits are engineering obstacles, not walls. Path A (`actions/lib/basepath.js` + dispatcher, driven by `BASE_PATH`) makes the whole portal work under the bare action prefix by rewriting URLs server-side (HTML `href`/`src`, redirects/`Location`, CSS `url()`, `localizePath()` JS) plus an injected client shim and a `/x-asset` proxy for reserved-extension assets. **Verified live on Stage:** Fréscopa home + `/en/search` render with styles, icons (via `/x-asset`), live Smart Collections card, and **0 broken icons**; SSO `redirect_uri` correctly prefixed. **Does NOT fix the 1 MB cap** — any single asset > ~1 MB still 400s, so production parity still wants a CDN/edge in front with the streaming asset tier kept off App Builder.

## Adapter gotchas (found wiring `dm.js`, handled in `lib/ow-http.js`)
- **Request body is base64** on `web: raw` (decode unconditionally; `__ow_isBase64Encoded` is response-only).
- **Platform recomputes transfer headers** — strip upstream `content-encoding/length`, `transfer-encoding`, `connection`, `keep-alive` (else HTTP 400 header/content mismatch).

## Sources
- **[0]** Adobe I/O Runtime — System Settings (1 MB `result` + `payload` caps, not configurable): https://developer.adobe.com/app-builder/docs/guides/runtime_guides/system-settings
