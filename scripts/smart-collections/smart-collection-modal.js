/* eslint-disable import/no-cycle */
/**
 * Smart Collection save modal ("Save as Smart Collection" / "Save as New").
 * Built on scripts/global-modal.js, matching the app's existing modal conventions.
 */

import {
  showGlobalModal,
  MODAL_CONTENT_TYPES,
  MODAL_BUTTON_ACTIONS,
  MODAL_BUTTON_VARIANTS,
} from '../global-modal.js';
import showToast from '../toast/toast.js';
import { escapeHtml } from '../../blocks/search-results/utils/dom-utils.js';
import { getSearchPlaceholders, ph } from '../../blocks/search-results/utils/placeholders.js';
import { createSmartCollection } from './smart-collections-api-client.js';
import { SMART_COLLECTION_TITLE_MAX_LENGTH } from './smart-collection-types.js';
import { setActiveSmartCollection } from './smart-collection-state.js';

/**
 * Build a human-friendly default title from active criteria (e.g. "barista Campaign" style
 * from the first checked facet value, falling back to the query term).
 * @param {import('./smart-collection-types.js').SearchCriteria} criteria
 * @returns {string}
 */
function buildDefaultTitle(criteria) {
  const facetFilters = criteria?.facetFilters || {};
  const firstFacetKey = Object.keys(facetFilters).find(
    (key) => Object.values(facetFilters[key] || {}).some(Boolean),
  );
  if (firstFacetKey) {
    const checkedValues = facetFilters[firstFacetKey];
    const firstValue = Object.keys(checkedValues).find((v) => checkedValues[v]);
    if (firstValue) {
      return `${firstValue} ${firstFacetKey}`.trim();
    }
  }
  if (criteria?.query) {
    return criteria.query;
  }
  return 'Untitled Search';
}

/**
 * Build the list of active-filter badges shown in the modal preview.
 * @param {import('./smart-collection-types.js').SearchCriteria} criteria
 * @returns {string[]}
 */
function buildFilterBadges(criteria) {
  const badges = [];
  if (criteria?.query) {
    badges.push(`"${criteria.query}"`);
  }
  const facetFilters = criteria?.facetFilters || {};
  Object.keys(facetFilters).forEach((key) => {
    Object.keys(facetFilters[key] || {}).forEach((value) => {
      if (facetFilters[key][value]) {
        badges.push(value);
      }
    });
  });
  if (criteria?.sortType && criteria.sortType !== 'topResults') {
    badges.push(`Sort: ${criteria.sortType} (${criteria.sortDirection || 'descending'})`);
  }
  return badges;
}

/**
 * Open the "Save as Smart Collection" modal.
 * @param {Object} options
 * @param {import('./smart-collection-types.js').SearchCriteria} options.criteria - Active criteria.
 * @param {(collection: import('./smart-collection-types.js').SmartCollection) => void}
 *   [options.onSaved] - Called with the newly-created collection after a successful save.
 * @returns {Promise<Object>} The opened modal instance.
 */
export async function openSaveSmartCollectionModal({ criteria, onSaved } = {}) {
  const placeholders = await getSearchPlaceholders();
  const defaultTitle = buildDefaultTitle(criteria);
  const badges = buildFilterBadges(criteria);

  const bodyHtml = `
    <div class="smart-collection-modal-body">
      <label class="smart-collection-modal-label" for="smart-collection-name-input">${ph(placeholders, 'smartCollectionNameLabel', 'Collection Name')}</label>
      <input
        type="text"
        id="smart-collection-name-input"
        class="smart-collection-modal-input"
        maxlength="${SMART_COLLECTION_TITLE_MAX_LENGTH}"
        value="${escapeHtml(defaultTitle)}"
      />
      <div class="smart-collection-modal-label">${ph(placeholders, 'smartCollectionFiltersLabel', 'Active Filters')}</div>
      <div class="smart-collection-modal-badges">
        ${badges.length
    ? badges.map((b) => `<span class="smart-collection-badge">${escapeHtml(b)}</span>`).join('')
    : `<span class="smart-collection-modal-empty">${ph(placeholders, 'smartCollectionNoFilters', 'No active filters')}</span>`}
      </div>
      <label class="smart-collection-modal-checkbox-row" for="smart-collection-public-checkbox">
        <input type="checkbox" id="smart-collection-public-checkbox" />
        <span>${ph(placeholders, 'smartCollectionPublicLabel', 'Public — share with everyone in the organization')}</span>
      </label>
      <div class="smart-collection-modal-error" id="smart-collection-modal-error" hidden></div>
    </div>
  `;

  const modal = showGlobalModal({
    id: 'smart-collection-save-modal',
    title: ph(placeholders, 'saveAsSmartCollection', 'Save as Smart Collection'),
    width: '480px',
    content: { type: MODAL_CONTENT_TYPES.HTML, value: bodyHtml },
    buttons: [
      {
        key: 'cancel',
        label: ph(placeholders, 'cancel', 'Cancel'),
        variant: MODAL_BUTTON_VARIANTS.SECONDARY,
        action: MODAL_BUTTON_ACTIONS.CLOSE,
      },
      {
        key: 'save',
        label: ph(placeholders, 'save', 'Save'),
        variant: MODAL_BUTTON_VARIANTS.PRIMARY,
        action: MODAL_BUTTON_ACTIONS.CUSTOM,
        onClick: async ({ close }) => {
          const input = modal.body.querySelector('#smart-collection-name-input');
          const publicCheckbox = modal.body.querySelector('#smart-collection-public-checkbox');
          const errorEl = modal.body.querySelector('#smart-collection-modal-error');
          const title = input?.value?.trim();

          if (!title) {
            errorEl.textContent = ph(placeholders, 'smartCollectionNameRequired', 'Please enter a name for this Smart Collection.');
            errorEl.hidden = false;
            return;
          }

          try {
            const created = await createSmartCollection({
              title,
              criteria,
              visibility: publicCheckbox?.checked ? 'organization' : 'private',
            });
            setActiveSmartCollection(created);
            showToast(ph(placeholders, 'smartCollectionSaved', 'Smart Collection saved.'), 'success');
            if (typeof onSaved === 'function') onSaved(created);
            close();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('Failed to save smart collection:', err);
            errorEl.textContent = err.message
              || ph(placeholders, 'smartCollectionSaveFailed', 'Failed to save Smart Collection. Please try again.');
            errorEl.hidden = false;
          }
        },
      },
    ],
  });

  // Focus + select the name input for quick rename
  const input = modal.body.querySelector('#smart-collection-name-input');
  if (input) {
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  return modal;
}

export default openSaveSmartCollectionModal;
