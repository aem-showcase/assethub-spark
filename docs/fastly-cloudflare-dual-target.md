# Dual-Target Analysis: One Codebase for Cloudflare *and* Fastly

**Date:** 2026-09-17 · **Context:** follow-on to the [Fastly PoC](./fastly-poc-results.md). Question: how hard is it
to support **both** Cloudflare Workers and Fastly Compute from **one codebase** (pick per customer, minimal
change) — versus a one-off migration, or two divergent trees?

> **Headline:** dual-target from one codebase is **very feasible** — because the divergence is **small and
> concentrated in a named platform seam**, not spread through the business logic. The PoC already built ~60% of
> the needed adapter and proved it works. The only *High-risk* category is the relational DB.

---

## 1. What actually differs (grounded in the file-by-file diff)

Comparing every `fastly/src/*.js` to its `cloudflare/src` (or `scripts/`) counterpart:

- **~90% is identical or import-path-only.** The business logic — `dm.js` (1129 lines, only **Δ23**), `coa.js`,
  `notifications`, `audit` (Δ7), `smart-collections` (Δ10), `page-access` (Δ6), the search-D1 code, every
  `constants/*` — differs only by import paths + a few `backend:` / `CacheOverride` lines.
- **`http.js` (HS256 session cookies) and `itty.js` (CORS) are *semantically identical*** — their diff was pure
  formatting. The load-bearing crypto and routing need **zero** platform change.
- **Divergence lives in a small, named seam:** the 3 Fastly-only adapter files (`platform/env.js`,
  `platform/backends.js`, `platform/d1-http.js` ≈ **300 lines**) + real adaptations in only **`helix.js`,
  `helixutil.js`, `auth.js`, `index.js`, `asset-access.js`, `analytics-helper.js`**.
- **Most adaptations are *portable*** — read-and-reconstruct, `createLocalJWKSet`+fetch, and a fetch-wrapper all
  work on Cloudflare too. Converging on them **unifies** the code rather than forking it.

Divergence tiers (Δ = changed diff lines, both directions):

| Tier | Files |
|---|---|
| **Identical / cosmetic** | `http.js`, `itty.js`, `constants/*`, `countries.js`, `asset-audit-constants`, `collection-search-constants`, `dm-api-contract`, `permissions` (Δ2) |
| **Import-path + trivial** (Δ<25) | `audit` (7), `page-access` (6), `smart-collections` (10), `authz` (10), `notifications` (11), `trusted-hosts` (11), `dm-analytics` (12), `log-utils` (13), `coa` (16), `dm` (23), `asset-access` (25) |
| **Real adaptation** (Δ25–200) | `analytics-helper` (28, rewritten), `config` (42), `user` (83), `helix` (95), `helixutil` (113, fetch rewritten), `auth` (182: JWKS + bypass + degrade), `index` (201: entry) |
| **Fastly-only seam** | `platform/env.js` (147), `platform/d1-http.js` (119), `platform/backends.js` (31) |
| **Not ported** | `api/user-logins` (no table), `scheduled/token-refresh` (cron), `util/email-validator` + `util/notifications-helpers` (only used by unported code) |

*(`api/analytics.js` shows a huge Δ only because the Fastly copy is a 423-line **extract** of the 2377-line
original — the dead Analytics-Engine code was dropped, not diverged.)*

---

## 2. Category breakdown — divergence, unify approach, difficulty, risk

