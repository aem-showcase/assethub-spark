/**
 * Data migration (plan §5): Cloudflare D1 → @adobe/aio-lib-db.
 *
 * One-shot backfill of the four feature tables into their document-DB
 * collections. Reads D1 over its HTTP REST API (same client the PoC dispatcher
 * used), transforms each row to the document model, and bulk-inserts.
 *
 * Transforms (see docs/D1-TO-AIOLIBDB-PLAN.md §2/§3):
 *   smart_collections : criteria JSON string -> nested object; keep app UUID `id`.
 *   audit_events      : drop the numeric autoincrement id (Mongo assigns _id).
 *   user_logins       : roles/permissions pipe-delimited strings -> arrays.
 *   search_events     : fold the search_event_markets child rows into an
 *                       embedded `markets: string[]` array (kills the FK/JOIN).
 *
 * Safety: each target collection is CLEARED before insert (idempotent re-runs).
 * Use --dry to print source/target counts without writing.
 *
 * Env (from app-builder/.env — `set -a && . ./.env && set +a`):
 *   CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN   (D1 source)
 *   OAUTH_CLIENT_ID/SECRET/SCOPES or the creds JSON      (aio-lib-db target)
 *   AIO_runtime_namespace, AIO_DB_REGION (optional)
 *
 * Run: cd app-builder && set -a && . ./.env && set +a && node scripts/migrate-d1-to-db.mjs [--dry]
 */
import fs from 'node:fs';
import { init } from '@adobe/aio-lib-db';
import { d1Binding } from '../actions/storage/sql.js';

const DRY = process.argv.includes('--dry');
const CRED_FILE = 'SparkAppbuilderPOC-245266-OAuth_Server-to-Server.json';
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const BATCH = 500;

function die(msg) { console.error('FAIL:', msg); process.exit(1); }
const splitPipe = (v) => (v ? String(v).split('|').map((s) => s.trim()).filter(Boolean) : []);
function parseJsonSafe(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; } }

// ---- D1 source ----
const cf = { accountId: process.env.CF_ACCOUNT_ID, databaseId: process.env.CF_D1_DATABASE_ID, token: process.env.CF_D1_API_TOKEN };
if (!cf.accountId || !cf.databaseId || !cf.token) die('missing CF_ACCOUNT_ID/CF_D1_DATABASE_ID/CF_D1_API_TOKEN in env');
const d1 = d1Binding(cf);
const selectAll = async (sql) => (await d1.prepare(sql).all()).results || [];

// ---- aio-lib-db target auth ----
function loadOAuth() {
  let clientId = process.env.OAUTH_CLIENT_ID;
  let clientSecret = process.env.OAUTH_CLIENT_SECRET;
  let scopes = process.env.OAUTH_SCOPES;
  if (!clientId || !clientSecret || !scopes) {
    const cred = JSON.parse(fs.readFileSync(new URL(`../${CRED_FILE}`, import.meta.url)));
    clientId = cred.CLIENT_ID;
    clientSecret = Array.isArray(cred.CLIENT_SECRETS) ? cred.CLIENT_SECRETS[0] : cred.CLIENT_SECRET;
    scopes = (cred.SCOPES || []).join(',');
  }
  if (!clientId || !clientSecret || !scopes) die('missing OAuth creds (OAUTH_* env or creds JSON)');
  return { clientId, clientSecret, scopes };
}

async function imsToken() {
  const { clientId, clientSecret, scopes } = loadOAuth();
  const res = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: scopes }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) die(`IMS token exchange: HTTP ${res.status}`);
  return json.access_token;
}

async function connectDb() {
  const namespace = process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE;
  if (!namespace) die('namespace missing (set AIO_runtime_namespace)');
  const token = await imsToken();
  const region = process.env.AIO_DB_REGION || 'amer';
  const db = await init({ token, region, ow: { namespace } });
  return db.connect();
}

// ---- per-collection loaders ----
async function loadSmartCollections() {
  const rows = await selectAll('SELECT * FROM smart_collections');
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_email: r.user_email,
    title: r.title,
    description: r.description ?? null,
    criteria: parseJsonSafe(r.criteria),
    visibility: r.visibility || 'private',
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

async function loadAuditEvents() {
  const rows = await selectAll('SELECT * FROM audit_events');
  return rows.map((r) => ({
    user_id: r.user_id,
    user_email: r.user_email,
    user_country: r.user_country ?? null,
    user_type: r.user_type ?? null,
    user_role: r.user_role ?? null,
    action: r.action,
    asset_id: r.asset_id,
    occurred_at: r.occurred_at,
  }));
}

async function loadUserLogins() {
  const rows = await selectAll('SELECT * FROM user_logins');
  return rows.map((r) => ({
    user_id: r.user_id || '',
    email: r.email,
    full_name: r.full_name || '',
    first_name: r.first_name || '',
    last_name: r.last_name || '',
    title: r.title || '',
    country: r.country || '',
    employee_type: r.employee_type || '',
    company: r.company || '',
    roles: splitPipe(r.roles),
    permissions: splitPipe(r.permissions),
    first_login_date: r.first_login_date,
    last_login_date: r.last_login_date,
    last_updated: r.last_updated,
  }));
}

async function loadSearchEvents() {
  const [events, marketRows] = await Promise.all([
    selectAll('SELECT * FROM search_events'),
    selectAll('SELECT event_id, market FROM search_event_markets'),
  ]);
  const byEvent = new Map();
  for (const m of marketRows) {
    if (!byEvent.has(m.event_id)) byEvent.set(m.event_id, []);
    byEvent.get(m.event_id).push(m.market);
  }
  return events.map((r) => ({
    user_id: r.user_id,
    user_email: r.user_email ?? null,
    user_country: r.user_country ?? null,
    user_role: r.user_role ?? null,
    search_term: r.search_term ?? '',
    search_type: r.search_type || 'all',
    result_count: r.result_count ?? null,
    occurred_at: r.occurred_at,
    markets: [...new Set(byEvent.get(r.id) || [])],
  }));
}

const TABLES = [
  { name: 'smart_collections', load: loadSmartCollections },
  { name: 'audit_events', load: loadAuditEvents },
  { name: 'user_logins', load: loadUserLogins },
  { name: 'search_events', load: loadSearchEvents },
];

// ---- run ----
console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== MIGRATING D1 -> aio-lib-db ===');
const client = DRY ? null : await connectDb();

for (const { name, load } of TABLES) {
  const docs = await load(name);
  console.log(`\n[${name}] source rows: ${docs.length}`);
  if (DRY) { console.log(`  sample:`, JSON.stringify(docs[0] || null).slice(0, 300)); continue; }

  const col = client.collection(name);
  const cleared = await col.deleteMany({});
  console.log(`  cleared target: ${cleared.deletedCount ?? 0}`);

  let inserted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    if (!chunk.length) break;
    const res = await col.insertMany(chunk);
    inserted += res.insertedCount ?? res.insertedIds?.length ?? chunk.length;
  }
  console.log(`  inserted: ${inserted}`);
}

if (client) await client.close();
console.log('\nDONE ✅');
