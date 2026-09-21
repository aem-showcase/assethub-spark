/**
 * Folder discovery for Lane A / enrich-existing.
 *
 * The demo owns exactly one flat DAM folder: /content/dam/<companyKey>. Discovery must stay
 * inside that folder. A previous implementation used a tenant-wide asset search and then
 * filtered client-side ("scanned 2266 repo assets, 12 under /content/dam/disney-in"), which
 * was both slow and easy to confuse with unrelated assets carrying the same company tag.
 */

import {
  SEARCH_PAGE_LIMIT,
} from './constants.js';

/** Normalize a Fetch Headers object (or plain map) into a serializable plain object. */
export function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  if (typeof headers.forEach === 'function') {
    const out = {};
    headers.forEach((v, k) => { out[k] = v; });
    return out;
  }
  return { ...headers };
}

/**
 * Build the POST /assets/search body for a full match-all scan page. The caller filters the
 * results by folder prefix; the server-side query intentionally does NOT try to scope by
 * path (see module header for why that is unreliable here).
 */
export function buildScanQuery(limit = SEARCH_PAGE_LIMIT, cursor = null) {
  const body = {
    query: [{ match: { text: '*', mode: 'FULLTEXT' } }],
    limit,
  };
  if (cursor) body.cursor = cursor;
  return body;
}

function encodeSegments(path) {
  return String(path || '')
    .split('/')
    .map((seg) => (seg === '' ? '' : encodeURIComponent(seg)))
    .join('/');
}

function uuidToAssetId(uuid) {
  if (!uuid) return '';
  return String(uuid).startsWith('urn:aaid:aem:') ? String(uuid) : `urn:aaid:aem:${uuid}`;
}

function hitToAsset(item, folderPath, name = null) {
  const repositoryMetadata = item.repositoryMetadata || item['repository:metadata'] || {};
  const repoName = repositoryMetadata['repo:name'] || item.name || name || null;
  const repoPath = repositoryMetadata['repo:path']
    || item.path
    || (repoName ? `${folderPath.replace(/\/+$/, '')}/${repoName}` : null);
  const assetId = item.assetId
    || item.id
    || repositoryMetadata['repo:id']
    || uuidToAssetId(item['jcr:uuid'])
    || uuidToAssetId(repositoryMetadata['jcr:uuid']);
  return { assetId, repoPath, repoName };
}

function extractHits(json, folderPath) {
  // AEM Assets search returns { hits: { results: [...] }, cursor }.
  // Older/alternate shapes (items/assets/results at top level) are handled defensively.
  const items = json?.hits?.results
    || json?.hits
    || json?.items
    || json?.assets
    || json?.results
    || [];
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => hitToAsset(item, folderPath)).filter((a) => a.assetId);
}

function extractSlingChildren(json, folderPath) {
  if (!json || typeof json !== 'object') return [];
  const fromItems = extractHits(json, folderPath)
    .filter((asset) => isUnderFolder(asset.repoPath, folderPath));
  if (fromItems.length) return fromItems;

  return Object.entries(json)
    .filter(([name, value]) => (
      name !== 'jcr:content'
      && value
      && typeof value === 'object'
      && (value['jcr:primaryType'] === 'dam:Asset' || value['jcr:uuid'] || value.assetId || value.id)
    ))
    .map(([name, value]) => hitToAsset(value, folderPath, name))
    .filter((asset) => asset.assetId && isUnderFolder(asset.repoPath, folderPath));
}

/** True when repoPath is a descendant of folderPath (a real prefix match on path segments). */
export function isUnderFolder(repoPath, folderPath) {
  if (!repoPath) return false;
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  return repoPath.startsWith(prefix);
}

/**
 * Enumerate assets directly from the demo DAM folder. The folder is flat by contract, so a
 * one-level Sling JSON read is enough and avoids tenant-wide search.
 *
 * @param {Object} params
 * @param {import('./author-client.js').AuthorClient} params.client
 * @param {string} params.folderPath e.g. /content/dam/santander
 * @param {number} [params.limit] page size
 * @param {number} [params.scanCap] ignored; retained for API compatibility
 * @returns {Promise<{ assets: Array, scanned: number, matched: number,
 *   exceededWindow: boolean }>}
 */
export async function enumerateFolder({
  client, folderPath, limit = SEARCH_PAGE_LIMIT,
}) {
  const paths = [
    `${encodeSegments(folderPath)}.1.json`,
    `${encodeSegments(folderPath)}.children.json`,
  ];
  const seen = new Set();

  for (const path of paths) {
    const res = await client.request('sling', {
      method: 'GET',
      path,
      headers: { Accept: 'application/json' },
      includeApiKey: false,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 404 && path !== paths[paths.length - 1]) continue;
      const err = new Error(`enumerate ${folderPath} -> ${res.status} ${text}`.trim());
      err.status = res.status;
      err.responseBody = text;
      err.responseHeaders = headersToObject(res.headers);
      throw err;
    }

    const json = await res.json();
    const assets = [];
    for (const hit of extractSlingChildren(json, folderPath)) {
      if (seen.has(hit.assetId)) continue;
      seen.add(hit.assetId);
      assets.push(hit);
    }
    return {
      assets,
      scanned: assets.length,
      matched: assets.length,
      exceededWindow: false,
    };
  }

  return {
    assets: [], scanned: 0, matched: 0, exceededWindow: false,
  };
}
