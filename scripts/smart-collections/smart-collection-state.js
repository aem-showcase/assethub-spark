/* eslint-disable import/no-cycle */
/**
 * Cross-component state for the "Smart Collections" feature: tracks which saved collection
 * (if any) is currently applied to the search results, so the facets panel (apply/rename/
 * delete UI) and the mutation-detection banner (rendered separately in main-app.js) can stay
 * in sync without a tight coupling between those two component files.
 *
 * This is intentionally a tiny standalone pub/sub, not routed through search-results.js'
 * setState/subscribe, because "active smart collection" is UI/session state, not search
 * result state.
 */

import { getState } from '../../blocks/search-results/search-results.js';

/** @type {import('./smart-collection-types.js').SmartCollection | null} */
let activeSmartCollection = null;

/** Snapshot of the criteria as of the moment the collection was applied/saved. */
let savedCriteriaSnapshot = null;

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
 * Mark a smart collection as active (just applied or just saved), snapshotting the current
 * criteria as the "clean" baseline for mutation detection.
 * @param {import('./smart-collection-types.js').SmartCollection | null} collection
 */
export function setActiveSmartCollection(collection) {
  activeSmartCollection = collection;
  savedCriteriaSnapshot = collection ? JSON.stringify(collection.criteria || {}) : null;
  notify();
}

/**
 * Re-baseline the snapshot without changing which collection is active (e.g. after a
 * successful "Save Changes").
 * @param {import('./smart-collection-types.js').SearchCriteria} criteria
 */
export function reconcileActiveSmartCollectionCriteria(criteria) {
  if (!activeSmartCollection) return;
  activeSmartCollection = { ...activeSmartCollection, criteria };
  savedCriteriaSnapshot = JSON.stringify(criteria || {});
  notify();
}

/**
 * Build a SearchCriteria object from the current search-results.js state.
 * @returns {import('./smart-collection-types.js').SearchCriteria}
 */
export function buildCriteriaFromCurrentState() {
  const state = getState();
  return {
    query: state.query || '',
    sortType: state.selectedSortType,
    sortDirection: state.selectedSortDirection,
    facetFilters: state.facetCheckedState || {},
  };
}

/**
 * Whether the current search state has drifted from the active smart collection's saved
 * criteria. False when there is no active collection.
 * @returns {boolean}
 */
export function hasActiveSmartCollectionDiverged() {
  if (!activeSmartCollection || savedCriteriaSnapshot === null) return false;
  return JSON.stringify(buildCriteriaFromCurrentState()) !== savedCriteriaSnapshot;
}
