/**
 * Cloudflare-D1-compatible shim for the `search_events` table, backed by
 * `@adobe/aio-lib-db`.
 *
 * The reused Worker code (`cloudflare/src/util/analytics-helper.js` ->
 * `writeSearchEvent` in `api/analytics.js`) writes search events through the
 * D1 API (`db.prepare(sql).bind(...).run()`, `.first()`, `db.batch([...])`).
 * App Builder has no D1, so this adapter answers those exact calls and stores
 * the event as one document, embedding markets in a `markets: string[]` array,
 * the same model `searchMetricsApiDb` (search-db.js) reads.
 *
 * Wired as `env.SEARCH_EVENTS` in the DM env shim so the reused
 * `trackAnalyticsEvent` search branch records instead of bailing with
 * "SEARCH_EVENTS D1 not available".
 *
 * writeSearchEvent's call sequence is deterministic:
 *   1. prepare(INSERT INTO search_events ...).bind(8 fields).run()
 *   2. (only if markets) prepare('SELECT last_insert_rowid() as id').first()
 *   3. (only if markets) batch([prepare(INSERT ... search_event_markets).bind(id, market), ...])
 * Markets are unknown at step 1, so the doc is inserted with markets:[] and
 * updated in step 3 when present.
 */
import { getCollection } from './db.js';

const COLLECTION = 'search_events';
const MAX_MARKETS = 20;
const INSERT_EVENT_RE = /INSERT\s+INTO\s+search_events/i;
const LAST_ID_RE = /last_insert_rowid/i;
const INSERT_MARKET_RE = /search_event_markets/i;

export default function makeSearchEventsD1Shim(env) {
  const state = { lastId: null };

  async function insertEvent(binds) {
    const [
      userId, userEmail, userCountry, userRole,
      searchTerm, searchType, resultCount, occurredAt,
    ] = binds;
    const col = await getCollection(env, COLLECTION);
    const res = await col.insertOne({
      user_id: userId || '',
      user_email: userEmail ?? null,
      user_country: userCountry ?? null,
      user_role: userRole ?? null,
      search_term: (searchTerm || '').substring(0, 200),
      search_type: searchType || 'all',
      result_count: resultCount ?? null,
      occurred_at: occurredAt || new Date().toISOString(),
      markets: [],
    });
    state.lastId = res?.insertedId ?? null;
  }

  async function addMarkets(rawMarkets) {
    const clean = [...new Set(
      rawMarkets.map((m) => String(m).trim()).filter(Boolean),
    )].slice(0, MAX_MARKETS);
    if (!state.lastId || clean.length === 0) return;
    const col = await getCollection(env, COLLECTION);
    await col.updateOne({ _id: state.lastId }, { $set: { markets: clean } });
  }

  function prepare(sqlText) {
    const stmt = {
      sqlText,
      args: [],
      bind(...boundArgs) { stmt.args = boundArgs; return stmt; },
      async run() {
        if (INSERT_EVENT_RE.test(sqlText)) await insertEvent(stmt.args);
        return { success: true };
      },
      async first() {
        return LAST_ID_RE.test(sqlText) ? { id: state.lastId } : null;
      },
    };
    return stmt;
  }

  async function batch(stmts) {
    const markets = (stmts || [])
      .filter((s) => INSERT_MARKET_RE.test(s?.sqlText || ''))
      .map((s) => s.args?.[1]);
    await addMarkets(markets);
    return [];
  }

  return { prepare, batch };
}
