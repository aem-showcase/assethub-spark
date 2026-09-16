/* eslint-disable import/no-cycle */
/**
 * Smart Collection save modal ("Save as Smart Collection" / "Save as New").
 * Built on scripts/global-modal.js, matching the app's existing modal conventions.
 *
 * Persists the collection natively (collectionType: DELIVERY_SMART_COLLECTION) via the
 * smart-collections API client. Title + description + public/private are author-controlled; the
 * hero thumbnail is derived best-effort from the first asset matching the saved query.
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
import { getContentAIClient } from '../../blocks/search-results/clients/dynamicmedia-client.js';
import { parseContentAIResponse, populateAssetFromContentAIHit } from '../asset-transformers.js';
import { createSmartCollection } from './smart-collections-api-client.js';
import {
  SMART_COLLECTION_TITLE_MAX_LENGTH,
  SMART_COLLECTION_DESCRIPTION_MAX_LENGTH,
  SMART_COLLECTION_ACCESS_LEVEL,
} from './smart-collection-types.js';
import { setActiveSmartCollection } from './smart-collection-state.js';

/**
 * Convert a draft's `facetCheckedState` into the grouped `[[{key,value}]]` shape ContentAI
 * expects.
 * @param {Record<string, Record<string, boolean>>} facetCheckedState
 * @returns {Array<Array<{key: string, value: string}>>}
 */
function toFacetFilters(facetCheckedState = {}) {
  const filters = [];
  Object.entries(facetCheckedState).forEach(([key, values]) => {
    const group = Object.entries(values || {})
      .filter(([, checked]) => checked)
      .map(([value]) => ({ key, value }));
    if (group.length > 0) filters.push(group);
  });
  return filters;
}

/**
 * Best-effort: fetch the first matching asset's id to use as the collection hero thumbnail.
 * @param {import('./smart-collection-types.js').SmartCollectionDraft} draft
 * @returns {Promise<string>} assetId (urn) or '' when unavailable.
 */
async function deriveThumbnail(draft) {
  try {
    const rawResponse = await getContentAIClient().searchAssets(draft.query?.trim() || '', {
      facetFilters: toFacetFilters(draft.facetFilters),
      numericFilters: [],
      filters: [],
      hitsPerPage: 1,
      skipFacetsRequest: true,
    });
    const { hits } = parseContentAIResponse(rawResponse);
    if (hits.length > 0) {
      const asset = populateAssetFromContentAIHit(hits[0]);
      return asset?.assetId || '';
    }
  } catch (err) {
    // A missing thumbnail must not block saving.
    // eslint-disable-next-line no-console
    console.warn('Failed to derive Smart Collection thumbnail:', err);
  }
  return '';
}

/**
 * Build a human-friendly default title from the active draft (first checked facet value,
 * falling back to the query term).
 * @param {import('./smart-collection-types.js').SmartCollectionDraft} draft
 * @returns {string}
 */
function buildDefaultTitle(draft) {
  const facetFilters = draft?.facetFilters || {};
  const firstFacetKey = Object.keys(facetFilters).find(
    (key) => Object.values(facetFilters[key] || {}).some(Boolean),
  );
  if (firstFacetKey) {
    const checkedValues = facetFilters[firstFacetKey];
    const firstValue = Object.keys(checkedValues).find((v) => checkedValues[v]);
    if (firstValue) return `${firstValue} ${firstFacetKey}`.trim();
  }
  if (draft?.query) return draft.query;
  return 'Untitled Search';
}

/**
 * Build the list of active-filter badges shown in the modal preview.
 * @param {import('./smart-collection-types.js').SmartCollectionDraft} draft
 * @returns {string[]}
 */
function buildFilterBadges(draft) {
  const badges = [];
  if (draft?.query) badges.push(`"${draft.query}"`);
  const facetFilters = draft?.facetFilters || {};
  Object.keys(facetFilters).forEach((key) => {
    Object.keys(facetFilters[key] || {}).forEach((value) => {
      if (facetFilters[key][value]) badges.push(value);
    });
  });
  if (draft?.sortType && draft.sortType !== 'topResults') {
    badges.push(`Sort: ${draft.sortType} (${draft.sortDirection || 'descending'})`);
  }
  return badges;
}

/**
 * Open the "Save as Smart Collection" modal.
 * @param {Object} options
 * @param {import('./smart-collection-types.js').SmartCollectionDraft} options.draft
 * @param {(collection: import('./smart-collection-types.js').SmartCollection) => void}
 *   [options.onSaved] - Called with the newly-created collection after a successful save.
 * @returns {Promise<Object>} The opened modal instance.
 */
export async function openSaveSmartCollectionModal({ draft, onSaved } = {}) {
  const placeholders = await getSearchPlaceholders();
  const defaultTitle = buildDefaultTitle(draft);
  const badges = buildFilterBadges(draft);

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
      <label class="smart-collection-modal-label" for="smart-collection-description-input">${ph(placeholders, 'smartCollectionDescriptionLabel', 'Description')}</label>
      <textarea
        id="smart-collection-description-input"
        class="smart-collection-modal-textarea"
        maxlength="${SMART_COLLECTION_DESCRIPTION_MAX_LENGTH}"
        rows="2"
      ></textarea>
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
        onClick: async ({ close, button }) => {
          const input = modal.body.querySelector('#smart-collection-name-input');
          const descInput = modal.body.querySelector('#smart-collection-description-input');
          const publicCheckbox = modal.body.querySelector('#smart-collection-public-checkbox');
          const errorEl = modal.body.querySelector('#smart-collection-modal-error');
          const title = input?.value?.trim();

          if (!title) {
            errorEl.textContent = ph(placeholders, 'smartCollectionNameRequired', 'Please enter a name for this Smart Collection.');
            errorEl.hidden = false;
            return;
          }

          if (button) button.disabled = true;
          try {
            const thumbnail = await deriveThumbnail(draft);
            const created = await createSmartCollection({
              title,
              description: descInput?.value?.trim() || '',
              smartCollectionQuery: draft.smartCollectionQuery,
              thumbnail,
              accessLevel: publicCheckbox?.checked
                ? SMART_COLLECTION_ACCESS_LEVEL.PUBLIC
                : SMART_COLLECTION_ACCESS_LEVEL.PRIVATE,
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
            if (button) button.disabled = false;
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
