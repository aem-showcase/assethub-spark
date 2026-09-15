/**
 * Shared types & constants for the "Smart Collections" feature (persisted dynamic search
 * queries). Ported verbatim from scripts/smart-collections/smart-collection-types.js —
 * pure validation logic, no runtime-specific APIs. Imported by the ported
 * api/smart-collections.js.
 *
 * Distinct from the unrelated "Collections" feature (Dynamic Media asset collections /
 * download cart) — naming here is always "smart collection(s)".
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
