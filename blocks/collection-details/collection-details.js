/**
 * Collection Details block
 * Renders assets in a collection using the full search-results UI (gallery + facets panel).
 * Regular collections use their items endpoint; native Smart Collections run their saved
 * asset query through the same gallery and facets.
 */

import showToast from '../../scripts/toast/toast.js';
import { DynamicMediaCollectionsClient } from '../../scripts/collections/collections-api-client.js';
// eslint-disable-next-line import/no-unresolved -- Browser cache-busting query.
import { downloadCollection } from '../../scripts/collections/collection-download.js?v=smart-collections-merge-20261005';
import { transformApiCollectionToInternal } from '../../scripts/collections/collections-utils.js';
import {
  getNativeSmartCollectionQuery,
  getSmartCollectionDisplayState,
  getSmartCollectionFacetState,
  isDeliverySmartCollection,
// eslint-disable-next-line import/no-unresolved -- Browser cache-busting query.
} from '../../scripts/collections/smart-collection-query.js?v=smart-collections-merge-20261005';
import {
  CollectionAccessLevel,
  CollectionAclField,
} from '../../scripts/collections/collection-search-constants.js';
import {
  createEditModal,
  createDeleteModal,
  createShareModal,
  createRemoveAssetsModal,
} from '../../scripts/collections/collection-modals.js';
import { loadCSS } from '../../scripts/aem.js';
import {
  setState,
  subscribe,
  search,
  handleLoadMoreResults,
  handleFacetCheckbox,
  handleClearAllFacets,
  fetchAssetRenditions,
} from '../search-results/search-results.js';
// eslint-disable-next-line import/no-unresolved -- Browser cache-busting query.
import { createImageGallery } from '../search-results/components/image-gallery.js?v=smart-collections-merge-20261005';
import { createFacetsPanel } from '../search-results/components/facets/index.js';
import { getDynamicMediaClient } from '../search-results/clients/dynamicmedia-client.js';
import { getFacetsConfig, getMetadataPath } from '../search-results/constants/facets.js';
import {
  getHitsPerPage,
  loadSearchFiltersFromUrl,
  saveSearchFiltersToUrl,
} from '../search-results/utils/config.js';
import { DEFAULT_SORT_TYPE, DEFAULT_SORT_DIRECTION } from '../search-results/utils/sort-utils.js';
import { loadSearchExpandAllDetailsState } from '../search-results/utils/toggle-state-storage.js';
import { localizePath, getAppLabel } from '../../scripts/locale-utils.js';
import { getBlockKeyValues, stripHtmlAndNewlines } from '../../scripts/scripts.js';
import {
  ICON_PEOPLE_MD,
  ICON_EDIT_MD,
  ICON_DELETE_MD,
  ICON_DOWNLOAD_MD,
} from '../../scripts/collections/collection-icons.js';
import { whenActivated } from '../../scripts/speculation.js';
import subscribeCollectionSearchRefresh from './collection-search-refresh.js';

function makeActionBtn(label, html, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scr-action-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = html;
  btn.addEventListener('click', onClick);
  return btn;
}

function showCollectionLoadError(block, t) {
  block.textContent = '';
  const error = document.createElement('div');
  error.className = 'cd-error';
  error.innerHTML = `<p>${t('collectionNotFound', 'We couldn\'t load this collection. It may no longer exist, or the link may be incorrect.')}</p>
    <p>${t('collectionNotFoundHelp', 'Still need help? Reach out to our Asset Management Team.')}</p>
    <p><a href="${localizePath('/search-collections')}">${t('backToCollections', 'Back to Collections')}</a></p>`;
  block.append(error);
}

function setActionButtonPending(button, pending, pendingLabel) {
  if (!button) return;
  button.disabled = pending;
  button.setAttribute('aria-busy', pending ? 'true' : 'false');
  if (pending) {
    button.dataset.pendingTitle = button.title;
    button.title = pendingLabel;
  } else if (button.dataset.pendingTitle) {
    button.title = button.dataset.pendingTitle;
    delete button.dataset.pendingTitle;
  }
}

