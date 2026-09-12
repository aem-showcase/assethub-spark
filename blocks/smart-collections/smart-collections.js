import { listSmartCollections } from '../../scripts/smart-collections/smart-collections-api-client.js';
import { parseContentAIResponse, populateAssetFromContentAIHit } from '../../scripts/asset-transformers.js';
import { getAppLabel, localizePath } from '../../scripts/locale-utils.js';
import { getContentAIClient } from '../search-results/clients/dynamicmedia-client.js';
import { createPicture } from '../search-results/components/picture.js';
import {
  buildOrderBy,
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_TYPE,
  SORT_TYPE,
} from '../search-results/utils/sort-utils.js';

const THUMBNAIL_CONCURRENCY = 4;

/**
 * @typedef {import('../../scripts/smart-collections/smart-collection-types.js').SmartCollection}
 * SmartCollection
 */

/**
 * Convert persisted facet state into the grouped filter shape expected by ContentAI.
 * @param {Record<string, Record<string, boolean>>} facetState
 * @returns {Array<Array<{key: string, value: string}>>}
 */
export function buildFacetFilters(facetState = {}) {
  return Object.entries(facetState).reduce((filters, [key, values]) => {
    const selectedValues = Object.entries(values || {})
      .filter(([, selected]) => selected)
      .map(([value]) => ({ key, value }));

    if (selectedValues.length > 0) filters.push(selectedValues);
    return filters;
  }, []);
}

/**
 * Build a deep link that restores the collection criteria on the search page.
 * @param {SmartCollection} collection
 * @returns {string}
 */
export function buildCollectionUrl(collection) {
  const criteria = collection.criteria || {};
  const params = new URLSearchParams();
  const facetFilters = criteria.facetFilters || {};

  if (criteria.query) params.set('query', criteria.query);
  if (Object.keys(facetFilters).length > 0) {
    params.set('facetFilters', encodeURIComponent(JSON.stringify(facetFilters)));
  }
  params.set('sortType', criteria.sortType || DEFAULT_SORT_TYPE);
  params.set('sortDirection', criteria.sortDirection || DEFAULT_SORT_DIRECTION);

  return `${localizePath('/search')}?${params.toString()}`;
}

/**
 * Run an async mapper with a fixed concurrency limit while preserving input order.
 * @param {Array} items
 * @param {number} concurrency
 * @param {Function} mapper
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      // Workers intentionally process one item at a time to enforce the request limit.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Fetch the first matching asset for a Smart Collection.
 * @param {SmartCollection} collection
 * @returns {Promise<Object|null>}
 */
async function fetchFirstAsset(collection) {
  const criteria = collection.criteria || {};
  const sortType = criteria.sortType || DEFAULT_SORT_TYPE;
  const sortDirection = criteria.sortDirection || DEFAULT_SORT_DIRECTION;
  const orderBy = sortType === SORT_TYPE.TOP_RESULTS
    ? null
    : buildOrderBy(sortType, sortDirection);

  const rawResponse = await getContentAIClient().searchAssets(criteria.query || '', {
    facetFilters: buildFacetFilters(criteria.facetFilters),
    numericFilters: [],
    filters: [],
    hitsPerPage: 1,
    orderBy,
    skipFacetsRequest: true,
  });
  const { hits } = parseContentAIResponse(rawResponse);

  return hits.length > 0 ? populateAssetFromContentAIHit(hits[0]) : null;
}

function createStatus(className, message, role = 'status') {
  const status = document.createElement('div');
  status.className = `smart-collections-status ${className}`;
  status.setAttribute('role', role);

  const icon = document.createElement('span');
  icon.className = 'smart-collections-status-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✦';

  const text = document.createElement('p');
  text.textContent = message;
  status.append(icon, text);
  return status;
}

function createPlaceholder(label) {
  const placeholder = document.createElement('div');
  placeholder.className = 'smart-collections-card-placeholder';
  placeholder.setAttribute('aria-label', label);

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✦';
  placeholder.append(icon);
  return placeholder;
}

function createCard(collection, asset, t) {
  const item = document.createElement('li');
  item.className = 'smart-collections-card';
  item.dataset.smartCollectionId = collection.id;

  const link = document.createElement('a');
  link.className = 'smart-collections-card-link';
  link.href = buildCollectionUrl(collection);
  link.setAttribute(
    'aria-label',
    t('viewSmartCollection', 'View Smart Collection: {0}').replace('{0}', collection.title),
  );

  const media = document.createElement('div');
  media.className = 'smart-collections-card-media';
  if (asset) {
    const picture = createPicture({
      asset,
      width: 600,
      className: 'smart-collections-card-image',
      sizes: '(max-width: 599px) 100vw, (max-width: 1199px) 50vw, 25vw',
    });
    picture.querySelector('img').addEventListener('error', () => {
      media.replaceChildren(createPlaceholder(t('noPreviewAvailable', 'No preview available')));
    }, { once: true });
    media.append(picture);
  } else {
    media.append(createPlaceholder(t('noPreviewAvailable', 'No preview available')));
  }

  const body = document.createElement('div');
  body.className = 'smart-collections-card-body';

  const visibility = document.createElement('span');
  visibility.className = `smart-collections-card-visibility ${collection.visibility}`;
  visibility.textContent = collection.visibility === 'organization'
    ? t('publicSmartCollection', 'Public')
    : t('personalSmartCollection', 'Personal');

  const title = document.createElement('h3');
  title.textContent = collection.title;
  body.append(visibility, title);

  if (collection.description) {
    const description = document.createElement('p');
    description.textContent = collection.description;
    body.append(description);
  }

  link.append(media, body);
  item.append(link);
  return item;
}

/**
 * Decorate the Smart Collections block.
 * @param {HTMLElement} block
 */
export default async function decorate(block) {
  const t = await getAppLabel();
  block.textContent = '';
  block.setAttribute('aria-busy', 'true');
  block.append(createStatus(
    'smart-collections-loading',
    t('loadingSmartCollections', 'Loading Smart Collections...'),
  ));

  try {
    const collections = await listSmartCollections();
    if (!collections.length) {
      block.replaceChildren(createStatus(
        'smart-collections-empty',
        t('noSmartCollections', 'No Smart Collections available.'),
      ));
      return;
    }

    const thumbnailCache = new Map();
    const cards = await mapWithConcurrency(
      collections,
      THUMBNAIL_CONCURRENCY,
      async (collection) => {
        const cacheKey = JSON.stringify(collection.criteria || {});
        if (!thumbnailCache.has(cacheKey)) {
          thumbnailCache.set(cacheKey, fetchFirstAsset(collection).catch((error) => {
            // A failed thumbnail must not prevent the collection itself from rendering.
            // eslint-disable-next-line no-console
            console.warn(`Failed to load thumbnail for Smart Collection ${collection.id}:`, error);
            return null;
          }));
        }
        const asset = await thumbnailCache.get(cacheKey);
        return createCard(collection, asset, t);
      },
    );

    const grid = document.createElement('ul');
    grid.className = 'smart-collections-grid';
    grid.append(...cards);
    block.replaceChildren(grid);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load Smart Collections:', error);
    block.replaceChildren(createStatus(
      'smart-collections-error',
      t('failedToLoadSmartCollections', 'Unable to load Smart Collections.'),
      'alert',
    ));
  } finally {
    block.removeAttribute('aria-busy');
  }
}
