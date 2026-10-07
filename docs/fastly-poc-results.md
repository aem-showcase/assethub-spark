# assethub-spark on Fastly Compute — PoC Results

**Status:** ✅ **Feasible** — PoC functionally complete on the Fastly edge (2026-09-15).
**Branch:** `fastly-poc` · **Live edge:** https://annually-positive-egret.edgecompute.app · **Reference:** `cloudflare/` (untouched fallback).

## Goal
Determine whether the assethub-spark backend (today a **Cloudflare Worker**) can run on **Fastly Compute**, and
how the one hard gap — Cloudflare **D1** — would be replaced. Strategy: **PoC spike first, then production parity.**

## Outcome
The **entire app — portal *and* reporting — runs on Fastly Compute**, verified on the real edge:

- **Auth:** real **Microsoft Entra** login (OIDC `id_token`/`form_post` → HS256 session cookie → JWKS verify).
- **Browse / search:** Helix (EDS) proxy + **Dynamic Media** + IMS S2S token → real assets (225 hits for "coffee").
- **COA** AI renditions, **notifications**, and **page-access** control (exclude-roles).
- **Reporting/audit** on the **live Cloudflare D1** (over its HTTP API): the **Search** and **Asset-Activity**
  reports render on Fastly with data **matching production** (`frescopamedia.com/en/reports/*`) — **zero data migration.**

The two biggest risks are retired *in production*: **auth crypto on the Wasm runtime**, and the **D1 data tier.**

## Approach
- **Parallel `fastly/` tree** beside `cloudflare/` — easy rollback, and keeps a "support both platforms" path open.
- **Platform-adapter seam** — only three files are Fastly-aware; business logic ported ~unchanged:
  - `platform/env.js` — a Cloudflare-style `env` over Fastly Config/Secret/KV stores.
  - `platform/backends.js` — host → declared-backend router (Fastly requires named backends per fetch).
  - `platform/d1-http.js` — a D1-compatible client over the Cloudflare D1 **REST** API.
- **Data tier (PoC decision):** reuse the **existing Cloudflare D1 over HTTP** — zero migration, real data, no
  dialect rewrite, and it decouples the compute migration from the DB-vendor decision. **Production target:
  Turso/libSQL** (rationale + cost + multi-tenancy in `db-options-comparison.md`).

## Key findings & gotchas (each with a fix)
| Finding | Fix |
|---|---|
| jose `createRemoteJWKSet` fails on Wasm (no `AbortSignal`) | Fetch JWKS over a declared backend + `createLocalJWKSet` |
| Fastly doesn't auto-decompress subrequest bodies | Drop `accept-encoding` where we read bodies (EDS sheets, page-access HTML) |
| Backend responses have no `.clone()` | Read-and-reconstruct (done for page-access; pending for search capture + metadata-auth) |
| D1 REST is stateless per call | `INSERT … RETURNING id` instead of `last_insert_rowid()` |
| KV Store not enabled on the free account | IMS-token cache no-ops (no breakage); enable for persistence |
| Entra app in a tenant the dev couldn't edit | Admin added the edge redirect URI; a dedicated **non-prod** Entra app recommended for parity |

## Out of PoC scope (tracked for later)
- **Phase 2b hardening:** live search *capture* (dm-analytics read-reconstruct), atomic batch in the D1 shim,
  `enforceAssetMetadataAuthorization` `clone()` fix.
- **Phase 2 parity:** production DB-vendor pick + data migration off Cloudflare, CI + per-PR previews
  (`.aem.run` branch URLs), full test re-home, perf, domain cutover.
- **`user_logins` dropped** — no such table in the shared D1 (the feature wasn't actually working in Spark).

## Cost
PoC ran on a **free personal Fastly account** (Compute enabled; $10/mo spend alert as a guardrail). **No new DB
spend** (reused the existing Cloudflare D1). Production DB cost analysis: `db-options-comparison.md`.

## References
- Chronological execution log (what happened, all gotchas): [`fastly-migration-log.md`](./fastly-migration-log.md)
- Feasibility assessment + phased plan: [`assethub-migration-fastly.md`](./assethub-migration-fastly.md)
- Database options, cost-by-tier, multi-tenancy: [`db-options-comparison.md`](./db-options-comparison.md)
- One codebase for CF **and** Fastly (dual-target analysis): [`fastly-cloudflare-dual-target.md`](./fastly-cloudflare-dual-target.md)