| # | Category | CF ↔ Fastly difference | Unify approach (1 codebase) | Difficulty | Risk |
|---|---|---|---|---|---|
| 1 | **Entry / lifecycle** | `export default {fetch, scheduled}` vs `addEventListener('fetch')` + `buildEnv()` | Thin per-platform entry shim → shared `handleRequest(req, env)` (routes are identical) | Low–Med | Low |
| 2 | **Config vars** | wrangler vars vs Config Store | `env` adapter (built) — CF passes native env | Low | Low |
| 3 | **Secrets** | both already use `env.X.get()` (converged) | `secretBinding` adapter (built) | Low | Low |
| 4 | **KV** | binding vs `KVStore` (`list()` shape differs) | `kvBinding` adapter (built) | Low | Low |
| 5 | **Outbound fetch + backends** | `fetch(url,{cf})` any host vs `fetch(url,{backend})` **declared** | `platformFetch(url,init)`: Fastly adds `backend` + `CacheOverride`; CF adds `cf:{}` | **Medium** | **Med** — every fetch must route through it; Fastly needs declared **or** Dynamic Backends |
| 6 | **Response handling** | CF auto-decompresses + has `.clone()`; Fastly has neither | Converge on **read-and-reconstruct** + a body-read helper (portable) | **Medium** | **Med** — done wrong = fail-open (the PoC hit exactly this in metadata-auth) |
| 7 | **Caching** | `cf:{cacheEverything}`/`no-store` vs `CacheOverride` | `cachePolicy()` helper per platform | Low | Low |
| 8 | **Relational DB** | D1 binding (native) vs **nothing** → shim / Turso | One D1-compat interface (`.prepare().bind()...`): CF = native D1, Fastly = Turso/libSQL (or D1-over-HTTP). **Keep SQLite dialect.** | **Med–High** | **High** — the one real gap; dialect lock-in, vendor, per-call latency |
| 9 | **Auth crypto / JWKS** | `createRemoteJWKSet` vs `createLocalJWKSet` + backend fetch | Converge on local-JWKS + fetch (works on both) | Low–Med | Low (proven) |
| 10 | **Async post-response** | `ctx.waitUntil` vs event API / sync | `runAfterResponse()` helper, or run synchronously | Low–Med | Low–Med |
| 11 | **Build tooling** | wrangler + `wrangler.jsonc` vs `fastly` CLI + `fastly.toml` + js-compute | Two build manifests, one shared `src/`, one target flag | Low | Low |
| 12 | **Tests** | `@cloudflare/vitest-pool-workers` vs node-vitest + `@fastly/compute-testing` | Shared unit tests (node) + per-platform integration | **Medium** | Med (re-home effort) |
| 13 | **CI/CD + previews** | wrangler-action, per-PR worker+route vs `fastly` deploy / `.aem.run` branch URLs | Two deploy workflows, shared build | Medium | Med |

**Only #8 (DB) is High-risk.** Everything else is Low–Medium, and #2/#3/#4 are already built.

---

## 3. Strategy options

### A. One codebase, dual-target (platform adapter) — **fits "pick per customer"**
- **How:** generalize the PoC seam so each adapter (env / fetch / cache / db / entry) has a **CF impl and a
  Fastly impl**; converge the ~5 adaptation points on portable patterns; select target with a build flag.
  Business logic stays single-source.
- **Pros:** one source of truth; flip a customer CF↔Fastly by rebuild; fixes/features land once; no drift.
- **Cons:** adapter carries two impls; discipline (all fetch/storage/response through the seam); doubled
  build/test/CI; mild "lowest-common-denominator" (harder to exploit CF-only or Fastly-only perks).
- **Difficulty: Medium** — the PoC already built ~60% and proved the seam.

### B. Two divergent codebases (fork) — **avoid**
- **Pros:** each platform-optimized, no adapter overhead.
- **Cons:** double maintenance; every change ported twice; **drift** (the PoC already felt version-drift pain).
  Only justified if the two must diverge heavily — they don't (Δ23 on the 1129-line core proves it).

### C. One-off migrate when needed — **fine *if you never run both at once***
- **How:** keep CF as the single codebase; when a customer needs Fastly, run the migration (this PoC) to produce
  a Fastly build.
- **Pros:** zero dual-maintenance day-to-day.
- **Cons:** each migration is a mini-project; can't flip a customer easily; **if you run both simultaneously,
  you've become Option B** (two live trees).

---

## 4. Should you build it? — decision guidance

**It hinges on one question: is there a real, near-term need to run *both* platforms simultaneously (per
customer)?**

- **Real / likely** → build **Option A** (adapter). It's a *Medium* lift (~4–6 wks) and the PoC already did ~60%.
- **Speculative / none** → **don't build it now.** The PoC already banked the *optionality* (it proved a Medium
  lift). Keep the parallel tree as evidence and do a one-off migration (Option C) if/when a concrete need lands.
  A dual-target adapter built speculatively is complexity you pay for **forever**.