export default async function decorate(block) {
  const t = await getAppLabel();
  const blockConfig = getBlockKeyValues(block);

  loadCSS('/blocks/search-results/search-results.css');
  // Modal styles (.scr-modal-*, .scr-share-*) live alongside search-collection-results
  loadCSS('/blocks/search-collection-results/search-collection-results.css');

  const urlParams = new URLSearchParams(window.location.search);
  const collectionId = urlParams.get('id');

  if (!collectionId) {
    block.textContent = '';
    const err = document.createElement('div');
    err.className = 'cd-error';
    err.textContent = t('noCollectionId', 'No collection ID provided');
    block.append(err);
    return;
  }

  const client = new DynamicMediaCollectionsClient({ user: window.user });

  // Fetch the full collection (name, ACL, accessLevel) for breadcrumb + actions.
  // Retry once on transient errors (5xx / network) so a flaky upstream doesn't
  // silently hide Edit / Delete / Share-access until a hard refresh.
  let collection = null;
  // eslint-disable-next-line no-restricted-syntax
  for (const attempt of [1, 2]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const metadata = await client.getCollectionMetadata(collectionId);
      collection = transformApiCollectionToInternal({
        ...metadata,
        collectionId,
      });
      break;
    } catch (err) {
      // 401 / 403 → definitive access denied; show a clear message and bail out.
      if (err?.status === 401 || err?.status === 403) {
        showCollectionLoadError(block, t);
        return;
      }
      // Only retry on transient errors. The client wraps fetch failures in an
      // Error whose message includes the HTTP status — check for 5xx or generic
      // network failure.
      const transient = !err?.message
        || /(\b5\d\d\b|network|fetch failed|TypeError)/i.test(err.message);
      if (attempt === 1 && transient) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => { setTimeout(r, 500); });
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-console
      console.warn('[collection-details] failed to load collection metadata', err);
      break;
    }
  }

  if (!collection) {
    showCollectionLoadError(block, t);
    return;
  }
  const isSmartCollection = isDeliverySmartCollection(collection);
  const nativeQuery = isSmartCollection ? getNativeSmartCollectionQuery(collection) : null;
  if (isSmartCollection && !nativeQuery) {
    // eslint-disable-next-line no-console
    console.error('[collection-details] Smart Collection has no valid saved query', collectionId);
    showCollectionLoadError(block, t);
    return;
  }
  const displayState = nativeQuery ? getSmartCollectionDisplayState(nativeQuery) : null;
  const collectionName = collection?.name || '';

  block.textContent = '';

  // Wrap in .search-results so all scoped CSS applies
  const wrapper = document.createElement('div');
  wrapper.className = 'collection-details-inner search-results';

  // Header row: breadcrumb on the left, action bar on the right
  const headerRow = document.createElement('div');
  headerRow.className = 'cd-header-row';

  const breadcrumb = document.createElement('div');
  breadcrumb.className = 'cd-breadcrumb';
  const breadcrumbLink = document.createElement('a');
  breadcrumbLink.href = localizePath('/search-collections');
  breadcrumbLink.textContent = t('collections', 'Collections');
  const breadcrumbSep = document.createElement('span');
  breadcrumbSep.className = 'cd-breadcrumb-sep';
  breadcrumbSep.textContent = '›';
  const breadcrumbName = document.createElement('span');
  breadcrumbName.className = 'cd-breadcrumb-name';
  breadcrumbName.textContent = collectionName;
  breadcrumb.append(breadcrumbLink, breadcrumbSep, breadcrumbName);

  // Action bar — only renders when the collection actually loaded
  const actionBar = document.createElement('div');
  actionBar.className = 'cd-actions';

  headerRow.append(breadcrumb, actionBar);

  // Share Link is always available; does not require ACL info.
  const onShareLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast(t('linkCopied', 'Link copied to clipboard'), 'success');
    }).catch(() => {
      showToast(t('copyFailed', 'Could not copy link'), 'error');
    });
  };

  actionBar.append(
    makeActionBtn(
      t('shareLink', 'Share link'),
      '<img src="/icons/share.svg" alt="" width="18" height="18" />',
      onShareLink,
    ),
  );

  // Owner-gated actions require the collection metadata to be loaded
  let removeModal = null;
  if (collection) {
    const editModal = createEditModal({
      client,
      t,
      onUpdated: ({ title, description, accessLevel } = {}) => {
        if (title) {
          collection.name = title;
          breadcrumbName.textContent = title;
          document.title = title;
        }
        if (description !== undefined) collection.description = description;
        if (accessLevel) collection.accessLevel = accessLevel;
      },
    });
    const deleteModal = createDeleteModal({
      client,
      t,
      onDeleted: () => { window.location.href = localizePath('/search-collections'); },
    });
    const shareModal = createShareModal({
      client,
      t,
      onUpdated: ({ viewers } = {}) => {
        if (collection.acl) {
          collection.acl[CollectionAclField.VIEWER] = viewers || [];
        }
      },
    });

    const canShareAccess = collection.accessLevel === CollectionAccessLevel.PRIVATE
      && collection.isOwner;

    const downloadBtn = makeActionBtn(
      t('downloadCollection', 'Download'),
      ICON_DOWNLOAD_MD,
      () => downloadCollection({
        client,
        collection,
        t,
        onLoadingChange: (loading) => {
          setActionButtonPending(
            downloadBtn,
            loading,
            t('preparingCollectionDownload', 'Preparing collection download...'),
          );
        },
      }),
    );
    actionBar.append(downloadBtn);

    if (canShareAccess) {
      actionBar.append(
        makeActionBtn(t('shareAccess', 'Share access'), ICON_PEOPLE_MD, () => shareModal.show(collection)),
      );
    }
    if (collection.isOwner) {
      actionBar.append(
        makeActionBtn(t('editCollection', 'Edit collection'), ICON_EDIT_MD, () => editModal.show(collection)),
        makeActionBtn(t('deleteCollection', 'Delete collection'), ICON_DELETE_MD, () => deleteModal.show(collection)),
      );

      // Bulk "Remove from collection" — owner-only, same gate as edit/delete.
      // Wired into the gallery below via onBulkRemoveFromCollection.
      if (!isSmartCollection) {
        removeModal = createRemoveAssetsModal({
          client,
          t,
          onRemoved: () => search(),
        });
      }
    }

    wrapper.append(editModal.overlay, deleteModal.overlay, shareModal.overlay);
    if (removeModal) wrapper.append(removeModal.overlay);
  }

  // Main layout mirrors createMainApp but inserted directly
  const mainContent = document.createElement('div');
  mainContent.className = 'main-content';

  const galleryEl = document.createElement('div');
  galleryEl.className = 'image-gallery';
  galleryEl.id = 'image-gallery';

  const facetsEl = document.createElement('div');
  facetsEl.className = 'facet-filter-panel';
  facetsEl.id = 'facet-filter-panel';

  const imagesMain = document.createElement('div');
  imagesMain.className = 'images-main';
  imagesMain.append(galleryEl);

  const imagesRow = document.createElement('div');
  imagesRow.className = 'images-content-row';
  imagesRow.append(facetsEl, imagesMain);

  const imagesWrapper = document.createElement('div');
  imagesWrapper.className = 'images-content-wrapper';
  imagesWrapper.append(imagesRow);

  const imagesContainer = document.createElement('div');
  imagesContainer.className = 'images-container';
  imagesContainer.append(imagesWrapper);

  mainContent.append(imagesContainer);

  wrapper.append(headerRow, mainContent);
  block.appendChild(wrapper);

  // Read excFacets: from block content, or cached from a prior search page visit
  let excFacets = {};
  if (blockConfig.excFacets) {
    try {
      excFacets = JSON.parse(stripHtmlAndNewlines(blockConfig.excFacets));
    } catch (_) { /* ignore */ }
  }
  if (!Object.keys(excFacets).length) {
    try {
      const cached = localStorage.getItem('sr-excFacets');
      if (cached) excFacets = JSON.parse(cached);
    } catch (_) { /* ignore */ }
  }

  // Point search-results state at this collection
  window.SearchResultsConfig = window.SearchResultsConfig || {};
  window.SearchResultsConfig.externalParams = {
    isBlockIntegration: true,
    collectionId: isSmartCollection ? undefined : collectionId,
    hitsPerPage: String(getHitsPerPage()),
    sortType: '',
    sortDirection: '',
    searchMode: '',
    excFacets,
    mimeTypeMappings: {},
    presetFilters: [],
  };

  const savedFacetState = nativeQuery ? getSmartCollectionFacetState(
    nativeQuery,
    Object.fromEntries(
      Object.entries(excFacets)
        .filter(([, config]) => config.type !== 'date')
        .map(([key]) => [key, getMetadataPath(key)]),
    ),
  ) : {};
  const urlFilters = loadSearchFiltersFromUrl();
  const facetCheckedState = { ...savedFacetState, ...urlFilters?.facetCheckedState };
  const query = displayState?.query || urlParams.get('query') || urlParams.get('fulltext') || '';

  setState({
    externalParams: window.SearchResultsConfig.externalParams,
    authenticated: true,
    dynamicMediaClient: getDynamicMediaClient(),
    excFacets: getFacetsConfig(),
    presetFilters: [],
    query,
    searchMode: displayState?.searchMode || 'FULLTEXT',
    nativeSmartCollectionQuery: nativeQuery,
    smartCollectionLoadFailed: false,
    facetCheckedState,
    selectedNumericFilters: urlFilters?.selectedNumericFilters || [],
    expandedFacets: Object.fromEntries(
      Object.entries(facetCheckedState)
        .filter(([, values]) => Object.values(values).some(Boolean))
        .map(([key]) => [key, true]),
    ),
    expandedHierarchyItems: {},
    selectedSortType: DEFAULT_SORT_TYPE,
    selectedSortDirection: DEFAULT_SORT_DIRECTION,
    currentPage: 0,
    contentAICursor: null,
    dmImages: [],
    searchResults: null,
    expandAllDetails: loadSearchExpandAllDetailsState(true),
  });

  // Set global open/close for asset details (image-gallery wires these up itself,
  // but collection-details needs them set before gallery renders)
  window.openDetailsView = window.openDetailsView || (() => {});
  window.closeDetailsView = window.closeDetailsView || (() => {});

  // Render gallery + facets panel
  const galleryContainer = wrapper.querySelector('#image-gallery');
  const facetsContainer = wrapper.querySelector('#facet-filter-panel');

  await createImageGallery(galleryContainer, {
    onLoadMoreResults: handleLoadMoreResults,
    onShareSearch: onShareLink,
    onFacetCheckbox: handleFacetCheckbox,
    onClearAllFacets: handleClearAllFacets,
    fetchAssetRenditions,
    onBulkRemoveFromCollection: removeModal
      ? (assets) => removeModal.show(collectionId, assets)
      : undefined,
  });

  await createFacetsPanel(facetsContainer, {
    search,
    onFacetCheckbox: handleFacetCheckbox,
    onClearAllFacets: handleClearAllFacets,
  });

  // Mobile filter panel and refinement URL
  subscribe((currentState, _prev, updates) => {
    if (updates.isMobileFilterOpen !== undefined) {
      const panel = wrapper.querySelector('.facet-filter-panel');
      if (panel) panel.classList.toggle('mobile-open', currentState.isMobileFilterOpen);
    }
    if (
      updates.facetCheckedState !== undefined
      || updates.selectedNumericFilters !== undefined
      || updates.selectedSortType !== undefined
      || updates.selectedSortDirection !== undefined
    ) {
      saveSearchFiltersToUrl(
        currentState.facetCheckedState,
        currentState.selectedNumericFilters,
        currentState.query,
      );
    }
  });

  subscribeCollectionSearchRefresh({ subscribe, search: () => whenActivated(() => search()) });
  whenActivated(() => search(query));
}
