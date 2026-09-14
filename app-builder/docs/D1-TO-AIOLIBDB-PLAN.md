# Migration plan — Cloudflare D1 → `@adobe/aio-lib-db`

Status: **PLAN ONLY (not yet implemented).** Feasibility is settled in
`FINDINGS.md` ("Data-store deep dive"); this doc is the executable plan to *replace*
the D1 storage layer with `@adobe/aio-lib-db` (managed NoSQL document DB,
Mongo/DocumentDB-compatible, published **v1.0.3**).

Scope confirmed with the owner:
- **Data migration:** YES — move existing rows out of D1 into `aio-lib-db`.
- **Provisioning:** owner will do it in Adobe Console (exact steps in §1).
- **Feature scope:** decide per §0 before coding — this plan documents **all four**
  tables so the option is open; the current PoC only has **Smart Collections** live
  (the other three are `501` stubs).

---

## 0. What "totally replace D1" actually touches

| D1 table | Today in App Builder PoC | Access path today | Work to move to `aio-lib-db` |
|---|---|---|---|
| `smart_collections` | **Live** (real CRUD) | `actions/storage/sql.js` (D1 over HTTP) + `api/smart-collections.js` | **Port** (like-for-like) |
| `audit_events` | `501` stub | — | **Build out** (append + reporting) |
| `search_events` (+ `search_event_markets`) | `501` stub | — | **Build out** (append + embedded markets) |
| `user_logins` | `501` stub | — | **Build out** (upsert-by-email) |

> Only **Smart Collections** is a true *port*. The other three are *new feature
> work* that happens to target `aio-lib-db`. If scope = "Smart Collections only",
> implement §3.1 + §4 (smart) + §6 (data migration for that one table) and stop.

Design note: the current `d1Binding` in `actions/storage/sql.js` fakes the D1
`prepare().bind().all()/.run()/.first()` shape so the CF handlers run **unchanged**.
That trick does **not** carry over — SQL strings are not Mongo queries. Each handler's
data access must be **rewritten** against a new `actions/storage/db.js` adapter (§5).

---

## 1. Prerequisites — provisioning (owner, Adobe Console)

`aio-lib-db` is authenticated with an **IMS token** and talks to a **regional**
Data Services instance that must be provisioned for the project workspace.

1. **Adobe Developer Console** → project **SparkAppbuilderPOC** → workspace **Stage**.
2. **Add Service → API →** add **"App Builder Data Services"** (a.k.a. the managed
   database service backing `aio-lib-db`). Repeat for the **Production** workspace.
   *Product naming can vary — if you don't see "Data Services", check for
   "App Builder Database" / "Cloud Database"; confirm against the current
   `@adobe/aio-lib-db` README before relying on exact labels.*
3. **Select a region** when prompted (pick the one nearest the Runtime region used
   by this namespace; record it — it becomes `AIO_DB_REGION`).
4. Ensure the workspace has **OAuth Server-to-Server** credentials (the App Builder
   default). Note: `CLIENT_ID`, `CLIENT_SECRET`, `TECHNICAL_ACCOUNT_ID`,
   `TECHNICAL_ACCOUNT_EMAIL`, `IMS_ORG_ID`, `SCOPES`.
5. **Download** the workspace config JSON (the `SparkAppbuilderPOC-245266-*.json`
   files — already git-ignored) and/or run `aio app use` to sync `.aio`/`.env`.
6. Add to `app-builder/.env` (git-ignored) + a matching block in `.env.example`
   (placeholders only):
   ```
   AIO_DB_REGION=<region>
   # OAuth S2S (from Console) — needed for the IMS token aio-lib-db uses
   OAUTH_CLIENT_ID=
   OAUTH_CLIENT_SECRET=
   OAUTH_TECHNICAL_ACCOUNT_ID=
   OAUTH_TECHNICAL_ACCOUNT_EMAIL=
   OAUTH_IMS_ORG_ID=
   OAUTH_SCOPES=
   ```
7. `cd app-builder && npm i @adobe/aio-lib-db` (adds it to `package.json`).

**Validation gate before any code:** write a 15-line throwaway script that calls
`aio-lib-db` `init()` → `getCollection('_ping')` → `insertOne`/`findOne`/`deleteOne`
against the provisioned Stage region, to confirm the **exact v1.0.3 API surface and
auth wiring** (method names below are from research and must be verified here).

