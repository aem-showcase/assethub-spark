/**
 * Search Metrics API on `@adobe/aio-lib-db` — document-DB port of the
 * search_events portion of cloudflare/src/api/analytics.js.
 *
 * Modeling: one document per search event with the markets embedded as a
 * `markets: string[]` array (the D1 `search_event_markets` child table). This
 * turns the write into a single atomic `insertOne` and the market JOINs into
 * `$unwind`. `COUNT(DISTINCT)` uses the two-stage `$group` pattern.
 *
 * - writeSearchEventDb(env, data)     → append an event (fire-and-forget)
 * - searchMetricsApiDb(request, env)  → GET /api/analytics/search-metrics?type=…
 */
import { getCollection } from '../storage/db.js';
import { jsonRes } from './_helpers.js';

const COLLECTION = 'search_events';
const FILTER_DEFAULT_VALUE = 'all';
const SEARCH_TOP_LIMIT = 20;
const VALID_ROLES = ['all', 'associate', 'agency', 'partner'];
const VALID_SEARCH_TYPES = ['all', 'assets', 'products', 'templates'];
const VALID_SEARCH_TERMS = ['all', 'empty', 'non-empty'];
const MARKET_TOKEN_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
const ROLE_MAPPINGS = {
  associate: ['associate', 'employee', 'contingent-worker'],
  agency: ['agency'],
  partner: ['partner'],
};
const isValidMarketToken = (v) => typeof v === 'string' && MARKET_TOKEN_PATTERN.test(v);
const MONTH = { $substrBytes: ['$occurred_at', 0, 7] }; // strftime('%Y-%m', occurred_at)

const agg = (col, pipeline) => col.aggregate(pipeline).toArray();

// ---- write ----
export async function writeSearchEventDb(env, data) {
  const markets = Array.isArray(data.assetMarkets)
    ? [...new Set(data.assetMarkets.map((m) => String(m).trim()).filter(Boolean))].slice(0, 20)
    : [];
  const col = await getCollection(env, COLLECTION);
  await col.insertOne({
    user_id: data.userId || '',
    user_email: data.userEmail || null,
    user_country: data.country || null,
    user_role: data.roles?.[0] || null,
    search_term: (data.searchTerm || '').substring(0, 200),
    search_type: data.searchType || 'all',
    result_count: data.resultCount ?? null,
    occurred_at: new Date().toISOString(),
    markets,
  });
}

// ---- match builders ----
function appendAttributeFilters(m, filters = {}) {
  if (filters.role && filters.role !== FILTER_DEFAULT_VALUE) {
    if (!VALID_ROLES.includes(filters.role)) throw new Error(`Invalid role filter: ${filters.role}`);
    const rv = ROLE_MAPPINGS[filters.role] || [filters.role];
    m.user_role = rv.length === 1 ? rv[0] : { $in: rv };
  }
  if (filters.searchType && filters.searchType !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TYPES.includes(filters.searchType)) throw new Error(`Invalid searchType filter: ${filters.searchType}`);
    m.search_type = filters.searchType;
  }
  if (filters.searchTerm && filters.searchTerm !== FILTER_DEFAULT_VALUE) {
    if (!VALID_SEARCH_TERMS.includes(filters.searchTerm)) throw new Error(`Invalid searchTerm filter: ${filters.searchTerm}`);
    if (filters.searchTerm === 'empty') m.$or = [{ search_term: '' }, { search_term: null }];
    else m.search_term = { $ne: '' };
  }
  if (filters.region && filters.region !== FILTER_DEFAULT_VALUE) {
    if (!isValidMarketToken(filters.region)) throw new Error(`Invalid region filter: ${filters.region}`);
    m.markets = filters.region; // array membership (was EXISTS on search_event_markets)
  }
  return m;
}
function dateRange(startDate, endDate) {
  return { $gte: `${startDate}T00:00:00.000Z`, $lte: `${endDate}T23:59:59.999Z` };
}
function fullMatch(startDate, endDate, filters) {
  return appendAttributeFilters({ occurred_at: dateRange(startDate, endDate) }, filters);
}
function attributeMatch(filters) {
  return appendAttributeFilters({}, filters);
}

