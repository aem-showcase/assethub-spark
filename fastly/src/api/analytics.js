/**
 * Search analytics — D1 parts only.
 *
 * Extracted from cloudflare/src/api/analytics.js (a 2377-line file that is mostly the
 * Cloudflare **Analytics Engine** reporting subsystem — dead code we are NOT porting, per
 * the migration headline). This file keeps just the SEARCH_EVENTS D1 pieces that have real
 * data and work in Spark: the `searchMetricsApi` report (read) and `writeSearchEvent`
 * (write), plus their query-builder helpers and constants.
 *
 * Fastly adaptation: `writeSearchEvent` uses `INSERT ... RETURNING id` instead of a separate
 * `SELECT last_insert_rowid()` — over the D1 REST API each /query is an independent
 * connection, so a follow-up last_insert_rowid() would not see the prior INSERT.
 *
 * The `env.SEARCH_EVENTS` binding is the D1-over-HTTP client (platform/d1-http.js).
 */

import { error, json } from 'itty-router';

const FILTER_DEFAULT_VALUE = 'all';
const VALID_ROLES = ['all', 'associate', 'agency', 'partner'];
const VALID_SEARCH_TYPES = ['all', 'assets', 'products', 'templates'];
const VALID_SEARCH_TERMS = ['all', 'empty', 'non-empty'];
const ROLE_MAPPINGS = {
  associate: ['associate', 'employee', 'contingent-worker'],
  agency: ['agency'],
  partner: ['partner'],
};
const SEARCH_TOP_LIMIT = 20;
const MARKET_TOKEN_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

function isValidMarketToken(value) {
  return typeof value === 'string' && MARKET_TOKEN_PATTERN.test(value);
}

/**
 * Date-only conditions for market discovery queries (no market filter applied).
 */
function buildSearchDateConditions(startDate, endDate) {
  return {
    whereClause: 'se.occurred_at >= ? AND se.occurred_at <= ?',
    bindings: [`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`],
  };
}

/**
 * Role, search type, term, and market filters for search_events (alias `se`).
 * Does not include the occurred_at date range.
 */
function appendSearchAttributeFilters(conditions, bindings, filters = {}) {
  if (filters.role && filters.role !== FILTER_DEFAULT_VALUE) {
    if (!VALID_ROLES.includes(filters.role)) throw new Error(`Invalid role filter: ${filters.role}`);
    const roleValues = ROLE_MAPPINGS[filters.role] || [filters.role];
    const roleClauses = roleValues.map(() => `se.user_role = ?`).join(' OR ');
    conditions.push(`(${roleClauses})`);
    bindings.push(...roleValues);
  }

  if (filters.searchType && filters.searchType !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TYPES.includes(filters.searchType))
      throw new Error(`Invalid searchType filter: ${filters.searchType}`);
    conditions.push(`se.search_type = ?`);
    bindings.push(filters.searchType);
  }

  if (filters.searchTerm && filters.searchTerm !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TERMS.includes(filters.searchTerm))
      throw new Error(`Invalid searchTerm filter: ${filters.searchTerm}`);
    if (filters.searchTerm === 'empty') {
      conditions.push(`(se.search_term = '' OR se.search_term IS NULL)`);
    } else {
      conditions.push(`se.search_term != ''`);
    }
  }

  if (filters.region && filters.region !== FILTER_DEFAULT_VALUE) {
    if (!isValidMarketToken(filters.region)) throw new Error(`Invalid region filter: ${filters.region}`);
    conditions.push(
      `EXISTS (SELECT 1 FROM search_event_markets sem WHERE sem.event_id = se.id AND sem.market = ?)`,
    );
    bindings.push(filters.region);
  }
}

/**
 * Build D1 WHERE clause params for search_events queries (alias `se`).
 */
function buildSearchD1Conditions(startDate, endDate, filters = {}) {
  const conditions = [`se.occurred_at >= ?`, `se.occurred_at <= ?`];
  const bindings = [`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`];
  appendSearchAttributeFilters(conditions, bindings, filters);
  return { whereClause: conditions.join(' AND '), bindings };
}

/** Attribute filters only (no date range), for first-time user subqueries. */
function buildSearchAttributeConditions(filters = {}) {
  const conditions = [];
  const bindings = [];
  appendSearchAttributeFilters(conditions, bindings, filters);
  return {
    whereClause: conditions.length ? conditions.join(' AND ') : '1=1',
    bindings,
  };
}

/**
 * GET /api/analytics/search-metrics
 * All search report metrics served from the SEARCH_EVENTS D1 database.
 */