> **✅ GATE CLEARED (2026-09-14).** Ran `scripts/validate-aiodb.mjs` against the Stage
> namespace `245266-sparkappbuilderpoc-stage`. Confirmed API surface (v1.0.3):
> - **Auth:** exchange OAuth S2S creds → **IMS access token** at
>   `POST https://ims-na1.adobelogin.com/ims/token/v3`
>   (`grant_type=client_credentials`, `client_id`, `client_secret`=`CLIENT_SECRETS[0]`,
>   `scope`=`SCOPES.join(',')`). Token TTL ~24h.
> - **Init:** `const db = await init({ token, region: 'amer', ow: { namespace } })`
>   (region default `amer`; Stage-env regions = `amer|amer2`, Prod = `amer|emea|apac|aus`;
>   namespace also readable from `__OW_NAMESPACE`). **No OW API key needed** for the DB.
> - **Provisioning is self-serve via the lib:** `db.provisionStatus()` → if
>   `NOT_PROVISIONED`, `db.provisionRequest()` (returned `PROVISIONED` immediately).
>   **Stage tenant DB is now provisioned** (region `amer`). Repeat once for Production.
> - **Client/collection:** `const client = await db.connect(); const col = client.collection(name);`
>   then `insertOne`/`insertMany`/`findOne`/`find`/`updateOne`(+`{upsert:true}`)/`deleteOne`/
>   `deleteMany`/`aggregate`/`createIndex`/`distinct`/`countDocuments`; `await client.close()`.
> - `insertOne` → `{acknowledged, insertedId}`; `deleteMany` → `{acknowledged, deletedCount}`.
>
> Net: **§1 Console entitlement + provisioning is DONE for Stage**; the only remaining
> setup is adding the IMS-token exchange to `db.js` and (once) provisioning Production.

---

## 2. Collection model (4 tables → collections)

One collection per table, **except** `search_event_markets`, which is **embedded**
as an array on its parent event (removes the only FK/JOIN in the schema).

| Collection | Source table | `_id` | Notes |
|---|---|---|---|
| `smart_collections` | `smart_collections` | keep app UUID as `_id` | store `criteria` as a nested object (not a JSON string) |
| `audit_events` | `audit_events` | auto `ObjectId` | one doc per event (unbounded → standalone, never approaches 16 MB) |
| `search_events` | `search_events` **+** `search_event_markets` | auto `ObjectId` | add `markets: string[]` embedded (was the child table) |
| `user_logins` | `user_logins` | auto `ObjectId` | `email` is the natural unique key (see index §2.1) |

### 2.1 Index plan (translate D1 indexes → aio-lib-db)

| D1 index | aio-lib-db index |
|---|---|
| `idx_sc_user (user_id, updated_at DESC)` | `{ user_id: 1, updated_at: -1 }` |
| `idx_sc_org (visibility, updated_at DESC)` | `{ visibility: 1, updated_at: -1 }` |
| `user_logins.email UNIQUE` | **partial unique**: `{ email: 1 }`, `unique: true`, `partialFilterExpression: { email: { $exists: true } }` (DocumentDB 5.0+ — preserves SQLite "one row per email" without breaking on absent emails) |
| `idx_ae_*` (user_email/role/asset/action/ts) | single-field indexes on the same fields used by reporting `$match`/`$group` |
| `idx_se_*` (user/ts/term/type/country) | single-field indexes; `idx_sem_market` → index on embedded `markets` |

---

## 3. Query rewrite inventory (SQL → aio-lib-db)

### 3.1 `smart_collections` (`api/smart-collections.js`) — like-for-like

| Current SQL | aio-lib-db |
|---|---|
| `SELECT * FROM smart_collections WHERE user_id=?1 OR visibility='organization' ORDER BY updated_at DESC` | `find({ $or:[{user_id},{visibility:'organization'}] }).sort({updated_at:-1})` |
| `INSERT INTO smart_collections (...) VALUES (...)` | `insertOne({...})` (criteria as nested object) |
| `UPDATE smart_collections SET ... WHERE id=?1 AND user_id=?2` | `updateOne({ _id:id, user_id }, { $set:{...} })` |
| `DELETE FROM smart_collections WHERE id=?1 AND user_id=?2` | `deleteOne({ _id:id, user_id })` |

### 3.2 `user_logins` (`api/user-logins.js`) — upsert-by-email

| Current SQL | aio-lib-db |
|---|---|
| `INSERT INTO user_logins (...) VALUES (...) ON CONFLICT(email) DO UPDATE SET ...` | `updateOne({ email }, { $set:{...updated fields, last_login_date}, $setOnInsert:{ first_login_date } }, { upsert:true })` |
| `SELECT ... FROM user_logins WHERE ...` (reporting) | `find(...)` / `aggregate(...)` |

Store `roles`/`permissions` as **arrays** (drop the pipe-delimited string hack).

### 3.3 `audit_events` (`api/audit.js`) — append + reporting

| Current SQL | aio-lib-db |
|---|---|
| `INSERT INTO audit_events (...)` | `insertOne({...})` (or `insertMany` for batches) |
| `SELECT COUNT(*) ... {clause}` | `aggregate([{$match},{$count:'total'}])` |
| `SELECT COUNT(DISTINCT user_email) ...` | **two-stage** `$group`: `[{$match},{$group:{_id:'$user_email'}},{$count:'unique_users'}]` (avoids the 16 MB `$addToSet` cap) |
| `SELECT COUNT(DISTINCT asset_id) ...` | same two-stage pattern on `asset_id` |
| `SELECT <timeExpr> AS bucket, action, COUNT(*) ... GROUP BY bucket, action` | `[{$match},{$group:{_id:{bucket,action}, count:{$sum:1}}},{$sort}]` (compute `bucket` with `$dateTrunc`/`$dateToString`) |
| `SELECT action, COUNT(*) GROUP BY action` | `$group` by `action` |
| `... user_type / user_role / user_country GROUP BY ... ORDER BY count DESC LIMIT n` | `$group` + `$sort` + `$limit` |
| top assets: `GROUP BY asset_id ORDER BY COUNT(*) DESC LIMIT n` then per-action | `$group`→`$sort`→`$limit`, then `$match asset_id∈topN` + `$group{asset_id,action}` |
| `REPLACE(asset_id,'urn:aaid:aem:','')` | `$replaceOne`/`$substr` in `$project`, or normalize on write |

