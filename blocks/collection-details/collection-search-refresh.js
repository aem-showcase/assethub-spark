/**
 * Refresh collection results when search criteria that affect the API request change.
 * @param {Object} options
 * @param {Function} options.subscribe - Search state subscription function.
 * @param {Function} options.search - Collection-scoped search function.
 * @returns {Function} Unsubscribe callback.
 */
export default function subscribeCollectionSearchRefresh({ subscribe, search }) {
  return subscribe((_currentState, previousState, updates) => {
    const filtersChanged = updates.facetCheckedState !== undefined
      || updates.selectedNumericFilters !== undefined;
    const sortChanged = (updates.selectedSortType !== undefined
        && updates.selectedSortType !== previousState.selectedSortType)
      || (updates.selectedSortDirection !== undefined
        && updates.selectedSortDirection !== previousState.selectedSortDirection);

    if (filtersChanged || sortChanged) {
      search();
    }
  });
}
