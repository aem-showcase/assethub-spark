import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  searchCollections: vi.fn(),
  getCollectionItems: vi.fn(),
  searchAssets: vi.fn(),
}));

vi.mock('../../search-results/clients/dynamicmedia-client.js', () => ({
  getContentAIClient: vi.fn(() => ({ searchAssets: mocks.searchAssets })),
}));

vi.mock('../../../scripts/collections/collections-api-client.js', () => ({
  DynamicMediaCollectionsClient: vi.fn(() => ({
    searchCollections: mocks.searchCollections,
    getCollectionItems: mocks.getCollectionItems,
  })),
}));

vi.mock('../../../scripts/collections/collection-modals.js', () => {
  const modal = () => ({ overlay: document.createElement('div'), show: vi.fn() });
  return {
    createEditModal: vi.fn(modal),
    createDeleteModal: vi.fn(modal),
    createShareModal: vi.fn(modal),
    scopeToAccessLevel: vi.fn((value) => value),
  };
});

vi.mock('../../../scripts/toast/toast.js', () => ({ default: vi.fn() }));
vi.mock('../../../scripts/speculation.js', () => ({ prerenderOnIntent: vi.fn() }));
vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: vi.fn(async () => (_key, fallback) => fallback),
  localizePath: vi.fn((path) => `/en${path}`),
}));
vi.mock('../../../scripts/scripts.js', () => ({
  SEARCH_URL_PARAMS: {
    QUERY: 'query',
    FULLTEXT: 'fulltext',
    SEARCH_MODE: 'searchMode',
    SMART_COLLECTION_ID: 'smartCollectionId',
  },
}));

// Vitest hoists the mocks above this import.
// eslint-disable-next-line import/first
import decorate, { buildCollectionPath } from '../search-collection-results.js';

const regularCollection = {
  id: 'regular-id',
  collectionMetadata: { title: 'Regular Collection' },
};
const smartCollection = {
  id: 'urn:cid:aem:smart-id',
  repositoryMetadata: { 'repo:createdBy': 'tphan@adobe.com' },
  collectionMetadata: {
    title: 'Private tea',
    collectionType: 'DELIVERY_SMART_COLLECTION',
    accessLevel: 'private',
    smartCollectionQuery: {
      query: [
        { match: { text: 'tea', mode: 'HYBRID' } },
        { term: { 'assetMetadata.dam:assetStatus': ['approved'] } },
      ],
    },
  },
};

describe('search-collection-results native Smart Collections', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/en/search-collections');
    window.user = { email: 'tphan@adobe.com' };
    localStorage.clear();
    mocks.searchCollections.mockReset().mockResolvedValue({
      items: [regularCollection, smartCollection],
      total: 2,
      cursor: undefined,
    });
    mocks.getCollectionItems.mockReset().mockResolvedValue({ items: [] });
    mocks.searchAssets.mockReset().mockResolvedValue({ hits: { results: [] } });
  });

  it('places the Smart Collections option after Shared with me with the requested icon and subtitle', async () => {
    const block = document.createElement('div');
    document.body.append(block);
    await decorate(block);

    const optionKeys = [...block.querySelectorAll('.scr-picker-menu:first-of-type [data-key]')]
      .map((option) => option.dataset.key);
    expect(optionKeys.indexOf('smartCollections')).toBe(optionKeys.indexOf('sharedWithMe') + 1);

    const option = block.querySelector('[data-key="smartCollections"]');
    expect(option.textContent).toContain('Smart Collections');
    expect(option.textContent).toContain('Auto-updating based on filters');
    expect(option.querySelector('[data-collection-variant="smart"]')).not.toBeNull();
  });

  it('maps the Smart filter through the enabled creator picker', async () => {
    const block = document.createElement('div');
    document.body.append(block);
    await decorate(block);

    block.querySelector('[data-key="smartCollections"]').click();
    await vi.waitFor(() => {
      expect(mocks.searchCollections).toHaveBeenLastCalledWith(expect.objectContaining({
        relationship: 'all',
        collectionKind: 'smart',
      }));
    });

    const creatorPicker = block.querySelectorAll('.scr-picker-btn')[1];
    expect(creatorPicker.disabled).toBe(false);
    block.querySelector('[data-key="me"]').click();
    await vi.waitFor(() => {
      expect(mocks.searchCollections).toHaveBeenLastCalledWith(expect.objectContaining({
        relationship: 'createdByMe',
        visibility: 'all',
        collectionKind: 'smart',
      }));
    });
  });

  it('builds collection-details links for regular and Smart Collections', () => {
    expect(buildCollectionPath({ id: 'regular-id' }))
      .toBe('/en/collection-details?id=regular-id');
    expect(buildCollectionPath({
      id: 'urn:cid:aem:smart-id',
      collectionType: 'DELIVERY_SMART_COLLECTION',
      smartCollectionQuery: smartCollection.collectionMetadata.smartCollectionQuery,
    })).toBe('/en/collection-details?id=urn%3Acid%3Aaem%3Asmart-id');
  });

  it('uses the first saved-query asset instead of static items for a Smart Collection thumbnail', async () => {
    mocks.searchAssets.mockResolvedValue({
      hits: { results: [{ assetId: 'urn:aaid:aem:preview' }] },
    });
    const block = document.createElement('div');
    document.body.append(block);
    await decorate(block);

    await vi.waitFor(() => expect(mocks.getCollectionItems).toHaveBeenCalledTimes(1));
    expect(mocks.getCollectionItems).toHaveBeenCalledWith('regular-id', { limit: 1 });
    expect(mocks.searchAssets).toHaveBeenCalledWith('', {
      nativeQuery: smartCollection.collectionMetadata.smartCollectionQuery.query,
      hitsPerPage: 1,
      orderBy: null,
      skipFacetsRequest: true,
    });
    await vi.waitFor(() => {
      const preview = block.querySelector('[data-collection-id="urn:cid:aem:smart-id"] img');
      expect(preview?.getAttribute('src'))
        .toBe('/api/adobe/assets/urn:aaid:aem:preview/as/thumbnail.jpg?width=400');
    });
  });
});
