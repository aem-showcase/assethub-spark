/**
 * @vitest-environment jsdom
 */

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const mockSearchAssetsInCollection = vi.fn();
const mockCreateAssetsArchive = vi.fn();
const mockShowToast = vi.fn();
const mockSaveArchiveAndOpenDownloadPanel = vi.fn();
const mockPopulateAssetFromContentAIHit = vi.fn((hit) => ({
  assetId: hit.assetId,
  name: hit.assetMetadata?.['dc:title'] || hit.repositoryMetadata?.['repo:name'] || 'Untitled Asset',
  title: hit.assetMetadata?.['dc:title'] || 'Untitled Asset',
  format: hit.repositoryMetadata?.['dc:format'] || '',
}));

vi.mock('../collections-api-client.js', () => ({
  DynamicMediaCollectionsClient: vi.fn(),
}));

vi.mock('../../toast/toast.js', () => ({
  default: mockShowToast,
}));

vi.mock('../../asset-transformers.js', () => ({
  populateAssetFromContentAIHit: mockPopulateAssetFromContentAIHit,
}));

vi.mock('../../../blocks/search-results/utils/config.js', () => ({
  getHitsPerPage: vi.fn(() => 24),
}));

vi.mock('../../../blocks/search-results/clients/dynamicmedia-client.js', () => ({
  getDynamicMediaClient: vi.fn(() => ({
    createAssetsArchive: mockCreateAssetsArchive,
  })),
}));

vi.mock('../../../blocks/search-results/utils/archive-download.js', () => ({
  saveArchiveAndOpenDownloadPanel: mockSaveArchiveAndOpenDownloadPanel,
}));

describe('collection-download', () => {
  let fetchCollectionAssetsForDownload;
  let downloadCollection;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ fetchCollectionAssetsForDownload, downloadCollection } = await import('../collection-download.js'));
  });

  it('pages existing collection asset search and transforms every hit', async () => {
    mockSearchAssetsInCollection
      .mockResolvedValueOnce({
        hits: {
          results: [
            { assetId: 'asset-1', assetMetadata: { 'dc:title': 'Asset 1' }, repositoryMetadata: {} },
          ],
        },
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        hits: {
          results: [
            { assetId: 'asset-2', assetMetadata: { 'dc:title': 'Asset 2' }, repositoryMetadata: {} },
          ],
        },
      });

    const client = { searchAssetsInCollection: mockSearchAssetsInCollection };
    const assets = await fetchCollectionAssetsForDownload({ client, collectionId: 'col-1' });

    expect(mockSearchAssetsInCollection).toHaveBeenNthCalledWith(1, '', {
      collectionId: 'col-1',
      hitsPerPage: 24,
      cursor: undefined,
    });
    expect(mockSearchAssetsInCollection).toHaveBeenNthCalledWith(2, '', {
      collectionId: 'col-1',
      hitsPerPage: 24,
      cursor: 'page-2',
    });
    expect(mockPopulateAssetFromContentAIHit).toHaveBeenCalledTimes(2);
    expect(assets).toEqual([
      expect.objectContaining({ assetId: 'asset-1', title: 'Asset 1' }),
      expect.objectContaining({ assetId: 'asset-2', title: 'Asset 2' }),
    ]);
  });

  it('shows an info toast when the collection has no downloadable assets', async () => {
    const client = {
      searchAssetsInCollection: vi.fn().mockResolvedValue({ hits: { results: [] } }),
    };
    const t = (key, fallback) => fallback;

    const started = await downloadCollection({
      client,
      collection: { id: 'empty-col', name: 'Empty' },
      t,
    });

    expect(started).toBe(false);
    expect(mockCreateAssetsArchive).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('This collection has no assets to download.', 'info');
  });

  it('creates an original-rendition archive and forwards it to the download panel flow', async () => {
    const client = {
      searchAssetsInCollection: vi.fn().mockResolvedValue({
        hits: {
          results: [
            {
              assetId: 'asset-1',
              assetMetadata: { 'dc:title': 'Asset 1' },
              repositoryMetadata: { 'dc:format': 'image/jpeg' },
            },
          ],
        },
      }),
    };
    mockCreateAssetsArchive.mockResolvedValue('archive-123');
    const loadingStates = [];
    const t = (key, fallback) => fallback;

    const started = await downloadCollection({
      client,
      collection: { id: 'col-1', name: 'Collection 1' },
      t,
      onLoadingChange: (loading) => loadingStates.push(loading),
    });

    expect(started).toBe(true);
    expect(mockCreateAssetsArchive).toHaveBeenCalledWith([
      {
        asset: expect.objectContaining({ assetId: 'asset-1', title: 'Asset 1' }),
        renditions: [{ name: 'original' }],
      },
    ]);
    expect(mockSaveArchiveAndOpenDownloadPanel).toHaveBeenCalledWith({
      assetsRenditions: [
        {
          asset: expect.objectContaining({ assetId: 'asset-1', title: 'Asset 1' }),
          renditions: [{ name: 'original' }],
        },
      ],
      archiveId: 'archive-123',
      t,
      successMessage: 'Collection download started successfully',
    });
    expect(loadingStates).toEqual([true, false]);
  });
});
