/**
 * Shared types & constants for the "Smart Collections" feature (persisted dynamic search
 * queries). Plain JS + JSDoc — this repo has no TypeScript. Imported by both the frontend
 * (blocks/search-results, scripts/smart-collections) and the Cloudflare Worker
 * (cloudflare/src/api/smart-collections.js), matching how scripts/audit/asset-audit-constants.js
 * is shared today.
 *
 * Distinct from the unrelated "Collections" feature (Dynamic Media asset collections /
 * download cart) — naming here is always "smart collection(s)".
 */

/**
 * @typedef {Object} SearchCriteria
 * @property {string} [query] - Free-text search term (URL param `query`).
 * @property {string} [sortType] - One of SORT_TYPE values from search-results/utils/sort-utils.js.
 * @property {'ascending'|'descending'} [sortDirection]
 * @property {Record<string, Record<string, boolean>>} [facetFilters] - Same shape as
 *   `facetCheckedState` produced by blocks/search-results/utils/config.js (saveSearchFiltersToUrl),
 *   serialized as the URL `facetFilters` param.
 */

/**
 * @typedef {Object} SmartCollection
 * @property {string} id
 * @property {string} user_id - Owner (Entra sub), same identity used by audit_events.user_id.
 * @property {string} user_email
 * @property {string} title
 * @property {string|null} [description]
 * @property {SearchCriteria} criteria
 * @property {'private'|'organization'} visibility
 * @property {string} created_at - ISO 8601 UTC
 * @property {string} updated_at - ISO 8601 UTC
 */

/**
 * @typedef {Object} CreateSmartCollectionDTO
 * @property {string} title
 * @property {string} [description]
 * @property {'private'|'organization'} [visibility]
 * @property {SearchCriteria} criteria
 */

/**
 * @typedef {Object} UpdateSmartCollectionDTO
 * @property {string} [title]
 * @property {string} [description]
 * @property {'private'|'organization'} [visibility]
 * @property {SearchCriteria} [criteria]
 */

export const SMART_COLLECTION_VISIBILITY = {
  PRIVATE: 'private',
  ORGANIZATION: 'organization',
};

export const SMART_COLLECTION_VISIBILITY_VALUES = Object.values(SMART_COLLECTION_VISIBILITY);

export const SMART_COLLECTION_TITLE_MAX_LENGTH = 200;
export const SMART_COLLECTION_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * @param {unknown} visibility
 * @returns {boolean}
 */
export function isValidVisibility(visibility) {
  return SMART_COLLECTION_VISIBILITY_VALUES.includes(visibility);
}

/**
 * @param {unknown} title
 * @returns {boolean}
 */
export function isValidTitle(title) {
  return typeof title === 'string' && title.trim().length > 0 && title.trim().length <= SMART_COLLECTION_TITLE_MAX_LENGTH;
}

/**
 * @param {unknown} criteria
 * @returns {boolean}
 */
export function isValidCriteria(criteria) {
  return !!criteria && typeof criteria === 'object' && !Array.isArray(criteria);
}

/**
 * Does this criteria object represent an actual active search (as opposed to the default,
 * empty state)? Used to gate the "Save as Smart Collection" button client-side.
 * @param {SearchCriteria} [criteria]
 * @returns {boolean}
 */
export function hasActiveCriteria(criteria) {
  if (!criteria) return false;
  const hasQuery = !!criteria.query && criteria.query.trim().length > 0;
  const hasFacets = !!criteria.facetFilters
    && Object.values(criteria.facetFilters).some(
      (group) => group && Object.values(group).some(Boolean),
    );
  const hasNonDefaultSort = !!criteria.sortType && criteria.sortType !== 'topResults';
  return hasQuery || hasFacets || hasNonDefaultSort;
}

export default {
  SMART_COLLECTION_VISIBILITY,
  SMART_COLLECTION_VISIBILITY_VALUES,
  SMART_COLLECTION_TITLE_MAX_LENGTH,
  SMART_COLLECTION_DESCRIPTION_MAX_LENGTH,
  isValidVisibility,
  isValidTitle,
  isValidCriteria,
  hasActiveCriteria,
};
