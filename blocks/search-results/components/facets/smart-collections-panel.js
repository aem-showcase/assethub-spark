/* eslint-disable no-alert, import/no-cycle */
/**
 * Smart Collections list panel — rendered inside the "Smart Collections" tab of the facet
 * header (blocks/search-results/components/facets/index.js). Handles listing, applying,
 * inline rename, and delete (with confirmation) for saved smart collections.
 */

import { setState } from '../../search-results.js';
import { escapeHtml } from '../../utils/dom-utils.js';
import { getCachedPlaceholders, ph } from '../../utils/placeholders.js';
import {
  showGlobalModal,
  MODAL_CONTENT_TYPES,
  MODAL_BUTTON_ACTIONS,
  MODAL_BUTTON_VARIANTS,
} from '../../../../scripts/global-modal.js';
import showToast from '../../../../scripts/toast/toast.js';
import {
  listSmartCollections,
  updateSmartCollection,
  deleteSmartCollection,
} from '../../../../scripts/smart-collections/smart-collections-api-client.js';
import {
  setActiveSmartCollection,
  getActiveSmartCollection,
} from '../../../../scripts/smart-collections/smart-collection-state.js';

/**
 * @typedef {import(
 *   '../../../../scripts/smart-collections/smart-collection-types.js'
 * ).SmartCollection} SmartCollection
 */

let cachedCollections = [];
let isLoading = false;
let loadError = null;

/**
 * @returns {SmartCollection[]}
 */
export function getCachedSmartCollections() {
  return cachedCollections;
}

/**
 * Fetch the list of smart collections from the API and cache it.
 * @returns {Promise<void>}
 */
export async function refreshSmartCollections() {
  isLoading = true;
  loadError = null;
  try {
    cachedCollections = await listSmartCollections();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to load smart collections:', err);
    loadError = err.message || 'Failed to load Smart Collections.';
  } finally {
    isLoading = false;
  }
}

/**
 * Apply a smart collection's saved criteria to the current search state. Reuses the same
 * setState() path that URL-param loading uses on page load, so URL sync + auto-search happen
 * automatically via the subscribe() handlers already in search-results.js.
 * @param {SmartCollection} collection
 */
export function applySmartCollection(collection) {
  const { criteria } = collection;
  setState({
    query: criteria?.query || '',
    facetCheckedState: criteria?.facetFilters || {},
    selectedNumericFilters: [],
    selectedSortType: criteria?.sortType,
    selectedSortDirection: criteria?.sortDirection,
  });
  setActiveSmartCollection(collection);
}

/**
 * Render the Smart Collections tab content as an HTML string.
 * @returns {string}
 */
export function renderSmartCollectionsList() {
  const activeId = getActiveSmartCollection()?.id;
  const placeholders = getCachedPlaceholders();

  if (isLoading && cachedCollections.length === 0) {
    return `
      <div class="smart-collections-list" id="smart-collections-list">
        <div class="facet-loading-spinner">
          <div class="loading-spinner loading-spinner-lg" role="status" aria-label="Loading"></div>
        </div>
      </div>
    `;
  }

  if (loadError) {
    return `
      <div class="smart-collections-list" id="smart-collections-list">
        <div class="smart-collections-empty">${escapeHtml(loadError)}</div>
      </div>
    `;
  }

  if (cachedCollections.length === 0) {
    return `
      <div class="smart-collections-list" id="smart-collections-list">
        <div class="smart-collections-empty">
          ${ph(placeholders, 'smartCollectionsEmpty', 'No Smart Collections yet. Apply search filters, then use "Save as Smart Collection" to create one.')}
        </div>
      </div>
    `;
  }

  return `
    <div class="smart-collections-list" id="smart-collections-list">
      ${cachedCollections.map((collection) => `
        <div class="smart-collection-item${collection.id === activeId ? ' active' : ''}" data-collection-id="${escapeHtml(collection.id)}">
          <span class="smart-collection-icon" aria-hidden="true">✨</span>
          <span class="smart-collection-title" data-role="title">${escapeHtml(collection.title)}</span>
          ${collection.visibility === 'organization' ? `<span class="smart-collection-visibility-tag">${ph(placeholders, 'smartCollectionPublicTag', 'Public')}</span>` : ''}
          <div class="smart-collection-actions">
            <button type="button" class="smart-collection-action-btn" data-action="menu" aria-label="Actions" aria-haspopup="true">&hellip;</button>
            <div class="smart-collection-action-menu" hidden>
              <button type="button" data-action="rename">${ph(placeholders, 'rename', 'Rename')}</button>
              <button type="button" data-action="delete">${ph(placeholders, 'delete', 'Delete')}</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Start inline rename for a collection item.
 * @param {HTMLElement} itemEl
 * @param {SmartCollection} collection
 * @param {() => void} onRenamed
 */
function startInlineRename(itemEl, collection, onRenamed) {
  const titleEl = itemEl.querySelector('[data-role="title"]');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'smart-collection-rename-input';
  input.value = collection.title;
  input.maxLength = 200;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if (!newTitle || newTitle === collection.title) {
      onRenamed();
      return;
    }
    const placeholders = getCachedPlaceholders();
    try {
      await updateSmartCollection(collection.id, { title: newTitle });
      collection.title = newTitle;
      showToast(ph(placeholders, 'smartCollectionRenamed', 'Smart Collection renamed.'), 'success');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to rename smart collection:', err);
      showToast(err.message || ph(placeholders, 'smartCollectionRenameFailed', 'Failed to rename Smart Collection.'), 'error');
    }
    onRenamed();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = collection.title;
      input.blur();
    }
  });
}