export async function searchMetricsApi(request, env) {
  if (request.method !== 'GET') return error(405, { success: false, error: 'Method not allowed' });

  const db = env.SEARCH_EVENTS;
  if (!db) return error(500, { success: false, error: 'SEARCH_EVENTS D1 binding not configured' });

  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get('type');

    const currentYear = new Date().getFullYear();
    const year = parseInt(url.searchParams.get('year'), 10) || currentYear;
    const month = url.searchParams.get('month') ? parseInt(url.searchParams.get('month'), 10) : null;
    const customStart = url.searchParams.get('startDate');
    const customEnd = url.searchParams.get('endDate');

    let startDate;
    let endDate;
    if (customStart && customEnd) {
      startDate = customStart;
      endDate = customEnd;
    } else if (month) {
      startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    } else {
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
    }

    const filters = {
      role: url.searchParams.get('role') || FILTER_DEFAULT_VALUE,
      searchType: url.searchParams.get('searchType') || FILTER_DEFAULT_VALUE,
      searchTerm: url.searchParams.get('searchTerm') || FILTER_DEFAULT_VALUE,
      region: url.searchParams.get('region') || FILTER_DEFAULT_VALUE,
    };

    if (!metricType) {
      return error(400, { success: false, error: 'Missing required parameter: type' });
    }

    const data = await executeSearchMetric(db, metricType, startDate, endDate, filters, year);
    return json({ success: true, type: metricType, data });
  } catch (err) {
    console.error('[Search Metrics] Error:', err.message);
    return error(500, { success: false, error: err.message || 'Failed to get search metrics' });
  }
}

