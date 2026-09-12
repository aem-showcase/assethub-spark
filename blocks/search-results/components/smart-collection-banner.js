/* eslint-disable import/no-cycle */
/**
 * Mutation-detection banner for the active Smart Collection. Rendered above the results
 * gallery (mounted by main-app.js). Shows "Filter changes detected for [Collection Name] —
 * Save Changes | Save as New" whenever the current search state diverges from the active
 * smart collection's saved criteria.
 */

import { subscribe } from '../search-results.js';
import { escapeHtml } from '../utils/dom-utils.js';
import { getCachedPlaceholders, ph } from '../utils/placeholders.js';
import showToast from '../../../scripts/toast/toast.js';
import { updateSmartCollection } from '../../../scripts/smart-collections/smart-collections-api-client.js';
import { openSaveSmartCollectionModal } from '../../../scripts/smart-collections/smart-collection-modal.js';
import {
  getActiveSmartCollection,
  subscribeToActiveSmartCollection,
  buildCriteriaFromCurrentState,
  hasActiveSmartCollectionDiverged,
  reconcileActiveSmartCollectionCriteria,
} from '../../../scripts/smart-collections/smart-collection-state.js';

let bannerContainer = null;

function renderBanner() {
  if (!bannerContainer) return;

  const active = getActiveSmartCollection();
  if (!active || !hasActiveSmartCollectionDiverged()) {
    bannerContainer.innerHTML = '';
    return;
  }

  const placeholders = getCachedPlaceholders();

  bannerContainer.innerHTML = `
    <div class="smart-collection-banner">
      <span class="smart-collection-banner-message">
        ${ph(placeholders, 'smartCollectionChangesDetected', 'Filter changes detected for')}
        <strong>${escapeHtml(active.title)}</strong>
      </span>
      <div class="smart-collection-banner-actions">
        <button type="button" id="smart-collection-save-changes-btn">${ph(placeholders, 'saveChanges', 'Save Changes')}</button>
        <button type="button" id="smart-collection-save-as-new-btn">${ph(placeholders, 'saveAsNew', 'Save as New')}</button>
      </div>
    </div>
  `;

  bannerContainer.querySelector('#smart-collection-save-changes-btn')?.addEventListener('click', async () => {
    const criteria = buildCriteriaFromCurrentState();
    try {
      await updateSmartCollection(active.id, { criteria });
      reconcileActiveSmartCollectionCriteria(criteria);
      showToast(ph(placeholders, 'smartCollectionUpdated', 'Smart Collection updated.'), 'success');
      renderBanner();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to save changes to smart collection:', err);
      showToast(err.message || ph(placeholders, 'smartCollectionSaveFailed', 'Failed to save changes.'), 'error');
    }
  });

  bannerContainer.querySelector('#smart-collection-save-as-new-btn')?.addEventListener('click', () => {
    const criteria = buildCriteriaFromCurrentState();
    openSaveSmartCollectionModal({ criteria });
  });
}

/**
 * Mount the mutation-detection banner into the given container. Call once from main-app.js.
 * @param {HTMLElement} container
 */
export function initSmartCollectionBanner(container) {
  bannerContainer = container;
  renderBanner();

  subscribeToActiveSmartCollection(() => renderBanner());

  subscribe((_state, _prevState, updates) => {
    if (
      updates.query !== undefined
      || updates.facetCheckedState !== undefined
      || updates.selectedSortType !== undefined
      || updates.selectedSortDirection !== undefined
    ) {
      renderBanner();
    }
  });
}

export default initSmartCollectionBanner;
