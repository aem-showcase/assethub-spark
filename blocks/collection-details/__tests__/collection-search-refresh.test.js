import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import subscribeCollectionSearchRefresh from '../collection-search-refresh.js';

describe('subscribeCollectionSearchRefresh', () => {
  function setup() {
    let listener;
    const subscribe = vi.fn((callback) => {
      listener = callback;
      return vi.fn();
    });
    const search = vi.fn();
    const unsubscribe = subscribeCollectionSearchRefresh({ subscribe, search });

    return {
      listener,
      search,
      subscribe,
      unsubscribe,
    };
  }

  it.each([
    ['facet selections', { facetCheckedState: { country: { usa: true } } }],
    ['numeric filters', { selectedNumericFilters: [{ key: 'size', min: 1 }] }],
  ])('refreshes results when %s change', (_label, updates) => {
    const { listener, search } = setup();

    listener({}, {}, updates);

    expect(search).toHaveBeenCalledOnce();
  });

  it.each([
    ['sort type', { selectedSortType: 'title' }, { selectedSortType: 'topResults' }],
    ['sort direction', { selectedSortDirection: 'ascending' }, { selectedSortDirection: 'descending' }],
  ])('refreshes results when %s changes', (_label, updates, previousState) => {
    const { listener, search } = setup();

    listener({}, previousState, updates);

    expect(search).toHaveBeenCalledOnce();
  });

  it('does not refresh when sort state is set to its existing value', () => {
    const { listener, search } = setup();

    listener({}, { selectedSortType: 'title' }, { selectedSortType: 'title' });

    expect(search).not.toHaveBeenCalled();
  });

  it('does not refresh for presentation-only state changes', () => {
    const { listener, search } = setup();

    listener({}, {}, { viewType: 'list', expandAllDetails: false });

    expect(search).not.toHaveBeenCalled();
  });

  it('returns the underlying unsubscribe callback', () => {
    const { subscribe, unsubscribe } = setup();

    expect(subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).toEqual(expect.any(Function));
  });
});