### 3.4 `search_events` (+markets) (`api/analytics.js` search-metrics)

| Current SQL | aio-lib-db |
|---|---|
| `INSERT INTO search_events (...)` then N× `INSERT OR IGNORE INTO search_event_markets` | **single** `insertOne({ ...event, markets:[...uniqued] })` (atomic — replaces the two-table write) |
| `EXISTS (SELECT 1 FROM search_event_markets WHERE market=?)` | `$match:{ markets: marketValue }` (array membership) |
| `INNER JOIN search_event_markets ... GROUP BY market` | `$unwind:'$markets'` → `$group` by `markets` |

No `$lookup` needed here — embedding turns the JOIN into `$unwind`.

---

## 4. Code changes

1. **New `actions/storage/db.js`** — thin `aio-lib-db` adapter:
   `init()` (IMS token from OAuth S2S + region) → cached client; `collection(name)`
   helper exposing `insertOne/find/updateOne/deleteOne/aggregate`; index bootstrap
   (§2.1) run once (idempotent `createIndex`).
2. **Rewrite handlers' data access** to call `db.js` (§3), replacing the raw-SQL
   `prepare().bind()` calls. Keep HTTP request/response shapes identical so the EDS
   frontend is unaffected.
3. **Un-stub** `audit`/`search`/`user-logins` routes in `actions/dispatcher/index.js`
   (remove the `stub(501)` wiring) — only if feature scope includes them (§0).
4. **Retire** `actions/storage/sql.js` + the `CF_*` D1 env inputs from
   `app.config.yaml` **after** cutover (keep during parallel-run, §7).
5. **Config:** add the §1 env vars to `app.config.yaml` `inputs:` and `.env.example`.

---

## 5. Data migration (D1 → aio-lib-db)

One-time, per environment (Stage first, then Production):

1. **Export** each table from D1 via the REST API (`SELECT *`), paginating by
   `id`/`occurred_at`. Reuse the existing `sql.js` HTTP client for the read side.
2. **Transform:**
   - `smart_collections`: `criteria` string → parsed object; `id` → `_id`.
   - `search_events`: for each event, `SELECT market FROM search_event_markets
     WHERE event_id=?` → fold into `markets: []` on the event doc (**join collapses
     into the parent** — this is the one relational bit and it's resolved here).
   - `user_logins`: `roles`/`permissions` pipe-strings → arrays.
   - audit/search: drop the integer autoincrement `id` (use `ObjectId`).
3. **Load** with `insertMany` in batches (respect the 16 MB/doc and payload limits;
   events are tiny so batch freely).
4. **Reconcile:** row counts per table D1 vs collection; spot-check newest N rows.

Script lives at `app-builder/scripts/migrate-d1-to-db.mjs` (throwaway/idempotent —
safe to re-run; upsert by natural key where one exists).

---

## 6. Test & validation

- **Unit:** query-translation helpers (bucket expr, two-stage distinct, markets
  embed) — pure functions, table-driven.
- **Integration (against provisioned Stage DB):** for each feature, exercise the
  HTTP route end-to-end and assert response shape **matches the D1 version** (diff
  Smart Collections list/create/update/delete; audit summary numbers; search
  metrics). Compare aggregation outputs to the same reports run on D1.
- **Parity harness:** run one audit/search report on **both** D1 and aio-lib-db over
  the migrated data; assert equal counts.
- **Limits:** confirm no report result exceeds the 1 MB response cap (limit #1 still
  applies to the *response*, independent of the DB).

## 7. Cutover & rollback

- **Parallel run:** deploy with **both** `sql.js` (D1) and `db.js` (aio-lib-db)
  wired; put a `DB_BACKEND=d1|aiodb` env switch in the dispatcher so a single
  redeploy flips the source and a rollback is one env change + redeploy.
- **Order:** Stage → soak → Production. Migrate data (§5) immediately before
  flipping each env; keep D1 read-only as the fallback for one release.
- **Decommission:** once Production is stable, delete `sql.js`, the `CF_*` inputs,
  and the D1 database; drop the `DB_BACKEND` switch.

## 8. Sequencing / effort (relative)

1. §1 provisioning + validation gate  ← **blocks everything** (owner)
2. `db.js` adapter + index bootstrap
3. Smart Collections port + parity test  ← proves the pattern end-to-end
4. Migration script + Stage data move
5. Build-out audit / search / user-logins (only if in scope)
6. Parity harness + cutover switch + Prod

Largest risk is not code volume (queries are simple) but **provisioning/auth
wiring** (step 1) and **confirming the exact v1.0.3 API** at the validation gate.
