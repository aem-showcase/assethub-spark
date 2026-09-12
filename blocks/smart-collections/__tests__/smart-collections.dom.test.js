import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const { listSmartCollectionsMock, searchAssetsMock } = vi.hoisted(() => ({
  listSmartCollectionsMock: vi.fn(),
  searchAssetsMock: vi.fn(),
}));

vi.mock('../../../scripts/smart-collections/smart-collections-api-client.js', () => ({
  listSmartCollections: listSmartCollectionsMock,
}));

vi.mock('../../search-results/clients/dynamicmedia-client.js', () => ({
  getContentAIClient: () => ({ searchAssets: searchAssetsMock }),
}));

vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (key, fallback) => fallback || key,
  localizePath: (path) => `/en${path}`,
}));

const { default: decorate } = await import('../smart-collections.js');

function createCollection(overrides = {}) {
  return {
    id: 'collection-1',
    title: 'Summer Campaign',
    description: 'Approved summer campaign assets',
    visibility: 'private',
    criteria: {
      query: 'summer',
      sortType: 'dateCreated',
      sortDirection: 'ascending',
      facetFilters: {
        'assetMetadata.xcm:keywords': { Beach: true, Winter: false },
        'repositoryMetadata.dc:format': { 'image/jpeg': true },
      },
    },
    ...overrides,
  };
}

function createSearchResponse(assetId, name, title) {
  return {
    hits: {
      results: [{
        assetId,
        repositoryMetadata: {
          'repo:name': name,
          'dc:format': 'image/jpeg',
        },
        assetMetadata: { 'dc:title': title },
      }],
    },
    search_metadata: { totalCount: { total: 1 } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.textContent = '';
});

describe('smart-collections block', () => {
  it('renders personal and public collections with their first matching assets', async () => {
    listSmartCollectionsMock.mockResolvedValue([
      createCollection(),
      createCollection({
        id: 'collection-2',
        title: 'Brand Essentials',
        description: null,
        visibility: 'organization',
        criteria: {
          query: '',
          sortType: 'topResults',
          sortDirection: 'descending',
          facetFilters: {},
        },
      }),
    ]);
    searchAssetsMock
      .mockResolvedValueOnce(createSearchResponse('asset-1', 'summer.jpg', 'Summer hero'))
      .mockResolvedValueOnce(createSearchResponse('asset-2', 'brand.jpg', 'Brand guide'));

    const block = document.createElement('div');
    await decorate(block);

    const cards = block.querySelectorAll('.smart-collections-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Personal');
    expect(cards[1].textContent).toContain('Public');
    expect(cards[0].querySelector('img').alt).toBe('Summer hero');
    expect(cards[1].querySelector('img').src).toContain('/api/adobe/assets/asset-2/');

    expect(searchAssetsMock).toHaveBeenNthCalledWith(1, 'summer', {
      facetFilters: [
        [{ key: 'assetMetadata.xcm:keywords', value: 'Beach' }],
        [{ key: 'repositoryMetadata.dc:format', value: 'image/jpeg' }],
      ],
      numericFilters: [],
      filters: [],
      hitsPerPage: 1,
      orderBy: 'repositoryMetadata.repo:createDate asc',
      skipFacetsRequest: true,
    });
    expect(searchAssetsMock).toHaveBeenNthCalledWith(2, '', expect.objectContaining({
      hitsPerPage: 1,
      orderBy: null,
      skipFacetsRequest: true,
    }));
  });

  it('links cards to a localized search that restores all persisted criteria', async () => {
    listSmartCollectionsMock.mockResolvedValue([createCollection()]);
    searchAssetsMock.mockResolvedValue(createSearchResponse('asset-1', 'summer.jpg', 'Summer'));

    const block = document.createElement('div');
    await decorate(block);

    const link = block.querySelector('.smart-collections-card-link');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/en/search');
    expect(url.searchParams.get('query')).toBe('summer');
    expect(url.searchParams.get('sortType')).toBe('dateCreated');
    expect(url.searchParams.get('sortDirection')).toBe('ascending');
    expect(JSON.parse(decodeURIComponent(url.searchParams.get('facetFilters')))).toEqual(
      createCollection().criteria.facetFilters,
    );
    expect(link.getAttribute('aria-label')).toBe('View Smart Collection: Summer Campaign');
  });

  it('renders the empty state without requesting thumbnails', async () => {
    listSmartCollectionsMock.mockResolvedValue([]);

    const block = document.createElement('div');
    await decorate(block);

    expect(block.querySelector('[role="status"]').textContent)
      .toContain('No Smart Collections available.');
    expect(searchAssetsMock).not.toHaveBeenCalled();
    expect(block.hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps cards visible with placeholders when thumbnail searches fail or return no hits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listSmartCollectionsMock.mockResolvedValue([
      createCollection(),
      createCollection({
        id: 'collection-2',
        title: 'No Matches',
        criteria: { query: 'missing' },
      }),
    ]);
    searchAssetsMock
      .mockRejectedValueOnce(new Error('Thumbnail failed'))
      .mockResolvedValueOnce({ hits: { results: [] } });

    const block = document.createElement('div');
    await decorate(block);

    expect(block.querySelectorAll('.smart-collections-card')).toHaveLength(2);
    expect(block.querySelectorAll('.smart-collections-card-placeholder')).toHaveLength(2);
    warn.mockRestore();
  });

  it('renders an alert when the collection list cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    listSmartCollectionsMock.mockRejectedValue(new Error('List failed'));

    const block = document.createElement('div');
    await decorate(block);

    expect(block.querySelector('[role="alert"]').textContent)
      .toContain('Unable to load Smart Collections.');
    expect(block.hasAttribute('aria-busy')).toBe(false);
    error.mockRestore();
  });
});
