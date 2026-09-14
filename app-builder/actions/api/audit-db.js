/**
 * Asset Audit API on `@adobe/aio-lib-db` — document-DB port of
 * cloudflare/src/api/audit.js. Same HTTP contract and response JSON.
 *
 * - POST /api/audit           → append one event
 * - GET  /api/audit/summary   → aggregated dashboard (VIEW_AUDIT permission)
 * - GET  /api/audit/export    → CSV (VIEW_AUDIT permission)
 *
 * D1 aggregations are re-expressed as aggregation pipelines. `COUNT(DISTINCT)`
 * uses the two-stage `$group` pattern (plan §3.3). The timeline keeps the
 * Worker's exact day/week/month bucket math by bucketing in JS.
 */
import {
  ASSET_AUDIT_ACTION_VALUES,
  ASSET_AUDIT_USER_TYPES,
  ASSET_AUDIT_ROLE_FILTER_VALUES,
  defaultFrom,
} from '../../../scripts/audit/asset-audit-constants.js';
import { PERMISSIONS, hasPermission } from '../../../scripts/auth/permissions.js';
import { getCollection } from '../storage/db.js';
import { jsonRes, noContent, readJson } from './_helpers.js';

const COLLECTION = 'audit_events';
const AUDIT_ACTIONS = ASSET_AUDIT_ACTION_VALUES;
const USER_TYPES = ASSET_AUDIT_USER_TYPES;
const ROLE_FILTERS = ASSET_AUDIT_ROLE_FILTER_VALUES;
const EXPORT_LIMIT = 10_000;
const TOP_ASSETS_LIMIT = 20;
const PREFIX = 'urn:aaid:aem:';

const ROLE_MAPPINGS = {
  associate: ['associate', 'employee', 'contingent-worker'],
  agency: ['agency'],
  partner: ['partner'],
};

// ---- pure helpers (mirror the Worker) ----
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseToBoundary(str) {
  if (!str) return null;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}
function daysBetween(from, to) {
  return Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24));
}
function bucketType(from, to) {
  const days = daysBetween(from, to);
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}
function bucketLabel(occurredAt, bucket) {
  const d = new Date(occurredAt);
  if (bucket === 'day') return d.toISOString().slice(0, 10);
  if (bucket === 'month') return d.toISOString().slice(0, 7);
  // week: Monday-start (matches strftime %w with ((weekday+6)%7) days back)
  const back = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - back);
  return m.toISOString().slice(0, 10);
}
function enumerateBuckets(from, to, bucket) {
  const out = [];
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  if (bucket === 'day') {
    while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  } else if (bucket === 'week') {
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  } else {
    d.setUTCDate(1);
    while (d <= end) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  }
  return out;
}
function resolveAuditUserFields(user = {}) {
  return {
    userId: user.sub,
    userEmail: user.email,
    userCountry: user.country ?? null,
    userType: user.userType ?? null,
    userRole: user.roles?.[0] ?? null,
  };
}
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseFilterParams(url) {
  return {
    user: url.searchParams.get('user') || '',
    country: url.searchParams.get('country') || '',
    userType: url.searchParams.get('userType') || '',
    role: url.searchParams.get('role') || '',
    assetId: url.searchParams.get('assetId') || '',
    action: url.searchParams.get('action') || '',
    from: parseDate(url.searchParams.get('from')) || defaultFrom(),
    to: parseToBoundary(url.searchParams.get('to')) || new Date().toISOString(),
  };
}
function validateFilterParams(p) {
  if (p.action && !AUDIT_ACTIONS.includes(p.action)) return 'Invalid action';
  if (p.userType && !USER_TYPES.includes(p.userType)) return 'Invalid userType';
  if (p.role && !ROLE_FILTERS.includes(p.role) && p.role !== 'unknown') return 'Invalid role';
  return null;
}

