/**
 * Cloudflare D1 over its HTTP REST API, shaped to mimic the D1 *binding* API
 * (`prepare().bind().all()/.run()/.first()`). This lets the ported route
 * handlers (e.g. api/smart-collections.js) run UNCHANGED — only the access path
 * changes from a native Worker binding to an HTTPS call.
 *
 * Storage decision (FINDINGS.md): keep the existing D1 database, reach it over
 * HTTP. Zero data migration; isolates the *actual* hard limit (App Builder has
 * no native relational-SQL binding) instead of introducing a new DB vendor.
 *
 * Endpoint:
 *   POST https://api.cloudflare.com/client/v4/accounts/{acct}/d1/database/{db}/query
 *   Authorization: Bearer {token}
 *   { "sql": "...", "params": [...] }   // ?1..?N numbered params, positional
 */

const D1_BASE = 'https://api.cloudflare.com/client/v4';

class D1Statement {
  constructor(client, sql) {
    this.client = client;
    this.sql = sql;
    this.params = [];
  }

  bind(...args) {
    this.params = args;
    return this;
  }

  async #exec() {
    const { accountId, databaseId, token } = this.client;
    const res = await fetch(
      `${D1_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sql: this.sql, params: this.params }),
      },
    );
    const payload = await res.json();
    if (!res.ok || !payload.success) {
      const msg = payload.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(`D1 HTTP error: ${msg}`);
    }
    // D1 REST returns result: [ { results, success, meta } ]
    return payload.result[0];
  }

  async all() {
    const r = await this.#exec();
    return { results: r.results || [], meta: r.meta || {} };
  }

  async run() {
    const r = await this.#exec();
    return { meta: r.meta || {} };
  }

  async first() {
    const r = await this.#exec();
    return (r.results && r.results[0]) || null;
  }
}

/**
 * Build an object that quacks like a D1 binding.
 * @param {{accountId:string, databaseId:string, token:string}} cfg
 */
export function d1Binding(cfg) {
  const client = cfg;
  return {
    prepare(sql) {
      return new D1Statement(client, sql);
    },
  };
}
