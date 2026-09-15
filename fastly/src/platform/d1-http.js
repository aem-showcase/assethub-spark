// Platform seam (Fastly-specific, PoC data tier): a Cloudflare-D1-compatible client
// implemented over the D1 **REST API**, so the app's existing D1 code
// (`env.DB.prepare().bind().first()/.all()/.run()` + `.batch()`) runs unchanged from
// Fastly Compute. Fastly can't open the TCP connection a normal DB driver needs, but it
// CAN make HTTPS calls to https://api.cloudflare.com — which is exactly what D1's REST
// `/query` endpoint is. Transitional: Phase 2 swaps this for the chosen production DB
// (Turso/…). See docs/db-options-comparison.md and docs/assethub-migration-fastly.md.
import { CacheOverride } from 'fastly:cache-override';
import { fetchBackend } from './backends.js';

const endpoint = (accountId, databaseId) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

// Empty envelope shaped like D1's { results, success, meta }. Returned when the client
// isn't configured (no account/database/token) so reads yield [] and writes no-op instead
// of throwing — mirrors the 1a degrade philosophy (nothing 500s because a store is absent).
const degraded = () => ({
  results: [],
  success: true,
  meta: { changes: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
});

class D1HttpStatement {
  constructor(client, sql, params) {
    this._client = client;
    this._sql = sql;
    this._params = params || [];
  }

  // D1: bind() returns a NEW bound statement.
  bind(...params) {
    return new D1HttpStatement(this._client, this._sql, params);
  }

  // D1: first() -> first row object; first(col) -> that column's value; null if no rows.
  async first(colName) {
    const res = await this._client._query(this._sql, this._params);
    const row = res.results?.[0] ?? null;
    if (colName != null) return row ? (row[colName] ?? null) : null;
    return row;
  }

  // D1: all() -> { results, success, meta }
  async all() {
    return this._client._query(this._sql, this._params);
  }

  // D1: run() -> { results: [], success, meta: { changes, last_row_id, ... } }
  async run() {
    return this._client._query(this._sql, this._params);
  }
}

class D1HttpClient {
  constructor({ accountId, databaseId, getToken }) {
    this._accountId = accountId;
    this._databaseId = databaseId;
    this._getToken = getToken; // async () => token | undefined
    this._warned = false;
  }

  prepare(sql) {
    return new D1HttpStatement(this, sql);
  }

  // D1 batch() is an atomic transaction over N statements. The D1 REST API has no
  // first-class "batch with per-statement params" call, so for the PoC we run them
  // sequentially in order — NOT atomic. The only caller writes telemetry (search_events +
  // search_event_markets), where a partial write is low-consequence and parent-before-child
  // order is preserved. Phase 2's real DB driver restores atomic batch. (TODO: 2b.)
  async batch(statements) {
    const out = [];
    for (const st of statements) {
      // eslint-disable-next-line no-await-in-loop
      out.push(await this._query(st._sql, st._params));
    }
    return out;
  }

  async _query(sql, params) {
    const token = this._getToken ? await this._getToken() : undefined;
    if (!this._accountId || !this._databaseId || !token) {
      if (!this._warned) {
        console.warn('[d1:degraded] Cloudflare D1 not configured (missing account/database/token) — reads return [], writes no-op');
        this._warned = true;
      }
      return degraded();
    }

    const resp = await fetchBackend(endpoint(this._accountId, this._databaseId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params: params ?? [] }),
      cacheOverride: new CacheOverride('pass'),
    });

    let body;
    try {
      body = await resp.json();
    } catch {
      throw new Error(`D1 REST: non-JSON response (HTTP ${resp.status})`);
    }

    if (!resp.ok || !body.success) {
      const msg = (body?.errors || []).map((e) => e.message || e.code).join('; ') || `HTTP ${resp.status}`;
      throw new Error(`D1 query failed: ${msg}`);
    }

    // REST returns result: [ { results, success, meta } ] — one entry per statement.
    return body.result?.[0] ?? degraded();
  }
}

export function createD1Client(opts) {
  return new D1HttpClient(opts);
}
