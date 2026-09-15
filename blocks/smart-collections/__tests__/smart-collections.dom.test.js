import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const { listSmartCollectionsMock, searchAssetsMock, fetchAssetByIdMock } = vi.hoisted(() => ({
  listSmartCollectionsMock: vi.fn(),
  searchAssetsMock: vi.fn(),
  fetchAssetByIdMock: vi.fn(),
}));

vi.mock('../../../scripts/smart-collections/smart-collections-api-client.js', () => ({
  listSmartCollections: listSmartCollectionsMock,
}));

vi.mock('../../search-results/clients/dynamicmedia-client.js', () => ({
  getContentAIClient: () => ({ searchAssets: searchAssetsMock }),
}));

vi.mock('../../../scripts/asset-transformers.js', async () => {
  const actual = await vi.importActual('../../../scripts/asset-transformers.js');
  return { ...actual, fetchAssetById: fetchAssetByIdMock };
});

vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (key, fallback) => fallback || key,
  localizePath: (path) => `/en${path}`,
}));

const { populateAssetFromContentAIHit } = await import('../../../scripts/asset-transformers.js');
const { default: decorate } = await import('../smart-collections.js');

/**
 * Build a persisted smartCollectionQuery (ContentAI "search assets" payload shape).
 */
function buildQuery({ text = '', keyword, format } = {}) {
  const filters = [];
  if (keyword) filters.push({ term: { 'assetMetadata.xcm:keywords': [keyword] } });
  if (format) filters.push({ term: { 'repositoryMetadata.dc:format': [format] } });
  const query = [{ match: { mode: 'HYBRID', text } }];
  if (filters.length) query.push({ and: filters });
  return { query, sort: [] };
}

function createCollection(overrides = {}) {
  return {
    id: 'collection-1',
    title: 'Summer Campaign',
    description: 'Approved summer campaign assets',
    accessLevel: 'private',
    thumbnail: null,
    smartCollectionQuery: buildQuery({ text: 'summer', keyword: 'Beach', format: 'image/jpeg' }),
    ...overrides,
  };
}

function createHit(assetId, name, title) {
  return {
    assetId,
    repositoryMetadata: {
      'repo:name': name,
      'dc:format': 'image/jpeg',
    },
    assetMetadata: { 'dc:title': title },
  };
}

function createSearchResponse(assetId, name, title) {
  return {
    hits: { results: [createHit(assetId, name, title)] },
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
        accessLevel: 'public',
        smartCollectionQuery: buildQuery({ text: '' }),
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
        [{ key: 'xcm:keywords', value: 'Beach' }],
        [{ key: 'dc:format', value: 'image/jpeg' }],
      ],
      numericFilters: [],
      filters: [],
      hitsPerPage: 1,
      orderBy: null,
      skipFacetsRequest: true,
    });
    expect(searchAssetsMock).toHaveBeenNthCalledWith(2, '', expect.objectContaining({
      hitsPerPage: 1,
      orderBy: null,
      skipFacetsRequest: true,
    }));
    expect(fetchAssetByIdMock).not.toHaveBeenCalled();
  });

  it('uses the stored hero thumbnail without running a search when present', async () => {
    listSmartCollectionsMock.mockResolvedValue([
      createCollection({ thumbnail: 'urn:aaid:aem:hero-1' }),
    ]);
    fetchAssetByIdMock.mockResolvedValue(
      populateAssetFromContentAIHit(createHit('hero-asset', 'hero.jpg', 'Hero image')),
    );

    const block = document.createElement('div');
    await decorate(block);

    expect(fetchAssetByIdMock).toHaveBeenCalledWith('urn:aaid:aem:hero-1');
    expect(searchAssetsMock).not.toHaveBeenCalled();
    expect(block.querySelector('img').alt).toBe('Hero image');
  });

  it('links cards to a localized search that restores the saved query and facets', async () => {
    listSmartCollectionsMock.mockResolvedValue([createCollection()]);
    searchAssetsMock.mockResolvedValue(createSearchResponse('asset-1', 'summer.jpg', 'Summer'));

    const block = document.createElement('div');
    await decorate(block);

    const link = block.querySelector('.smart-collections-card-link');
    const url = new URL(link.href);
    expect(url.pathname).toBe('/en/search');
    expect(url.searchParams.get('query')).toBe('summer');
    expect(JSON.parse(decodeURIComponent(url.searchParams.get('facetFilters')))).toEqual({
      'xcm:keywords': { Beach: true },
      'dc:format': { 'image/jpeg': true },
    });
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

  it('keeps cards visible with placeholders when thumbnails fail or return no hits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listSmartCollectionsMock.mockResolvedValue([
      createCollection(),
      createCollection({
        id: 'collection-2',
        title: 'No Matches',
        smartCollectionQuery: buildQuery({ text: 'missing' }),
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