async function executeSearchMetric(db, metricType, startDate, endDate, filters, _year) {
  const { whereClause, bindings } = buildSearchD1Conditions(startDate, endDate, filters);
  const startTs = `${startDate}T00:00:00.000Z`;
  const endTs = `${endDate}T23:59:59.999Z`;

  switch (metricType) {
    case 'totalSearches': {
      const row = await db
        .prepare(`SELECT COUNT(*) as total FROM search_events se WHERE ${whereClause}`)
        .bind(...bindings)
        .first();
      return [{ total: row?.total ?? 0 }];
    }

    case 'uniqueSearchers': {
      const row = await db
        .prepare(`SELECT COUNT(DISTINCT se.user_id) as unique_count FROM search_events se WHERE ${whereClause}`)
        .bind(...bindings)
        .first();
      return [{ unique_count: row?.unique_count ?? 0 }];
    }

    case 'firstTimeSearchers': {
      const { whereClause: attrWhere, bindings: attrBindings } = buildSearchAttributeConditions(filters);
      const row = await db
        .prepare(
          `SELECT COUNT(*) as first_time_count FROM (
          SELECT se.user_id
          FROM search_events se
          WHERE ${attrWhere}
          GROUP BY se.user_id
          HAVING MIN(se.occurred_at) >= ? AND MIN(se.occurred_at) <= ?
        )`,
        )
        .bind(...attrBindings, startTs, endTs)
        .first();
      return [{ first_time_count: row?.first_time_count ?? 0 }];
    }

    case 'uniqueSearchersByMonth': {
      const rows = await db
        .prepare(
          `SELECT strftime('%Y-%m', se.occurred_at) as month, COUNT(DISTINCT se.user_id) as users
         FROM search_events se WHERE ${whereClause}
         GROUP BY month ORDER BY month`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMonth': {
      const rows = await db
        .prepare(
          `SELECT strftime('%Y-%m', se.occurred_at) as month, se.search_type as searchType, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY month, searchType ORDER BY month`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'uniqueSearchersByRole': {
      const rows = await db
        .prepare(
          `SELECT se.user_role as role, COUNT(DISTINCT se.user_id) as users
         FROM search_events se WHERE ${whereClause}
         GROUP BY role ORDER BY users DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByRole': {
      const rows = await db
        .prepare(
          `SELECT se.user_role as role, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY role ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'distinctMarkets': {
      const { whereClause: dateWhere, bindings: dateBindings } = buildSearchDateConditions(startDate, endDate);
      const rows = await db
        .prepare(
          `SELECT DISTINCT sem.market as market
         FROM search_event_markets sem
         INNER JOIN search_events se ON se.id = sem.event_id
         WHERE ${dateWhere}
         ORDER BY sem.market ASC`,
        )
        .bind(...dateBindings)
        .all();
      return rows.results || [];
    }

    case 'uniqueSearchersByMarket': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, COUNT(DISTINCT se.user_id) as users
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market ORDER BY users DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMarket': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, COUNT(*) as searches
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchesByMarketAndType': {
      const rows = await db
        .prepare(
          `SELECT sem.market as market, se.search_type as searchType, COUNT(*) as searches
         FROM search_events se
         INNER JOIN search_event_markets sem ON sem.event_id = se.id
         WHERE ${whereClause}
         GROUP BY sem.market, searchType ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchDistributionByType': {
      const rows = await db
        .prepare(
          `SELECT se.search_type as searchType, COUNT(*) as searches
         FROM search_events se WHERE ${whereClause}
         GROUP BY searchType ORDER BY searches DESC`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'searchDistributionByResultSize': {
      const buckets = [
        { bucket: '0 results', condition: '(se.result_count = 0 OR se.result_count IS NULL)' },
        { bucket: '1-10 results', condition: 'se.result_count > 0 AND se.result_count <= 10' },
        { bucket: '11-50 results', condition: 'se.result_count > 10 AND se.result_count <= 50' },
        { bucket: '51-100 results', condition: 'se.result_count > 50 AND se.result_count <= 100' },
        { bucket: '101-500 results', condition: 'se.result_count > 100 AND se.result_count <= 500' },
        { bucket: '501-1000 results', condition: 'se.result_count > 500 AND se.result_count <= 1000' },
        { bucket: '1001-10000 results', condition: 'se.result_count > 1000 AND se.result_count <= 10000' },
        { bucket: '10001-100000 results', condition: 'se.result_count > 10000 AND se.result_count <= 100000' },
        { bucket: '100000+ results', condition: 'se.result_count > 100000' },
      ];
      const results = await Promise.all(
        buckets.map(async ({ bucket, condition }) => {
          const row = await db
            .prepare(`SELECT COUNT(*) as searches FROM search_events se WHERE ${whereClause} AND ${condition}`)
            .bind(...bindings)
            .first();
          return { bucket, searches: row?.searches ?? 0 };
        }),
      );
      return results;
    }

    case 'topSearches': {
      const rows = await db
        .prepare(
          `SELECT se.search_term as searchTerm, se.search_type as searchType,
                COUNT(DISTINCT se.user_id) as uniqueSearchers, COUNT(*) as totalSearches
         FROM search_events se WHERE ${whereClause} AND se.search_term != ''
         GROUP BY searchTerm, searchType
         ORDER BY totalSearches DESC LIMIT ${SEARCH_TOP_LIMIT}`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    case 'topZeroResultSearches': {
      const rows = await db
        .prepare(
          `SELECT se.search_term as searchTerm, se.search_type as searchType,
                COUNT(DISTINCT se.user_id) as uniqueSearchers, COUNT(*) as totalSearches
         FROM search_events se WHERE ${whereClause} AND se.search_term != ''
                              AND (se.result_count = 0 OR se.result_count IS NULL)
         GROUP BY searchTerm, searchType
         ORDER BY totalSearches DESC LIMIT ${SEARCH_TOP_LIMIT}`,
        )
        .bind(...bindings)
        .all();
      return rows.results || [];
    }

    default:
      throw new Error(`Unknown search metric type: ${metricType}`);
  }
}

/**
 * Write a search event to the SEARCH_EVENTS D1 table. Called fire-and-forget from
 * analytics-helper.js on a 'search' event.
 *
 * NOTE (Fastly): capture is currently gated — dm-analytics.js `handleSearchAnalytics`
 * can't `response.clone()` a backend response, so it skips. Enabling live capture (a
 * read-and-reconstruct of the search response) is a Phase 2b item; the search REPORT
 * (`searchMetricsApi`) already reads the existing rows.
 */
export async function writeSearchEvent(db, data) {
  const markets = Array.isArray(data.assetMarkets)
    ? [...new Set(data.assetMarkets.map((m) => String(m).trim()).filter(Boolean))].slice(0, 20)
    : [];
  const occurredAt = new Date().toISOString();

  // Fastly adaptation: INSERT ... RETURNING id (the CF original used a separate
  // SELECT last_insert_rowid(), which is unreliable over the stateless D1 REST API).
  const inserted = await db
    .prepare(
      `INSERT INTO search_events (user_id, user_email, user_country, user_role, search_term, search_type, result_count, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      data.userId || '',
      data.userEmail || null,
      data.country || null,
      data.roles?.[0] || null,
      (data.searchTerm || '').substring(0, 200),
      data.searchType || 'all',
      data.resultCount ?? null,
      occurredAt,
    )
    .first();

  if (markets.length === 0) return;

  const eventId = inserted?.id;
  if (!eventId) {
    console.error('[Search Metrics] Failed to resolve event id after insert — market rows skipped');
    return;
  }

  try {
    await db.batch(
      markets.map((market) =>
        db.prepare('INSERT OR IGNORE INTO search_event_markets (event_id, market) VALUES (?, ?)').bind(eventId, market),
      ),
    );
  } catch (err) {
    console.error('[Search Metrics] Failed to write search_event_markets:', err);
  }
}
