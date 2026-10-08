import { CollectionType } from './collection-search-constants.js';

const MAX_QUERY_LENGTH = 32 * 1024;
const VALID_SEARCH_MODES = new Set(['FULLTEXT', 'HYBRID']);

function getCollectionMetadata(collection) {
  return collection?.collectionMetadata || collection || {};
}

/**
 * Return whether a collection is a native Dynamic Media Smart Collection.
 * @param {Object} collection
 * @returns {boolean}
 */
export function isDeliverySmartCollection(collection) {
  const metadata = getCollectionMetadata(collection);
  return metadata.collectionType === CollectionType.DELIVERY_SMART_COLLECTION;
}

/**
 * Validate and clone a native ContentAI query array.
 * @param {unknown} nativeQuery
 * @returns {Object[]|null}
 */
export function cloneNativeQuery(nativeQuery) {
  if (!Array.isArray(nativeQuery) || nativeQuery.length === 0) return null;
  if (!nativeQuery.every((node) => node && typeof node === 'object' && !Array.isArray(node))) {
    return null;
  }

  try {
    const serialized = JSON.stringify(nativeQuery);
    if (!serialized || serialized.length > MAX_QUERY_LENGTH) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

/**
 * Validate and clone the native ContentAI query array stored on a Smart Collection.
 * Only the query array is returned; saved top-level request controls are never forwarded.
 * @param {Object} collection
 * @returns {Object[]|null}
 */
export function getNativeSmartCollectionQuery(collection) {
  if (!isDeliverySmartCollection(collection)) return null;

  const metadata = getCollectionMetadata(collection);
  const saved = metadata.smartCollectionQuery;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  return cloneNativeQuery(saved.query);
}

function findFirstMatch(node) {
  if (Array.isArray(node)) {
    return node.map((child) => findFirstMatch(child)).find(Boolean) || null;
  }
  if (!node || typeof node !== 'object') return null;
  if (node.match && typeof node.match === 'object') return node.match;

  return ['and', 'or', 'not']
    .map((key) => findFirstMatch(node[key]))
    .find(Boolean) || null;
}

/**
 * Derive display-only Search state from a native query without rebuilding its AST.
 * @param {Object[]} nativeQuery
 * @returns {{ query: string, searchMode: 'FULLTEXT'|'HYBRID' }}
 */
export function getSmartCollectionDisplayState(nativeQuery) {
  const match = findFirstMatch(nativeQuery);
  const query = typeof match?.text === 'string' ? match.text : '';
  const requestedMode = typeof match?.mode === 'string' ? match.mode.toUpperCase() : '';
  return {
    query,
    searchMode: VALID_SEARCH_MODES.has(requestedMode) ? requestedMode : 'FULLTEXT',
  };
}

/**
 * Restore configured category facets from positive saved term clauses.
 * OR and NOT branches remain only in the native query, not checkbox selections.
 * @param {Object[]} nativeQuery
 * @param {Record<string, string>} facetFields - Facet keys mapped to ContentAI paths.
 * @returns {Record<string, Record<string, boolean>>}
 */
export function getSmartCollectionFacetState(nativeQuery, facetFields) {
  const keysByField = new Map(Object.entries(facetFields).map(([key, field]) => [field, key]));
  const facetCheckedState = {};
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || node.or || node.not) return;
    if (node.and) visit(node.and);
    Object.entries(node.term || {}).forEach(([field, values]) => {
      const key = keysByField.get(field);
      if (!key || !Array.isArray(values)) return;
      values.forEach((value) => {
        if (typeof value !== 'string' || !value) return;
        if (!facetCheckedState[key]) facetCheckedState[key] = {};
        facetCheckedState[key][value] = true;
      });
    });
  };
  visit(nativeQuery);
  return facetCheckedState;
}