/** Translate the filter params to a Mongo `$match`. */
function buildMatch(p) {
  const m = {};
  if (p.user) m.user_email = p.user;
  if (p.country === 'unknown') m.user_country = null;
  else if (p.country) m.user_country = p.country;
  if (p.userType === 'unknown') m.user_type = null;
  else if (p.userType) m.user_type = p.userType;
  if (p.role === 'unknown') m.user_role = null;
  else if (p.role) {
    const rv = ROLE_MAPPINGS[p.role] || [p.role];
    m.user_role = rv.length === 1 ? rv[0] : { $in: rv };
  }
  if (p.assetId) m.asset_id = p.assetId;
  if (p.action) m.action = p.action;
  if (p.from || p.to) {
    m.occurred_at = {};
    if (p.from) m.occurred_at.$gte = p.from; // ISO strings sort lexicographically
    if (p.to) m.occurred_at.$lte = p.to;
  }
  return m;
}

const agg = (col, pipeline) => col.aggregate(pipeline).toArray();

// ---- routes ----
export async function auditApiDb(request, env, user) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;
  if (method === 'POST' && (pathname === '/api/audit/event' || pathname === '/api/audit')) {
    return auditPostEvent(request, env, user);
  }
  if (method === 'GET' && pathname.endsWith('/summary')) return auditGetSummary(request, env, user);
  if (method === 'GET' && (pathname.endsWith('/export.csv') || pathname.endsWith('/export'))) {
    return auditGetExportCsv(request, env, user);
  }
  return jsonRes(404, { error: 'Not Found' });
}

