# Database Options for assethub-spark on Fastly Compute

Companion reference to the D1-replacement analysis in
[`assethub-migration-fastly.md`](./assethub-migration-fastly.md#d1-replacement--options-analysis-the-one-hard-gap).
That section makes the call (Turso/libSQL) for the **PoC**; this doc goes deeper on **cost across tiers,
production/paying-customer suitability, and multi-tenancy** so we can make the *product* decision with eyes open.

> **Pricing snapshot: 2026-09-14**, pulled from each vendor's public pricing page. DB pricing changes often
> (PlanetScale killed its free tier in 2024 and moved to instance-based pricing; Turso has re-priced multiple
> times; Neon rebranded to neon.com). **Re-verify before committing spend.** All dollar figures are approximate.

---

## 1. The two hard constraints (why the shortlist is short)

1. **Fastly Compute can't open raw TCP sockets** → the DB must be reachable via an **HTTP/fetch driver** through
   a declared backend. Plain Postgres/MySQL over a TCP pool is out; only serverless/HTTP drivers qualify.
2. **SQLite-dialect compatibility minimizes churn** → ~32 prepared-statement sites + 3 `schema/*.sql` files use
   SQLite-isms (`.batch()`, `last_insert_rowid()`, `INSERT OR IGNORE`, `ON CONFLICT`, `strftime`, `AUTOINCREMENT`,
   FK `ON DELETE CASCADE`). A non-SQLite engine means rewriting **queries + schema + dialect test assertions**.

Everything below is filtered through these two.

---

## 2. The contenders

| # | Option | Engine / dialect | Fastly driver | Rewrite from D1 |
|---|---|---|---|---|
| 1 | **Turso (managed libSQL)** ⭐ | SQLite fork | `@libsql/client/web` (fetch) | **Minimal** (thin shim) |
| 2 | **Neon** | Postgres | `@neondatabase/serverless` (fetch/WS) | Moderate–high |
| 3 | **PlanetScale** | MySQL/Vitess + now Postgres | `@planetscale/database` (fetch, MySQL) | Moderate–high |
| 4 | **Nile** | Postgres (multi-tenant native) | serverless driver (edge support **unconfirmed**) | Moderate–high |
| 5 | **Cloudflare D1 over HTTP** | SQLite | D1 REST API (fetch) | ~none — but keeps a CF dependency |
| — | Self-hosted libSQL (`sqld`) | SQLite | libSQL HTTP | Minimal — but **you run it** |

### Why not the hyperscaler databases (AWS / Azure)?

Not overlooked — filtered by the **same two constraints**, mostly #1 (no TCP sockets on Fastly):

| Considered | Why it's not in the shortlist |
|---|---|
| **AWS RDS / Aurora (provisioned) — Postgres/MySQL** | Native **TCP wire protocol + connection pool** → unreachable from Fastly's Wasm sandbox (constraint #1). |
| **Azure SQL Database** (TDS), **Azure DB for Postgres/MySQL** | Same — native TCP; **no first-party HTTP data-API** equivalent. Filtered by #1. |
| **AWS Aurora Serverless v2 + RDS Data API** | ✅ *Technically viable* — the **Data API runs SQL over HTTPS** (fetch-compatible). But vs. Neon (same Postgres/MySQL rewrite) it's strictly heavier here: **SigV4 request signing** to implement in Wasm, higher per-query Data-API latency, a higher cost floor (Aurora min capacity), and no edge-latency story. **Dominated by Neon** → didn't make the top 5. |
| **AWS DynamoDB**, **Azure Cosmos DB** | Fetch-friendly REST APIs (pass #1) but **non-relational** → fail constraint #2 hard: not a dialect tweak, a full data-model rewrite of the audit/reporting/joins. RU/throughput cost can also surprise. |
| **Proxy/gateway in front of a TCP DB** | An HTTP-to-SQL layer (or Hyperdrive-style shim) *could* expose RDS/Azure over HTTP, but it's another component to build + run — defeats the "managed, simple" goal. |

**When AWS/Azure comes back on the table:** an **organizational mandate** — existing enterprise contract, in-house
DBA teams, procurement/residency for paying customers. In that case the realistic Fastly-compatible path is
**Aurora Serverless v2 + RDS Data API** (accept SigV4 + latency + the Postgres rewrite), or front a managed instance
with an HTTP gateway. **Worth confirming Adobe's preferred cloud/DB standards before the Phase 2 production decision**
— if Azure/AWS is mandated, that reshapes the pick.

---

## 3. Cost across tiers

### Turso (libSQL) — usage-based (rows read/written + storage); PITR & branching are free
| Tier | Price/mo | Databases | Storage | Rows read/mo | Rows written/mo | PITR | Compliance |
|---|---|---|---|---|---|---|---|
| Free | $0 | 100 | 5 GB | 500 M | 10 M | 1 day | — |
| Developer | $4.99 | Unlimited | 9 GB (+$0.75/GB) | 2.5 B (+$1/B) | 25 M (+$1/M) | 10 days | — |
| Scaler | $24.92 | Unlimited | 24 GB (+$0.50/GB) | 100 B (+$0.80/B) | 100 M (+$0.80/M) | 30 days | — |
| Pro | $416.58 | Unlimited | 50 GB (+$0.45/GB) | 250 B (+$0.75/B) | 250 M (+$0.75/M) | 90 days | **SOC2, HIPAA, SSO, BYOK, IP/VPC allowlists** |
| Enterprise | Custom | Unlimited | — | — | — | 90 days | + 24×7 support |

### Neon (Postgres) — PAYG compute (CU-hours) + storage; scale-to-zero
| Tier | Price/mo | Projects | Storage | Compute | History (PITR) | Compliance / SLA |
|---|---|---|---|---|---|---|
| Free | $0 | 100 | 0.5 GB/proj | 100 CU-h/proj | 6 h (1 GB cap) | none |
| Launch | PAYG (no min) | 100 | $0.35/GB-mo | $0.106/CU-h | up to 7 days | none |
| Scale | PAYG (no min) | 1,000 | $0.35/GB-mo | $0.222/CU-h | up to 30 days | **SOC2 + HIPAA available; SLA** |
| Business / Enterprise | Custom | more | — | — | longer | + |

*Egress: 500 GB/project included, then $0.10/GB. Scale-to-zero after ~5 min (configurable on paid) — idle tenants cost ~$0.*

### PlanetScale — **no free tier**; now instance-based (pick a size); MySQL/Vitess **and** Postgres
| Product | Cheapest | Mid | Large |
|---|---|---|---|
| **Postgres, single-node** (no HA) | PS-5 **$5** | PS-160 ~$96–117 | PS-2560 ~$1,510–1,867 |
| **Postgres, HA** (3-node) | PS-5 **$15** | PS-160 ~$286–349 | PS-2560 ~$4,529–5,599 |
| **MySQL/Vitess** (3-node HA) | PS-10 **$30–39** | PS-160 ~$286 | PS-2560 ~$5,599 |
| **"Metal"** (local NVMe, top perf) | M-10 ~$50 | M-160 ~$589 | M-5120+ ~$23,979+ |

*Storage/backups/egress/extra replicas billed on top. Cost is driven by instance size, not row counts.*

### Cloudflare D1 (transitional only — keeps a CF dependency)
| Plan | Base | Rows read | Rows written | Storage | Overage |
|---|---|---|---|---|---|
| Free | $0 | 5 M/day | 100 k/day | 5 GB | none (blocks at limit) |
| Workers Paid | $5/mo | 25 B/mo incl | 50 M/mo incl | 5 GB incl | $0.001/M read · $1/M write · $0.75/GB-mo |

### Nile (Postgres, purpose-built multi-tenant)
| Tier | Price/mo | Storage | "Query tokens"/mo | Tenants/DBs | SLA | Compliance |
|---|---|---|---|---|---|---|
| Free | $0 | 1 GB (+$1.50/GB) | 50 M | Unlimited | — | — |
| Pro | $15 | 5 GB (+$1/GB) | 150 M (+$0.05/M) | Unlimited | 99.95% | SOC2 *coming soon* |
| Scale | $350 | 50 GB (+$0.75/GB) | 500 M (+$0.04/M) | Unlimited | 99.99% | SOC2 *coming soon* |
| Enterprise | Custom | — | — | Millions | — | — |

### "How cheap to start → how expensive under load" (illustrative)
Our DB load is **read-heavy reporting + append-mostly writes** (audit/search/login events, smart collections).

| Scenario | Turso | Neon | PlanetScale | Nile | D1 (CF) |
|---|---|---|---|---|---|
| **Start** (PoC / 1 tenant, light) | **$0** (Free) → $5 Dev | **$0** (Free) | **$5–15** (no free) | **$0** (Free) | $5 |
| **Moderate** (~10–50 tenants; ~2 B reads, ~20 M writes, ~15 GB/mo) | **~$25 flat** (Scaler — well inside limits) | ~$40+ (compute-driven, variable) | ~$96–286 (needs a bigger instance) | **~$15** (Pro, unlimited tenants) | ~$5–30 |
| **Heavy** (~50 B reads, ~200 M writes, ~100 GB) | ~$140 (Scaler+overage) or $417 Pro | ~$200–1,000+ (compute-bound) | ~$500–5,000+ (large/ sharded) | ~$350 (Scale) | writes bite: ~$150–250 |

**Reading the table:** Turso and Nile stay remarkably cheap as tenants grow (flat-ish, high included limits). Neon
is pay-as-you-go on *compute* — cheap when idle (scale-to-zero), variable under sustained query load. PlanetScale
has the highest floor (no free tier, instance-priced) and the steepest curve, but the most horsepower at the top.

---

## 4. Feature / criteria matrix

| Criterion | Turso | Neon | PlanetScale | Nile | D1 |
|---|---|---|---|---|---|
| **Dialect fit (our code)** | ✅ SQLite (drop-in) | ⚠️ Postgres rewrite | ⚠️ MySQL rewrite | ⚠️ Postgres rewrite | ✅ SQLite |
| **Edge/HTTP driver** | ✅ purpose-built | ✅ yes | ✅ (MySQL); Postgres TBD | ⚠️ unconfirmed for edge | ✅ REST |
| **Read latency** | ✅ edge replicas | ⚠️ region + cold-start on wake | ✅ good; Metal = best | ⚠️ region | ⚠️ cross-cloud from Fastly |
| **Write model** | single primary | primary (branch writes) | primary/sharded | primary | primary |
| **Complex analytics (joins/CTEs)** | ⚠️ SQLite-class | ✅ full Postgres planner | ✅ strong | ✅ Postgres | ⚠️ SQLite-class |
| **PITR / backups** | 1–90 days by tier | 6 h–30 days by tier | instance backups | tenant insights only | Time-Travel (~30 days) |
| **Branching (per-PR previews)** | ✅ (free) | ✅ (cheap snapshots) | ✅ | ✅ | ⚠️ limited |
| **Data residency / regions** | multi-region | many regions | many regions/clouds | limited | CF global |
| **Maturity / track record** | ⚠️ young (mid-rewrite) | ✅ mature | ✅ very mature | ⚠️ young | ✅ mature |
| **Ops burden** | none (managed) | none | none | none | none |

---

## 5. Suitable for **paying customers**? (production readiness)

The bar for real customers: **SLA, compliance (SOC2/HIPAA/ISO), backups/PITR, support, maturity, residency.**

| Option | Verdict for paying customers |
|---|---|
| **Neon (Scale)** | ✅ **Strong.** Mature Postgres, SOC2 **+ HIPAA available**, SLA, 30-day PITR, scale-to-zero economics. Best "serious commercial DB" story — *if* we accept the Postgres rewrite. |
| **PlanetScale** | ✅ **Strong (enterprise-grade).** Battle-tested at massive scale, HA by default, SOC2/HIPAA historically, strong SLAs. Priciest; best when scale/throughput is the priority. |
| **Turso (Pro/Enterprise)** | ✅ **Viable**, but compliance (SOC2/HIPAA/SSO/BYOK) + SLA only land on **Pro ($417/mo)** / Enterprise; younger vendor + an in-flight engine rewrite = platform risk. Lower tiers are great for internal/non-regulated. |
| **Nile (Pro/Scale)** | ⚠️ **Not yet for regulated customers** — SOC2 "coming soon," no HIPAA. Great multi-tenant DX and price for **non-regulated** B2B; revisit once certs land. |
| **Cloudflare D1** | ❌ **Not an end-state** — keeps a hard Cloudflare dependency (cross-cloud from Fastly). Transitional only. |

**Takeaway:** for regulated/commercial paying customers today, **Neon (Scale)** or **PlanetScale** clear the bar
outright; **Turso** clears it at **Pro+** with some vendor-maturity risk to weigh.

---

## 6. Multi-tenancy: per-customer DB vs shared

This app already has a natural tenant key — **`DEMO_COMPANY`** (frescopa / santander / coke …); the DB tables
(`audit_events`, `search_events`, `user_logins`, `smart_collections`) are all per-company data. A productized
version is inherently multi-tenant. Three architectures:

### A. Database-per-tenant (one DB per customer)
- **Pros:** strongest isolation (no query can cross tenants); trivial per-tenant **backup / restore / delete**
  (GDPR "delete my data" = drop a DB); per-tenant **residency** (place each tenant's DB in its region); **no
  noisy-neighbor**; per-tenant metering/scaling; a corrupt/huge tenant can't hurt others.
- **Cons:** N databases to operate — **schema migrations fan out** across all of them; new-tenant provisioning
  step; **cross-tenant analytics** need fan-out/aggregation; only cheap if the platform is built for many DBs.

### B. Shared multi-tenant (one DB, `tenant_id` column + row-level security)
- **Pros:** one schema, **one migration**; efficient resource sharing (cheapest at scale); **cross-tenant
  analytics in a single query**; simplest ops at small/medium scale.
- **Cons:** isolation is **app/RLS-enforced** — one bug leaks across tenants (**highest data-risk**); noisy
  neighbor; per-tenant delete/residency/backup are hard; one big blast radius.

### C. Schema-per-tenant (Postgres schemas — middle ground)
- Better isolation than shared, less overhead than DB-per-tenant; **but** schema sprawl doesn't scale to
  thousands of tenants. Postgres-only (Neon).

### Which providers do multi-tenancy well?

| Provider | DB-per-tenant | Shared (RLS) | Notes |
|---|---|---|---|
| **Turso** ⭐ | ✅✅ **flagship** | ➖ (SQLite, no RLS) | Built for **DB-per-tenant at scale** — unlimited DBs (paid), instant creation via API, per-tenant isolation + backup, cheap. The natural fit for our per-company model **and** stays SQLite (no rewrite). |
| **Nile** ⭐ | ✅ | ✅✅ **purpose-built** | Postgres *designed* for B2B multi-tenancy — virtual tenants (isolation handled for you) **or** tenant-per-DB, unlimited tenants on every tier, cross-tenant analytics. Cheapest multi-tenant option ($15 Pro). Caveats: edge driver unconfirmed, SOC2 pending, young. |
| **Neon** | ✅ (100–1,000 projects) | ✅✅ (Postgres **RLS** first-class) | Flexible: RLS for shared, or project/DB-per-tenant. Mature. Per-DB heavier than Turso at thousands of tenants. |
| **D1** | ✅✅ (designed for many DBs) | ➖ | Great DB-per-tenant SQLite — but it's Cloudflare (cross-cloud from Fastly). |
| **PlanetScale** | ⚠️ (per-instance = costly) | ✅ (shard by tenant) | Shines for **shared, sharded** at huge scale; DB/instance-per-tenant is expensive; no FKs (Vitess). |

### Multi-tenancy recommendation
- **Stay SQLite + want isolation → Turso, database-per-tenant.** It's the *only* option that keeps our minimal
  rewrite **and** is purpose-built for many DBs — one small DB per customer, perfect isolation, ~$25/mo covers a
  large number of tenants, per-tenant delete/backup for free. This is the recommended multi-tenant architecture.
- **Willing to move to Postgres for richer multi-tenancy → Nile** (multi-tenancy done for you; cheapest) once its
  edge driver + SOC2 are confirmed, or **Neon** (mature, RLS or per-project) for the safer, compliance-ready bet.
- **Avoid** shared-single-DB on SQLite (no RLS — isolation would be entirely hand-rolled in app code = risk).

---

## 7. Overall recommendation

- **PoC / Phase 1b (decided 2026-09-14):** start on the **existing Cloudflare D1 over its REST API** — zero data
  migration, real data in reports, no dialect rewrite, and it decouples the compute migration from the vendor
  decision. Transitional only (keeps a temporary CF dependency until Phase 2).
- **Production DB (Phase 2):** **Turso** remains the recommended target — minimal rewrite, fetch-native, and its
  DB-per-tenant model is exactly what a multi-tenant product wants. Free/Developer tier is ample; migrate the D1
  data in T2.1.
- **Multi-tenant product:** **Turso, database-per-`DEMO_COMPANY`** — best balance of isolation, cost, and code reuse.
- **If paying customers demand top-tier compliance now:** weigh **Neon (Scale)** or **PlanetScale** and accept the
  dialect rewrite, or take **Turso Pro** (HIPAA/SOC2) and accept the vendor-maturity risk.
- **The one question that could flip it:** does the team standardize on **Postgres** elsewhere? If yes, **Neon**
  (or **Nile** for multi-tenancy) becomes compelling despite the rewrite. Confirm before Phase 1b (plan T1.6).

---

## 8. Caveats
- Pricing/limits are a **2026-09-14 snapshot** from vendor pages via automated fetch; some figures may be
  mis-extracted or already changed — **verify current pricing** before any commitment.
- PlanetScale has **no free tier** and recently reworked to **instance-based** pricing (and added Postgres) —
  its numbers here are the least stable.
- Nile's **edge/HTTP driver** compatibility with Fastly Compute is **unconfirmed** — validate with a Phase-0-style
  spike before relying on it.
- Turso is undergoing a ground-up engine rewrite (formerly "Limbo") — use the **stable managed libSQL cloud**, and
  factor in the platform's youth for production/paying-customer use.
