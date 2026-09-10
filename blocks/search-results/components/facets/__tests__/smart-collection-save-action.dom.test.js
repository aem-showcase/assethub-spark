import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const { refreshSmartCollectionsMock } = vi.hoisted(() => ({
  refreshSmartCollectionsMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../search-results.js', () => ({
  getState: () => ({
    excFacets: {},
    searchResults: [{ facets: {} }],
    facetCheckedState: {},
    expandedFacets: {},
    selectedNumericFilters: [],
    isTagsLoading: false,
  }),
  setState: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../../../utils/placeholders.js', () => ({
  getSearchPlaceholders: async () => ({}),
  ph: (_placeholders, _key, fallback) => fallback,
}));

vi.mock('../../../constants/facets.js', () => ({
  getDateFacets: () => [],
}));

vi.mock('../../../clients/tags-client.js', () => ({
  lookupTitlePath: vi.fn(),
  getTagsLookupMap: () => new Map(),
  fetchMissingTag: vi.fn(),
  fetchTagsFromResponse: vi.fn(),
  searchTags: vi.fn(),
}));

vi.mock('../../../clients/dynamicmedia-client.js', () => ({
  getContentAIClient: () => ({}),
  getEffectiveFacetBucketSize: () => 100,
}));

vi.mock('../smart-collections-panel.js', () => ({
  renderSmartCollectionsList: () => '<div class="smart-collections-list">Collections</div>',
  refreshSmartCollections: refreshSmartCollectionsMock,
  bindSmartCollectionsListEvents: vi.fn(),
}));

vi.mock('../../../../../scripts/smart-collections/smart-collection-modal.js', () => ({
  openSaveSmartCollectionModal: vi.fn(),
}));

vi.mock('../../../../../scripts/smart-collections/smart-collection-state.js', () => ({
  buildCriteriaFromCurrentState: () => ({ query: 'summer' }),
}));

vi.mock('../../../../../scripts/smart-collections/smart-collection-types.js', () => ({
  hasActiveCriteria: () => true,
}));

const { createFacetsPanel } = await import('../index.js');

beforeEach(() => {
  document.body.textContent = '';
  vi.clearAllMocks();
});

describe('Save as Smart Collection placement', () => {
  it('renders below the Filters list and not on the Smart Collections tab', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    await createFacetsPanel(container, {});

    const filtersList = container.querySelector('.facet-filter-list');
    expect(filtersList.nextElementSibling.classList.contains('smart-collection-save-actions'))
      .toBe(true);
    expect(filtersList.nextElementSibling.querySelector('#save-smart-collection-btn')).toBeTruthy();

    container.querySelector('#smart-collections-tab').click();

    expect(container.querySelector('.smart-collections-list')).toBeTruthy();
    expect(container.querySelector('#save-smart-collection-btn')).toBeNull();

    container.querySelector('#filters-tab').click();

    const restoredFiltersList = container.querySelector('.facet-filter-list');
    expect(restoredFiltersList.nextElementSibling.classList.contains('smart-collection-save-actions'))
      .toBe(true);
  });
});