- **Committing fully to Fastly** (e.g. AEM's CS-provisioned `.aem.run`) → do a **one-way** migration, not
  dual-target.

### Pros of dual-target (Option A)
- **One source of truth** — a fix/feature ships to both by rebuild; no fork drift.
- **Per-customer platform choice** — procurement, existing CDN contracts, data residency, vendor-lock hedging.
- **Optionality / leverage** — flip a customer, or use it in vendor negotiations.
- **Cheap relative to a rewrite** — the seam is ~300 lines and mostly already built + proven.

### Cons / ongoing costs
- **Permanent tax** — every subrequest, storage call, and body-read must go through the adapter forever; every
  contributor has to learn it.
- **Doubled build / test / CI / deploy** surfaces.
- **Lowest-common-denominator** — using CF-only (D1, Durable Objects, Analytics Engine) or Fastly-only features
  means adapter branches or giving them up.
- **DB is the sticking point** (the only High-risk category) — the cleanest dual-target standardizes on **Turso
  for both**, i.e. moving *Cloudflare* off D1 too; the alternative runs two DB backends behind one interface.
- **YAGNI risk** — built without a real need, it's complexity for a maybe.

### Triggers that justify building it *now*
- A signed / near-term customer that **requires Fastly** (or a non-CF CDN) while others stay on CF.
- A mandate to **avoid single-vendor lock-in** at the edge.
- AEM strategy lands on **customer-choice** infra (some CF, some CS-provisioned Fastly) rather than one platform.

### Bottom line
**Consider it: yes.** **Build it: only on a concrete trigger.** The expensive part — proving it's feasible and
*Medium*-effort — is already done, so keep that optionality in your pocket and pull it out when a real
per-customer need appears. Until then, Cloudflare stays the single source of truth and Fastly is a proven, ready
target. If you *do* build it, the two things that drive the residual risk are the **DB choice** (Turso-for-both
is cleanest) and **fetch/body discipline** (route everything through the adapter, or Fastly breaks subtly — the
undeclared-backend / no-decompress / no-`clone()` bug class the PoC surfaced, including the metadata-auth
fail-open).

---

## 5. Proposed adapter shape (concrete)

```
src/
  app/            ← ALL business logic. Imports ONLY from ../platform. Never touches
                    fastly:* modules or CF globals directly.
    router.js     ← the shared handleRequest(request, env)
    origin/ api/ util/ auth/ …   (today's ported files, minus the platform bits)
  platform/
    index.js      ← re-exports the active adapter (chosen by build define, e.g. __TARGET__)
    contract.js   ← JSDoc interface both adapters satisfy
    cloudflare.js ← CF implementation
    fastly.js     ← Fastly implementation (today's env.js + backends.js + d1-http.js, generalized)
  entry.cloudflare.js  ← ~10 lines: export default { fetch: (req, env, ctx) => run(req, env, ctx) }
  entry.fastly.js      ← ~10 lines: addEventListener('fetch', e => e.respondWith(run(e.request, buildEnv(), e)))
```

The **contract** both adapters implement:

```js
// platform/contract.js  (interface; per-platform files implement it)
export const platform = {
  buildEnv(runtimeArgs),                 // → { VAR..., SECRET.get(), KV{get,put,list,delete}, DB.prepare()... }
  fetch(input, init),                    // routes backends (Fastly) / passes cf:{} (CF)
  cache(kind),                           // 'pass' | 'everything' → CacheOverride (Fastly) / cf:{} (CF)
  readBody(response),                    // → { text, json, rebuild() }  (portable read-and-reconstruct)
  runAfterResponse(ctxOrEvent, promise), // waitUntil (CF) / event.waitUntil|sync (Fastly)
  db(env),                               // → D1-compatible client (native D1 on CF; Turso/D1-HTTP on Fastly)
};
```

Business logic calls `platform.fetch(...)`, `platform.readBody(...)`, `env.DB.prepare(...)` — and never knows
which platform it's on. Selecting the target is a **build flag** (`--define __TARGET__=fastly|cloudflare`), which
also picks the entry file and the build manifest (`fastly.toml` vs `wrangler.jsonc`).

---

## 6. Rough effort to reach a solid dual-target foundation

*(one engineer familiar with the code; excludes data migration + full test re-home, which are Phase 2 regardless)*

| Work | Estimate |
|---|---|
| Refactor to `src/app` + `src/platform` (move today's ported files; wire imports through the seam) | ~1–2 weeks |
| Build the **CF adapter** impl (mirror the Fastly one; CF is the easy side — native bindings) | ~2–4 days |
| Converge the ~6 adaptation points (fetch wrapper, read-reconstruct, local-JWKS, cache helper, entry, after-response) | ~3–5 days |
| **DB adapter** (decide Turso-both vs D1+Turso; implement behind one interface) | ~1 week |
| Dual build + shared unit tests + per-platform integration + CI | ~1 week |
| **Total (foundation):** | **~4–6 weeks** |

Most of the *risk* is front-loaded into the DB decision and the fetch/body discipline — both already understood
and de-risked by the PoC.

---

## 7. References
- PoC results: [`fastly-poc-results.md`](./fastly-poc-results.md)
- Execution log (every adaptation + gotcha): [`fastly-migration-log.md`](./fastly-migration-log.md)
- Feasibility plan: [`assethub-migration-fastly.md`](./assethub-migration-fastly.md)
- DB options + multi-tenancy: [`db-options-comparison.md`](./db-options-comparison.md)
