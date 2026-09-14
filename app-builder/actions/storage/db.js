/**
 * `@adobe/aio-lib-db` adapter — the App Builder replacement for Cloudflare D1.
 *
 * Provides a cached, IMS-authenticated document-DB client to the route handlers
 * (smart-collections, audit, search, user-logins). See
 * `docs/D1-TO-AIOLIBDB-PLAN.md` for the migration design.
 *
 * Auth: exchange OAuth Server-to-Server creds → IMS access token (cached ~24h),
 * then `init({ token, region, ow:{ namespace } })` → `connect()`. The namespace
 * is the ambient Runtime namespace (`__OW_NAMESPACE`); region defaults to `amer`.
 *
 * Required env inputs (app.config.yaml → .env):
 *   OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_SCOPES   (from the S2S credential)
 *   AIO_DB_REGION (optional, default 'amer')
 */
import { init } from '@adobe/aio-lib-db';

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

// Cached across warm container invocations. The client holds the IMS token, so
// both are rebuilt together when the token nears expiry.
let cache = { exp: 0, clientPromise: null };
const indexedCollections = new Set();

async function fetchImsToken(env) {
  const clientId = env.OAUTH_CLIENT_ID;
  const clientSecret = env.OAUTH_CLIENT_SECRET;
  const scope = env.OAUTH_SCOPES;
  if (!clientId || !clientSecret || !scope) {
    throw new Error('aio-lib-db: missing OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET/OAUTH_SCOPES');
  }
  const res = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`aio-lib-db: IMS token exchange failed (HTTP ${res.status})`);
  }
  return { token: json.access_token, expMs: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
}

/** Lazily build (and cache) a connected DbClient. */
async function getClient(env) {
  const now = Date.now();
  if (cache.clientPromise && now < cache.exp - 60_000) {
    try { return await cache.clientPromise; } catch { /* fall through to rebuild */ }
  }
  const { token, expMs } = await fetchImsToken(env);
  const namespace = env.__OW_NAMESPACE || process.env.__OW_NAMESPACE;
  if (!namespace) throw new Error('aio-lib-db: __OW_NAMESPACE not available');
  const region = env.AIO_DB_REGION || 'amer';
  cache = {
    exp: expMs,
    clientPromise: (async () => {
      const db = await init({ token, region, ow: { namespace } });
      return db.connect();
    })(),
  };
  return cache.clientPromise;
}

// Index specs mirror the D1 schema indexes (see cloudflare/schema/*.sql).
const INDEXES = {
  smart_collections: [
    [{ user_id: 1, updated_at: -1 }, {}],
    [{ visibility: 1, updated_at: -1 }, {}],
  ],
  user_logins: [
    // Preserve SQLite `email UNIQUE`; partial so docs without an email don't clash.
    [{ email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true } } }],
    [{ user_id: 1 }, {}],
    [{ first_login_date: 1 }, {}],
  ],
  audit_events: [
    [{ user_email: 1 }, {}], [{ user_role: 1 }, {}], [{ asset_id: 1 }, {}],
    [{ action: 1 }, {}], [{ occurred_at: 1 }, {}],
  ],
  search_events: [
    [{ user_id: 1 }, {}], [{ occurred_at: 1 }, {}], [{ search_term: 1 }, {}],
    [{ search_type: 1 }, {}], [{ user_country: 1 }, {}], [{ markets: 1 }, {}],
  ],
};

async function ensureIndexes(col, name) {
  if (indexedCollections.has(name) || !INDEXES[name]) return;
  for (const [spec, opts] of INDEXES[name]) {
    try { await col.createIndex(spec, opts); } catch (e) { /* idempotent; ignore races */ }
  }
  indexedCollections.add(name);
}

/**
 * Get a collection handle, ensuring its indexes exist (once per warm container).
 * @param {object} env action params (OAuth creds + __OW_NAMESPACE)
 * @param {string} name collection name
 */
export async function getCollection(env, name) {
  const client = await getClient(env);
  const col = client.collection(name);
  await ensureIndexes(col, name);
  return col;
}
