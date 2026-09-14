/* eslint-disable import/no-cycle, no-use-before-define */
/**
 * Cross-component state + query capture/replay for the "Smart Collections" feature.
 *
 * Two responsibilities:
 * 1. A tiny standalone pub/sub tracking which saved Smart Collection (if any) is currently
 *    applied to the search results, so the facets panel and the mutation-detection banner stay
 *    in sync without a tight coupling between those component files.
 * 2. Translating between the live search-results.js state and the persisted
 *    `smartCollectionQuery` (the ContentAI "search assets" query payload):
 *      - {@link buildSmartCollectionQueryFromCurrentState} captures the current search as a
 *        `smartCollectionQuery` (identical `query` array to what search-results.js sends).
 *      - {@link parseSmartCollectionQuery} reverses that payload back into search-results.js
 *        state so applying a Smart Collection restores the query text + facet selections.
 */

import { getState, setState } from '../../blocks/search-results/search-results.js';
import { getContentAIClient } from '../../blocks/search-results/clients/dynamicmedia-client.js';
import { getOrderBy } from '../../blocks/search-results/components/search-panel.js';
import { getFacetsConfig } from '../../blocks/search-results/constants/facets.js';
import { parseSmartCollectionQuery } from './smart-collection-query.js';

/** @type {import('./smart-collection-types.js').SmartCollection | null} */
let activeSmartCollection = null;

/** Snapshot of the `smartCollectionQuery` as of the moment the collection was applied/saved. */
let savedQuerySnapshot = null;

const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(activeSmartCollection));
}

/**
 * @param {(active: import('./smart-collection-types.js').SmartCollection | null) => void} listener
 * @returns {() => void} unsubscribe function
 */
export function subscribeToActiveSmartCollection(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * @returns {import('./smart-collection-types.js').SmartCollection | null}
 */
export function getActiveSmartCollection() {
  return activeSmartCollection;
}

/**
 * Convert `facetCheckedState` into the grouped `[[{key,value}]]` shape ContentAI expects
 * (mirrors the derivation in search-results.js).
 * @param {Record<string, Record<string, boolean>>} facetCheckedState
 * @returns {Array<Array<{key: string, value: string}>>}
 */
function toFacetFilters(facetCheckedState = {}) {
  const selectedFacetFilters = [];
  Object.keys(facetCheckedState).forEach((key) => {
    const facetFilter = [];
    Object.entries(facetCheckedState[key] || {}).forEach(([value, isChecked]) => {
      if (isChecked) facetFilter.push({ key, value });
    });
    if (facetFilter.length > 0) selectedFacetFilters.push(facetFilter);
  });
  return selectedFacetFilters;
}

/**
 * Build the persisted `smartCollectionQuery` from the current search-results.js state. The
 * `query` array is identical to what search-results.js sends to ContentAI; `sort` is persisted
 * empty (matching the native API contract) — sort is not part of the saved criteria.
 * @returns {import('./smart-collection-types.js').SmartCollectionQuery}
 */
export function buildSmartCollectionQueryFromCurrentState() {
  const state = getState();
  const request = getContentAIClient().buildQueryRequest(state.query?.trim() || '', {
    facetFilters: toFacetFilters(state.facetCheckedState),
    numericFilters: state.selectedNumericFilters || [],
    filters: state.presetFilters || [],
    orderBy: getOrderBy(),
    searchMode: state.searchMode,
  });
  return { query: request.query, sort: [] };
}

/**
 * Build a full draft (human-facing summary + native query) from the current search state, for
 * the save modal preview and the save button gate.
 * @returns {import('./smart-collection-types.js').SmartCollectionDraft}
 */
export function buildDraftFromCurrentState() {
  const state = getState();
  return {
    query: state.query || '',
    sortType: state.selectedSortType,
    sortDirection: state.selectedSortDirection,
    facetFilters: state.facetCheckedState || {},
    smartCollectionQuery: buildSmartCollectionQueryFromCurrentState(),
  };
}

/**
 * Apply a Smart Collection's saved query to the current search state. Reuses the same
 * setState() path URL-param loading uses, so URL sync + auto-search happen automatically via
 * the subscribe() handlers already in search-results.js.
 * @param {import('./smart-collection-types.js').SmartCollection} collection
 */
export function applySmartCollectionToSearch(collection) {
  const parsed = parseSmartCollectionQuery(collection.smartCollectionQuery);
  const validFacetKeys = new Set(Object.keys(getFacetsConfig()));
  const facetCheckedState = {};
  Object.entries(parsed.facetCheckedState).forEach(([key, values]) => {
    if (validFacetKeys.size === 0 || validFacetKeys.has(key)) facetCheckedState[key] = values;
  });

  setState({
    query: parsed.query,
    facetCheckedState,
    selectedNumericFilters: parsed.selectedNumericFilters,
  });
  setActiveSmartCollection(collection);
}

/**
 * Mark a Smart Collection as active (just applied or just saved), snapshotting its query as
 * the "clean" baseline for mutation detection.
 * @param {import('./smart-collection-types.js').SmartCollection | null} collection
 */
export function setActiveSmartCollection(collection) {
  activeSmartCollection = collection;
  savedQuerySnapshot = collection
    ? JSON.stringify(collection.smartCollectionQuery || {})
    : null;
  notify();
}

/**
 * Re-baseline the snapshot without changing which collection is active (e.g. after a
 * successful "Save Changes").
 * @param {import('./smart-collection-types.js').SmartCollectionQuery} smartCollectionQuery
 */
export function reconcileActiveSmartCollectionQuery(smartCollectionQuery) {
  if (!activeSmartCollection) return;
  activeSmartCollection = { ...activeSmartCollection, smartCollectionQuery };
  savedQuerySnapshot = JSON.stringify(smartCollectionQuery || {});
  notify();
}

/**
 * Whether the current search state has drifted from the active Smart Collection's saved query.
 * False when there is no active collection.
 * @returns {boolean}
 */
export function hasActiveSmartCollectionDiverged() {
  if (!activeSmartCollection || savedQuerySnapshot === null) return false;
  return JSON.stringify(buildSmartCollectionQueryFromCurrentState()) !== savedQuerySnapshot;
}