async function auditPostEvent(request, env, user) {
  const body = await readJson(request);
  if (!body) return jsonRes(400, { error: 'Invalid JSON body' });
  const { action, assetId } = body;
  if (!action || !AUDIT_ACTIONS.includes(action)) {
    return jsonRes(400, { error: `Invalid action. Must be one of: ${AUDIT_ACTIONS.join(', ')}` });
  }
  if (!assetId) return jsonRes(400, { error: 'assetId is required' });

  const { userId, userEmail, userCountry, userType, userRole } = resolveAuditUserFields(user);
  if (!userId || !userEmail) return jsonRes(401, { error: 'User session is incomplete' });

  try {
    const col = await getCollection(env, COLLECTION);
    await col.insertOne({
      user_id: userId,
      user_email: userEmail,
      user_country: userCountry,
      user_type: userType,
      user_role: userRole,
      action,
      asset_id: assetId,
      occurred_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[audit] insert failed:', err?.message);
    return jsonRes(500, { error: 'Failed to record event' });
  }
  return noContent();
}

async function auditGetSummary(request, env, user) {
  if (!hasPermission(user, PERMISSIONS.VIEW_AUDIT)) return jsonRes(403, { error: 'Forbidden' });

  const p = parseFilterParams(new URL(request.url));
  const invalid = validateFilterParams(p);
  if (invalid) return jsonRes(400, { error: invalid });

  const match = buildMatch(p);
  const bucket = bucketType(p.from, p.to);

  try {
    const col = await getCollection(env, COLLECTION);
    const groupCount = (field, extra = []) =>
      agg(col, [{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }, ...extra]);
    const distinctCount = (field, label) =>
      agg(col, [{ $match: match }, { $group: { _id: `$${field}` } }, { $count: label }]);

    const [
      total, uniqueUsers, uniqueAssets, timelineRows,
      byActionRows, byUserTypeRows, byRoleRows, byCountryRows, byAssetRows, topIdsRows,
    ] = await Promise.all([
      col.countDocuments(match),
      distinctCount('user_email', 'n'),
      distinctCount('asset_id', 'n'),
      agg(col, [{ $match: match }, { $project: { _id: 0, occurred_at: 1, action: 1 } }]),
      groupCount('action'),
      groupCount('user_type'),
      groupCount('user_role', [{ $sort: { count: -1 } }]),
      groupCount('user_country', [{ $sort: { count: -1 } }, { $limit: 10 }]),
      groupCount('asset_id', [{ $sort: { count: -1 } }, { $limit: 10 }]),
      agg(col, [{ $match: match }, { $group: { _id: '$asset_id', total: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: TOP_ASSETS_LIMIT }]),
    ]);

    // timeline: bucket in JS (exact Worker week math), then fill gaps
    const seriesSet = new Set();
    const byBucketMap = {};
    for (const row of timelineRows) {
      const b = bucketLabel(row.occurred_at, bucket);
      seriesSet.add(row.action);
      (byBucketMap[b] ||= {})[row.action] = (byBucketMap[b][row.action] || 0) + 1;
    }
    const series = [...seriesSet].sort();
    const timelineData = enumerateBuckets(p.from, p.to, bucket).map((label) => {
      const row = { bucket: label, ...(byBucketMap[label] ?? {}) };
      for (const s of series) row[s] ??= 0;
      return row;
    });

    // topAssets: per-action counts for the top asset ids
    const topIds = topIdsRows.map((r) => r._id);
    let topAssets = [];
    if (topIds.length) {
      const topRows = await agg(col, [
        { $match: { ...match, asset_id: { $in: topIds } } },
        { $group: { _id: { asset_id: '$asset_id', action: '$action' }, count: { $sum: 1 } } },
      ]);
      const assetMap = {};
      for (const r of topRows) {
        const aid = r._id.asset_id;
        (assetMap[aid] ||= { actions: {}, total: 0 });
        assetMap[aid].actions[r._id.action] = r.count;
        assetMap[aid].total += r.count;
      }
      topAssets = Object.entries(assetMap)
        .map(([assetId, { actions, total }]) => ({
          assetId,
          displayId: assetId.startsWith(PREFIX) ? assetId.slice(PREFIX.length) : assetId,
          encodedId: assetId,
          actions,
          total,
        }))
        .sort((a, b) => b.total - a.total);
    }

    const toMap = (rows, keyFallback) =>
      Object.fromEntries(rows.map((r) => [r._id ?? keyFallback, r.count]));
    const stripPrefix = (id) => (id?.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

    return jsonRes(200, {
      total,
      uniqueUsers: uniqueUsers[0]?.n ?? 0,
      uniqueAssets: uniqueAssets[0]?.n ?? 0,
      timeline: { bucket, series, data: timelineData },
      byAction: toMap(byActionRows),
      byUserType: toMap(byUserTypeRows, 'unknown'),
      byRole: toMap(byRoleRows, 'unknown'),
      byCountry: toMap(byCountryRows, 'unknown'),
      byAsset: Object.fromEntries(byAssetRows.map((r) => [stripPrefix(r._id), r.count])),
      topAssets,
    });
  } catch (err) {
    console.error('[audit] summary query failed:', err?.message);
    return jsonRes(500, { error: 'Failed to query audit data' });
  }
}

async function auditGetExportCsv(request, env, user) {
  if (!hasPermission(user, PERMISSIONS.VIEW_AUDIT)) return jsonRes(403, { error: 'Forbidden' });

  const p = parseFilterParams(new URL(request.url));
  const invalid = validateFilterParams(p);
  if (invalid) return jsonRes(400, { error: invalid });

  let rows;
  try {
    const col = await getCollection(env, COLLECTION);
    rows = await agg(col, [
      { $match: buildMatch(p) },
      { $sort: { occurred_at: -1 } },
      { $limit: EXPORT_LIMIT + 1 },
      { $project: { _id: 0, occurred_at: 1, user_id: 1, user_email: 1, user_country: 1, user_type: 1, user_role: 1, action: 1, asset_id: 1 } },
    ]);
  } catch (err) {
    console.error('[audit] export query failed:', err?.message);
    return jsonRes(500, { error: 'Failed to export audit data' });
  }

  const truncated = rows.length > EXPORT_LIMIT;
  if (truncated) rows = rows.slice(0, EXPORT_LIMIT);

  const header = 'Occurred At,User ID,Email,Country,User Type,Role,Action,Asset ID\r\n';
  const csvBody = rows
    .map((r) => [r.occurred_at, r.user_id, r.user_email, r.user_country, r.user_type, r.user_role, r.action, r.asset_id].map(csvEscape).join(','))
    .join('\r\n');

  const date = new Date().toISOString().slice(0, 10);
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="spark-asset-activity-export-${date}.csv"`,
      'x-total-rows': String(rows.length),
      'x-truncated': String(truncated),
    },
    body: header + csvBody,
  };
}