// ---- metrics ----
async function executeSearchMetric(col, metricType, startDate, endDate, filters) {
  const match = fullMatch(startDate, endDate, filters);
  const startTs = `${startDate}T00:00:00.000Z`;
  const endTs = `${endDate}T23:59:59.999Z`;

  switch (metricType) {
    case 'totalSearches':
      return [{ total: await col.countDocuments(match) }];

    case 'uniqueSearchers': {
      const r = await agg(col, [{ $match: match }, { $group: { _id: '$user_id' } }, { $count: 'unique_count' }]);
      return [{ unique_count: r[0]?.unique_count ?? 0 }];
    }

    case 'firstTimeSearchers': {
      const r = await agg(col, [
        { $match: attributeMatch(filters) },
        { $group: { _id: '$user_id', firstSeen: { $min: '$occurred_at' } } },
        { $match: { firstSeen: { $gte: startTs, $lte: endTs } } },
        { $count: 'first_time_count' },
      ]);
      return [{ first_time_count: r[0]?.first_time_count ?? 0 }];
    }

    case 'uniqueSearchersByMonth':
      return agg(col, [
        { $match: match },
        { $group: { _id: { month: MONTH, user: '$user_id' } } },
        { $group: { _id: '$_id.month', users: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, month: '$_id', users: 1 } },
      ]);

    case 'searchesByMonth':
      return agg(col, [
        { $match: match },
        { $group: { _id: { month: MONTH, searchType: '$search_type' }, searches: { $sum: 1 } } },
        { $sort: { '_id.month': 1 } },
        { $project: { _id: 0, month: '$_id.month', searchType: '$_id.searchType', searches: 1 } },
      ]);

    case 'uniqueSearchersByRole':
      return agg(col, [
        { $match: match },
        { $group: { _id: { role: '$user_role', user: '$user_id' } } },
        { $group: { _id: '$_id.role', users: { $sum: 1 } } },
        { $sort: { users: -1 } },
        { $project: { _id: 0, role: '$_id', users: 1 } },
      ]);

    case 'searchesByRole':
      return agg(col, [
        { $match: match },
        { $group: { _id: '$user_role', searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $project: { _id: 0, role: '$_id', searches: 1 } },
      ]);

    case 'distinctMarkets':
      return agg(col, [
        { $match: { occurred_at: dateRange(startDate, endDate) } },
        { $unwind: '$markets' },
        { $group: { _id: '$markets' } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, market: '$_id' } },
      ]);

    case 'uniqueSearchersByMarket':
      return agg(col, [
        { $match: match },
        { $unwind: '$markets' },
        { $group: { _id: { market: '$markets', user: '$user_id' } } },
        { $group: { _id: '$_id.market', users: { $sum: 1 } } },
        { $sort: { users: -1 } },
        { $project: { _id: 0, market: '$_id', users: 1 } },
      ]);

    case 'searchesByMarket':
      return agg(col, [
        { $match: match },
        { $unwind: '$markets' },
        { $group: { _id: '$markets', searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $project: { _id: 0, market: '$_id', searches: 1 } },
      ]);

    case 'searchesByMarketAndType':
      return agg(col, [
        { $match: match },
        { $unwind: '$markets' },
        { $group: { _id: { market: '$markets', searchType: '$search_type' }, searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $project: { _id: 0, market: '$_id.market', searchType: '$_id.searchType', searches: 1 } },
      ]);

    case 'searchDistributionByType':
      return agg(col, [
        { $match: match },
        { $group: { _id: '$search_type', searches: { $sum: 1 } } },
        { $sort: { searches: -1 } },
        { $project: { _id: 0, searchType: '$_id', searches: 1 } },
      ]);

    case 'searchDistributionByResultSize': {
      const order = [
        '0 results', '1-10 results', '11-50 results', '51-100 results', '101-500 results',
        '501-1000 results', '1001-10000 results', '10001-100000 results', '100000+ results',
      ];
      const rc = '$result_count';
      const rows = await agg(col, [
        { $match: match },
        {
          $project: {
            b: {
              $switch: {
                branches: [
                  { case: { $or: [{ $eq: [rc, null] }, { $eq: [rc, 0] }] }, then: '0 results' },
                  { case: { $and: [{ $gt: [rc, 0] }, { $lte: [rc, 10] }] }, then: '1-10 results' },
                  { case: { $and: [{ $gt: [rc, 10] }, { $lte: [rc, 50] }] }, then: '11-50 results' },
                  { case: { $and: [{ $gt: [rc, 50] }, { $lte: [rc, 100] }] }, then: '51-100 results' },
                  { case: { $and: [{ $gt: [rc, 100] }, { $lte: [rc, 500] }] }, then: '101-500 results' },
                  { case: { $and: [{ $gt: [rc, 500] }, { $lte: [rc, 1000] }] }, then: '501-1000 results' },
                  { case: { $and: [{ $gt: [rc, 1000] }, { $lte: [rc, 10000] }] }, then: '1001-10000 results' },
                  { case: { $and: [{ $gt: [rc, 10000] }, { $lte: [rc, 100000] }] }, then: '10001-100000 results' },
                ],
                default: '100000+ results',
              },
            },
          },
        },
        { $group: { _id: '$b', searches: { $sum: 1 } } },
      ]);
      const counts = Object.fromEntries(rows.map((r) => [r._id, r.searches]));
      return order.map((bucket) => ({ bucket, searches: counts[bucket] ?? 0 }));
    }

    case 'topSearches':
      return agg(col, [
        { $match: { ...match, search_term: { $ne: '' } } },
        { $group: { _id: { term: '$search_term', type: '$search_type' }, totalSearches: { $sum: 1 }, users: { $addToSet: '$user_id' } } },
        { $project: { _id: 0, searchTerm: '$_id.term', searchType: '$_id.type', totalSearches: 1, uniqueSearchers: { $size: '$users' } } },
        { $sort: { totalSearches: -1 } },
        { $limit: SEARCH_TOP_LIMIT },
      ]);

    case 'topZeroResultSearches':
      return agg(col, [
        { $match: { ...match, search_term: { $ne: '' }, $or: [{ result_count: 0 }, { result_count: null }] } },
        { $group: { _id: { term: '$search_term', type: '$search_type' }, totalSearches: { $sum: 1 }, users: { $addToSet: '$user_id' } } },
        { $project: { _id: 0, searchTerm: '$_id.term', searchType: '$_id.type', totalSearches: 1, uniqueSearchers: { $size: '$users' } } },
        { $sort: { totalSearches: -1 } },
        { $limit: SEARCH_TOP_LIMIT },
      ]);

    default:
      throw new Error(`Unknown search metric type: ${metricType}`);
  }
}

// ---- route ----
export async function searchMetricsApiDb(request, env) {
  if (request.method !== 'GET') return jsonRes(405, { success: false, error: 'Method not allowed' });

  try {
    const url = new URL(request.url);
    const metricType = url.searchParams.get('type');
    if (!metricType) return jsonRes(400, { success: false, error: 'Missing required parameter: type' });

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

    const col = await getCollection(env, COLLECTION);
    const data = await executeSearchMetric(col, metricType, startDate, endDate, filters);
    return jsonRes(200, { success: true, type: metricType, data });
  } catch (err) {
    console.error('[search-metrics] error:', err?.message);
    return jsonRes(500, { success: false, error: err?.message || 'Failed to get search metrics' });
  }
}
