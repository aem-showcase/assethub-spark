# FINDINGS — Porting the Spark/Frescopamedia server layer to Adobe App Builder

**Goal:** Feasibility PoC (Project Archimedes) — *"show what works or the hard limits."*
**Scope:** only the `cloudflare/` Worker layer; EDS frontend unchanged; deploy to default `adobeioruntime.net` URLs.
**Status:** deployed + verified live on Stage (`245266-sparkappbuilderpoc-stage`). Storage fully migrated **D1 → native `@adobe/aio-lib-db`** (all 4 tables).

## Bottom line
The single true blocker is the **1 MB response cap + no streaming** (row R1). App Builder cleanly hosts the portal's **JSON APIs, auth/session, KV, and relational/reporting data** (now on `aio-lib-db`) — but **not** its role as an authenticated **asset/page/image streaming proxy**. Redirect workarounds bypass the auth layer that is the portal's whole purpose. Everything else ports or is mitigated.

## Cloudflare ↔ App Builder (+ aio-lib-db) comparison
Verdict key (most → least severe): 🔴 blocks a core function · 🟠 rework/degradation · 🟡 minor · ⚪ soft gap · 🟢 ported/closed. **Confirmed** = observed live in this PoC.

| # | Concern | Cloudflare (today) | App Builder (target) | Verdict |
|---|---|---|---|---|
| R1 | **Response size / streaming** | Streams unlimited bodies (page + asset pass-through) | One buffered result **≤ 1 MB**, no streaming; binary base64 (~0.75 MB effective). **Confirmed:** 1,024,000 B → 200, 1,048,576 B → **HTTP 400** | 🔴 **CRITICAL** — breaks DM/COA/HTML proxy; only small JSON fits |
| R3 | **Latency** | V8 isolates, edge PoPs, no cold start | Container **cold starts** (~100 ms–s), **regional** DCs | 🟠 — extra RTT vs edge; acceptable for PoC |
| R2 | **Inbound payload** | Large request bodies | Request body **≤ 1 MB** | 🟡 — no ported endpoint nears it (COA already dead via R1) |
| R10 | **Analytics** | CF Analytics Engine | No equivalent; **search-metrics ported** to `aio-lib-db`, rest → `501` | 🟡 |
| R12 | **Secrets** | Secret Store (RBAC + audit) | Action inputs / `.env` | 🟡 — weaker isolation posture |
| R13 | **Local dev** | Miniflare local KV/D1 | No local storage emulation; dev hits cloud | 🟡 |
| R14 | **`request.cf`** (TLS/geo) | Exposed | Not available | 🟡 — drop TLS check (TLS at Adobe edge) |
| R11 | **Branch previews** | Automatic per-branch URLs (EDS) | Manual **workspace pool** + CI allocate/deploy/undeploy | ⚪ soft gap — out of PoC scope |
| R4 | **Routing / entry** | All traffic through one Worker at site root | Action URL `/api/v1/web/<pkg>/<action>`, not a root | 🟢 — dispatcher + **Path A** self-host under prefix (live); true domain root needs CDN |
| R5 | **Reserved extensions** | None | `.svg/.json/.html/.text` paths intercepted → **400** (confirmed) | 🟢 — `/x-asset` proxy dodges it (live) |
| R6 | **Relational data** (4 tables) | **D1** — SQL, JOINs, transactions, native binding | **`aio-lib-db`** — NoSQL document; aggregation incl. `$lookup`; **no** multi-doc txn / FK | 🟢 — all 4 tables rewritten + **live**; txn/FK handled by modeling (embedded arrays) |
| R7 | **KV cache** (`AUTH_TOKENS`) | CF KV | **`aio-lib-state`** — KV, ~1 MB/item, TTL ≤ 365 d | 🟢 — ported |
| R8 | **Auth / JWT** | `jose` + Entra SSO | `jose` on Node 22, unchanged | 🟢 — ported (live SSO needs `redirect_uri` registered in Entra) |
| R9 | **Cron** | `scheduled()` monthly | `/whisk.system/alarms` feed | 🟢 — ported (left un-triggered; handler is a no-op) |

**Pros of moving to App Builder:** native to Adobe/IMS; JSON API + auth + relational/reporting layer all run on-platform; managed document DB with aggregation reporting; simpler secrets/`.env`. **Cons:** no large/streamed responses (R1, structural), cold-start + off-edge latency (R3), no built-in per-PR previews (R11), no relational SQL/transactions (R6, worked around by modeling).

### Verified runtime limits (Adobe I/O Runtime `system_settings`, Sep 2026)
| Limit | Value |
|---|---|
| Web-action response | **1 MB**, not configurable, no streaming |
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
| DM/Helix — asset & page delivery | ⚠️ Partial — small binaries 200; large/streamed → R1; `.svg` etc → R5 (Path A) |
| COA AI-image binaries | ⛔ Blocked by R1 |
| Notifications / non-search analytics | 501 stub (by design) |
| Cron (alarms) | ✅ Ported — deployed, intentionally un-triggered (no-op handler) |

## Data store: `aio-lib-db` vs D1 (is a document DB enough?)
`aio-lib-db` = AWS DocumentDB (Mongo-compatible). Aggregation pipeline (`$match/$group/$count/$lookup/$unwind/$project/$sort`) covers every report this app and the harder **koassets** app need (GROUP-BY, `COUNT(DISTINCT)`, monthly buckets, cohorts, one self-JOIN).

The four gaps and how they're handled:
- **`COUNT(DISTINCT)` 16 MB `$addToSet` cap** → two-stage `$group` (never builds a big array). ✅
- **Null-key dedup** → partial unique index. ✅
- **No multi-doc transactions** → embed bounded children → single atomic `updateOne`; idempotent/saga otherwise. ⚠️ by design
- **No FK / cascade** → same embedding, else app-enforced. ⚠️ by design

**Conclusion:** porting is **done and proven live**; transaction/FK guarantees moved from the DB into data modeling (e.g. `search_event_markets` FK → embedded `markets[]`). Use a purpose-built store only for strict multi-entity ACID or warehouse-scale OLAP. Report payloads still bound by R1 → paginate/aggregate server-side. Full plan + status: **`docs/D1-TO-AIOLIBDB-PLAN.md`**. Follow-ups (non-blocking): search-event write hook, one-time backfill (needs CF D1 token), Production `provisionRequest()`.

## Path A — browsable UI on the raw Runtime URL (no custom domain)
R4 + R5 are engineering obstacles, not walls. Path A (`actions/lib/basepath.js` + dispatcher, driven by `BASE_PATH`) makes the whole portal work under the bare action prefix by rewriting URLs server-side (HTML `href`/`src`, redirects/`Location`, CSS `url()`, `localizePath()` JS) plus an injected client shim and a `/x-asset` proxy for reserved-extension assets. **Verified live on Stage:** Fréscopa home + `/en/search` render with styles, icons (via `/x-asset`), live Smart Collections card, and **0 broken icons**; SSO `redirect_uri` correctly prefixed. **Does NOT fix R1** — any single asset > ~1 MB still 400s, so production parity still wants a CDN/edge in front with the streaming asset tier kept off App Builder.

## Adapter gotchas (found wiring `dm.js`, handled in `lib/ow-http.js`)
- **Request body is base64** on `web: raw` (decode unconditionally; `__ow_isBase64Encoded` is response-only).
- **Platform recomputes transfer headers** — strip upstream `content-encoding/length`, `transfer-encoding`, `connection`, `keep-alive` (else HTTP 400 header/content mismatch).
