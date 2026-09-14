/**
 * Pure helpers for reading a persisted `smartCollectionQuery` (the ContentAI "search assets"
 * query payload) — with no dependency on the search-results runtime, so any surface (collections
 * list, standalone block) can build a deep link back to the search page from a saved Smart
 * Collection.
 */

/** ContentAI field paths that are auto-injected (not user filters) and must be ignored. */
const IGNORED_FIELD_PATHS = new Set(['assetMetadata.pur:expirationDate']);

const RANGE_OP_MAP = {
  gte: '>=', gt: '>', lte: '<=', lt: '<',
};

/**
 * Strip the `assetMetadata.` / `repositoryMetadata.` prefix from a ContentAI field path to get
 * back the facet key (inverse of getMetadataPath).
 * @param {string} fieldPath
 * @returns {string}
 */
function fieldPathToFacetKey(fieldPath) {
  return fieldPath.replace(/^assetMetadata\./, '').replace(/^repositoryMetadata\./, '');
}

/**
 * Recursively collect `match`/`term`/`range` leaves from a ContentAI query node.
 * @param {*} node
 * @param {{ text: string, facetCheckedState: Object, numericFilters: string[] }} acc
 */
function walkQueryNode(node, acc) {
  if (Array.isArray(node)) {
    node.forEach((child) => walkQueryNode(child, acc));
    return;
  }
  if (!node || typeof node !== 'object') return;

  if (node.and) walkQueryNode(node.and, acc);
  if (node.or) walkQueryNode(node.or, acc);
  if (node.not) walkQueryNode(node.not, acc);

  if (node.match && typeof node.match.text === 'string') {
    if (!acc.text && node.match.text.trim()) acc.text = node.match.text.trim();
  }

  if (node.term && typeof node.term === 'object') {
    Object.entries(node.term).forEach(([fieldPath, values]) => {
      if (IGNORED_FIELD_PATHS.has(fieldPath) || fieldPath === 'assetId') return;
      const key = fieldPathToFacetKey(fieldPath);
      if (!acc.facetCheckedState[key]) acc.facetCheckedState[key] = {};
      (Array.isArray(values) ? values : [values]).forEach((value) => {
        acc.facetCheckedState[key][value] = true;
      });
    });
  }

  if (node.range && typeof node.range === 'object') {
    Object.entries(node.range).forEach(([fieldPath, bounds]) => {
      if (IGNORED_FIELD_PATHS.has(fieldPath) || !bounds || typeof bounds !== 'object') return;
      const field = fieldPathToFacetKey(fieldPath);
      Object.entries(bounds).forEach(([boundKey, value]) => {
        const op = RANGE_OP_MAP[boundKey];
        if (op) acc.numericFilters.push(`${field} ${op} ${value}`);
      });
    });
  }
}

/**
 * Reverse a persisted `smartCollectionQuery` back into search-results.js state fields.
 * @param {import('./smart-collection-types.js').SmartCollectionQuery} smartCollectionQuery
 * @returns {{ query: string, facetCheckedState: Object, selectedNumericFilters: string[] }}
 */
export function parseSmartCollectionQuery(smartCollectionQuery) {
  const acc = { text: '', facetCheckedState: {}, numericFilters: [] };
  if (smartCollectionQuery && Array.isArray(smartCollectionQuery.query)) {
    walkQueryNode(smartCollectionQuery.query, acc);
  }
  return {
    query: acc.text,
    facetCheckedState: acc.facetCheckedState,
    selectedNumericFilters: acc.numericFilters,
  };
}

/**
 * Build a search-page deep link (query string only, without the base path) that restores a
 * Smart Collection's saved query. Param shapes match blocks/search-results/utils/config.js.
 * @param {import('./smart-collection-types.js').SmartCollectionQuery} smartCollectionQuery
 * @returns {string} e.g. `query=barista&facetFilters=%7B...%7D`
 */
export function buildSmartCollectionSearchParams(smartCollectionQuery) {
  const { query, facetCheckedState, selectedNumericFilters } = parseSmartCollectionQuery(
    smartCollectionQuery,
  );
  const params = new URLSearchParams();
  if (query) params.set('query', query);

  const hasFacets = Object.keys(facetCheckedState).some(
    (key) => Object.values(facetCheckedState[key]).some(Boolean),
  );
  if (hasFacets) {
    params.set('facetFilters', encodeURIComponent(JSON.stringify(facetCheckedState)));
  }
  if (selectedNumericFilters.length > 0) {
    params.set('numericFilters', encodeURIComponent(JSON.stringify(selectedNumericFilters)));
  }
  return params.toString();
}
