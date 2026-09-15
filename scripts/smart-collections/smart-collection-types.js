/**
 * Shared types & constants for the "Smart Collections" feature.
 *
 * Smart Collections are now persisted natively as Dynamic Media collections with
 * `collectionType: 'DELIVERY_SMART_COLLECTION'` via the Adobe `/adobe/assets/collections`
 * API (proxied by the Cloudflare Worker at `/api/adobe/assets/collections`, which injects the
 * IMS token + `x-api-key`). A Smart Collection stores a `smartCollectionQuery` — the exact
 * `query`/`sort` payload the search page sends to the ContentAI "search assets" endpoint — so
 * applying a Smart Collection re-runs the live search.
 *
 * Distinct from ordinary "Collections" (static Dynamic Media asset collections / download
 * cart). Naming here is always "smart collection(s)".
 */

/**
 * The `smartCollectionQuery` payload — identical in shape to the ContentAI "search assets"
 * request body (see blocks/search-results/clients/dynamicmedia-client.js#buildQueryRequest).
 * @typedef {Object} SmartCollectionQuery
 * @property {Array<Object>} query - ContentAI query array (match/term/and/or clauses).
 * @property {Array<Object>} [sort] - ContentAI orderBy/sort array (empty for relevance).
 */

/**
 * Draft assembled from the current search-results.js state, used to build the save payload
 * and to render the modal preview (badges/title). Carries both the human-facing filter
 * summary and the native `smartCollectionQuery`.
 * @typedef {Object} SmartCollectionDraft
 * @property {string} [query] - Free-text search term (for badges / default title only).
 * @property {string} [sortType]
 * @property {'ascending'|'descending'} [sortDirection]
 * @property {Record<string, Record<string, boolean>>} [facetFilters] - facetCheckedState shape.
 * @property {SmartCollectionQuery} smartCollectionQuery - Native payload persisted on save.
 */

/**
 * A Smart Collection as returned by the native collections API (normalized).
 * @typedef {Object} SmartCollection
 * @property {string} id - collectionId.
 * @property {string} title
 * @property {string} [description]
 * @property {SmartCollectionQuery} smartCollectionQuery
 * @property {'private'|'read_only'|'public'} accessLevel
 * @property {string[]} [accessPrincipals] - Group ids a private collection is shared with.
 * @property {'FOCUSED'|'INFORMATIVE'} [layout]
 * @property {string} [thumbnail] - Hero asset id (urn:aaid:aem:...).
 * @property {boolean} [isOwner]
 * @property {string} [ownerEmail]
 * @property {string} [updatedAt] - ISO 8601 UTC.
 * @property {Object} [apiData] - Raw API collection object (kept for etag/updates).
 */

/** Marks a Dynamic Media collection as a Smart Collection. */
export const SMART_COLLECTION_TYPE = 'DELIVERY_SMART_COLLECTION';

/** Card layout stored on the collection. */
export const SMART_COLLECTION_LAYOUT = {
  FOCUSED: 'FOCUSED',
  INFORMATIVE: 'INFORMATIVE',
};

export const SMART_COLLECTION_LAYOUT_VALUES = Object.values(SMART_COLLECTION_LAYOUT);

export const DEFAULT_SMART_COLLECTION_LAYOUT = SMART_COLLECTION_LAYOUT.FOCUSED;

/** DM `accessLevel` values reused for Smart Collections. */
export const SMART_COLLECTION_ACCESS_LEVEL = {
  PRIVATE: 'private',
  READ_ONLY: 'read_only',
  PUBLIC: 'public',
};

export const SMART_COLLECTION_ACCESS_LEVEL_VALUES = Object.values(SMART_COLLECTION_ACCESS_LEVEL);

export const SMART_COLLECTION_TITLE_MAX_LENGTH = 200;
export const SMART_COLLECTION_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * @param {unknown} accessLevel
 * @returns {boolean}
 */
export function isValidAccessLevel(accessLevel) {
  return SMART_COLLECTION_ACCESS_LEVEL_VALUES.includes(accessLevel);
}

/**
 * @param {unknown} layout
 * @returns {boolean}
 */
export function isValidLayout(layout) {
  return SMART_COLLECTION_LAYOUT_VALUES.includes(layout);
}

/**
 * @param {unknown} title
 * @returns {boolean}
 */
export function isValidTitle(title) {
  return typeof title === 'string'
    && title.trim().length > 0
    && title.trim().length <= SMART_COLLECTION_TITLE_MAX_LENGTH;
}

/**
 * A valid `smartCollectionQuery` must at least carry a `query` array.
 * @param {unknown} smartCollectionQuery
 * @returns {boolean}
 */
export function isValidSmartCollectionQuery(smartCollectionQuery) {
  return !!smartCollectionQuery
    && typeof smartCollectionQuery === 'object'
    && Array.isArray(smartCollectionQuery.query);
}

/**
 * Does this draft represent an actual active search (as opposed to the default, empty state)?
 * Used to gate the "Save as Smart Collection" button client-side.
 * @param {SmartCollectionDraft} [draft]
 * @returns {boolean}
 */
export function hasActiveCriteria(draft) {
  if (!draft) return false;
  const hasQuery = !!draft.query && draft.query.trim().length > 0;
  const hasFacets = !!draft.facetFilters
    && Object.values(draft.facetFilters).some(
      (group) => group && Object.values(group).some(Boolean),
    );
  const hasNonDefaultSort = !!draft.sortType && draft.sortType !== 'topResults';
  return hasQuery || hasFacets || hasNonDefaultSort;
}

export default {
  SMART_COLLECTION_TYPE,
  SMART_COLLECTION_LAYOUT,
  SMART_COLLECTION_LAYOUT_VALUES,
  DEFAULT_SMART_COLLECTION_LAYOUT,
  SMART_COLLECTION_ACCESS_LEVEL,
  SMART_COLLECTION_ACCESS_LEVEL_VALUES,
  SMART_COLLECTION_TITLE_MAX_LENGTH,
  SMART_COLLECTION_DESCRIPTION_MAX_LENGTH,
  isValidAccessLevel,
  isValidLayout,
  isValidTitle,
  isValidSmartCollectionQuery,
  hasActiveCriteria,
};
