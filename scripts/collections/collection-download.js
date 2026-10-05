/* eslint-disable no-await-in-loop */
import { populateAssetFromContentAIHit } from '../asset-transformers.js';
import showToast from '../toast/toast.js';
import { getHitsPerPage } from '../../blocks/search-results/utils/config.js';
import {
  getContentAIClient,
  getDynamicMediaClient,
} from '../../blocks/search-results/clients/dynamicmedia-client.js';
import { saveArchiveAndOpenDownloadPanel } from '../../blocks/search-results/utils/archive-download.js';
import { getNativeSmartCollectionQuery, isDeliverySmartCollection } from './smart-collection-query.js';

const pendingCollectionDownloads = new Set();

/**
 * Fetch all accessible collection assets by paging its items or native Smart Collection query.
 *
 * @param {object} options
 * @param {import('./collections-api-client.js').DynamicMediaCollectionsClient} options.client
 * @param {string} options.collectionId
 * @param {number} [options.hitsPerPage]
 * @param {Array<object>} [options.nativeQuery] - Validated native Smart Collection query.
 * @returns {Promise<Array<object>>}
 */
export async function fetchCollectionAssetsForDownload({
  client,
  collectionId,
  hitsPerPage = getHitsPerPage(),
  nativeQuery = null,
}) {
  if (!client) throw new Error('fetchCollectionAssetsForDownload: client is required');
  if (!collectionId) throw new Error('fetchCollectionAssetsForDownload: collectionId is required');

  const assets = [];
  let cursor;

  do {
    const response = nativeQuery
      ? await getContentAIClient().searchAssets('', {
        nativeQuery,
        hitsPerPage,
        cursor,
        skipFacetsRequest: true,
      })
      : await client.searchAssetsInCollection('', {
        collectionId,
        hitsPerPage,
        cursor,
      });

    const hits = response?.hits?.results || [];
    hits.forEach((hit) => {
      assets.push(populateAssetFromContentAIHit(hit));
    });
    cursor = response?.cursor || null;
  } while (cursor);

  return assets;
}

/**
 * Create an original-rendition archive for a single collection and hand it off to the
 * existing download panel flow.
 *
 * @param {object} options
 * @param {import('./collections-api-client.js').DynamicMediaCollectionsClient} options.client
 * @param {{ id: string, name?: string }} options.collection
 * @param {(key: string, fallback: string) => string} options.t
 * @param {(loading: boolean) => void} [options.onLoadingChange]
 * @returns {Promise<boolean>}
 */
export async function downloadCollection({
  client,
  collection,
  t,
  onLoadingChange,
}) {
  const collectionId = collection?.id;
  if (!collectionId) throw new Error('downloadCollection: collection.id is required');
  if (pendingCollectionDownloads.has(collectionId)) return false;

  pendingCollectionDownloads.add(collectionId);
  onLoadingChange?.(true);

  try {
    const isSmartCollection = isDeliverySmartCollection(collection);
    const nativeQuery = isSmartCollection ? getNativeSmartCollectionQuery(collection) : null;
    if (isSmartCollection && !nativeQuery) {
      throw new Error('Smart Collection has no valid saved query');
    }
    const assets = await fetchCollectionAssetsForDownload({ client, collectionId, nativeQuery });
    if (assets.length === 0) {
      showToast(
        t('collectionHasNoAssetsToDownload', 'This collection has no assets to download.'),
        'info',
      );
      return false;
    }

    const dynamicMediaClient = getDynamicMediaClient();
    if (!dynamicMediaClient) {
      throw new Error('Dynamic Media client is not available');
    }

    const assetsRenditions = assets.map((asset) => ({
      asset,
      renditions: [{ name: 'original' }],
    }));
    const archiveId = await dynamicMediaClient.createAssetsArchive(assetsRenditions);

    if (!archiveId) {
      throw new Error('Archive creation returned no archive id');
    }

    saveArchiveAndOpenDownloadPanel({
      assetsRenditions,
      archiveId,
      t,
      successMessage: t('collectionDownloadStartedSuccessfully', 'Collection download started successfully'),
    });

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[collection-download] failed to start collection download', error);
    showToast(
      t('failedToPrepareCollectionDownload', 'Failed to prepare collection download. Please try again.'),
      'error',
    );
    return false;
  } finally {
    pendingCollectionDownloads.delete(collectionId);
    onLoadingChange?.(false);
  }
}

export default downloadCollection;