/**
 * Confirm + delete a smart collection.
 * @param {SmartCollection} collection
 * @param {() => void} onDeleted
 */
function confirmDeleteSmartCollection(collection, onDeleted) {
  const placeholders = getCachedPlaceholders();
  const modal = showGlobalModal({
    id: 'smart-collection-delete-confirm',
    title: ph(placeholders, 'deleteSmartCollectionTitle', 'Delete Smart Collection'),
    width: '420px',
    content: {
      type: MODAL_CONTENT_TYPES.TEXT,
      value: ph(
        placeholders,
        'deleteSmartCollectionConfirm',
        'Delete this Smart Collection? Matching media assets will remain untouched.',
      ),
    },
    buttons: [
      {
        key: 'cancel',
        label: ph(placeholders, 'cancel', 'Cancel'),
        variant: MODAL_BUTTON_VARIANTS.SECONDARY,
        action: MODAL_BUTTON_ACTIONS.CLOSE,
      },
      {
        key: 'delete',
        label: ph(placeholders, 'delete', 'Delete'),
        variant: MODAL_BUTTON_VARIANTS.PRIMARY,
        action: MODAL_BUTTON_ACTIONS.CUSTOM,
        onClick: async ({ close }) => {
          try {
            await deleteSmartCollection(collection.id);
            cachedCollections = cachedCollections.filter((c) => c.id !== collection.id);
            if (getActiveSmartCollection()?.id === collection.id) {
              setActiveSmartCollection(null);
            }
            showToast(ph(placeholders, 'smartCollectionDeleted', 'Smart Collection deleted.'), 'success');
            onDeleted();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to delete smart collection:', err);
            showToast(err.message || ph(placeholders, 'smartCollectionDeleteFailed', 'Failed to delete Smart Collection.'), 'error');
          }
          close();
        },
      },
    ],
  });
  modal.open();
}

/**
 * Bind click events for the rendered Smart Collections list. Call after each re-render.
 * @param {HTMLElement} containerElement - The facets panel container (contains #facet-list).
 * @param {() => void} rerender - Callback to trigger a re-render of the tab content.
 */
export function bindSmartCollectionsListEvents(containerElement, rerender) {
  const list = containerElement.querySelector('#smart-collections-list');
  if (!list) return;

  list.querySelectorAll('.smart-collection-item').forEach((itemEl) => {
    const id = itemEl.dataset.collectionId;
    const collection = cachedCollections.find((c) => c.id === id);
    if (!collection) return;

    const menuBtn = itemEl.querySelector('[data-action="menu"]');
    const menu = itemEl.querySelector('.smart-collection-action-menu');

    itemEl.addEventListener('click', (event) => {
      if (event.target.closest('.smart-collection-actions')) return;
      applySmartCollection(collection);
    });

    menuBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = !menu.hidden;
      containerElement.querySelectorAll('.smart-collection-action-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = isOpen;
    });

    menu?.querySelector('[data-action="rename"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      startInlineRename(itemEl, collection, rerender);
    });

    menu?.querySelector('[data-action="delete"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      confirmDeleteSmartCollection(collection, rerender);
    });
  });

  // Close any open action menu on an outside click (bound once per render is fine; the
  // container is fully replaced on re-render, so no leak of duplicate listeners on document).
  document.addEventListener('click', () => {
    containerElement.querySelectorAll('.smart-collection-action-menu').forEach((m) => { m.hidden = true; });
  }, { once: true });
}
