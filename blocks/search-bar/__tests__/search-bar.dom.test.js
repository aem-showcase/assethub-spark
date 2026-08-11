import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (key, fallback) => fallback || key,
  localizePath: (path) => path,
  getLocaleRedirectUrl: () => null,
  hasLocalePrefix: () => true,
  getCurrentLocale: () => 'en',
}));

vi.mock('../../search-results/utils/sort-utils.js', () => ({
  loadSortPreference: () => null,
  SORT_TYPE: { TOP_RESULTS: 'topResults' },
  SORT_DIRECTION: { DESCENDING: 'desc' },
}));

vi.mock('../../search-results/clients/coa-client.js', () => ({
  COA_MAX_ASSETS: 20,
}));

const { default: decorate } = await import('../search-bar.js');
const { getCoaState, clearCoaResult } = await import('../../../scripts/coa-state.js');

function imageAsset(overrides = {}) {
  return {
    assetId: 'urn:aaid:aem:1', name: 'hero.jpg', format: 'image/jpeg', ...overrides,
  };
}

function dispatchSelection(selectedAssets) {
  window.dispatchEvent(new CustomEvent('assetSelectionChanged', { detail: { selectedAssets } }));
}

describe('search-bar.js — generate mode', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearCoaResult();
    delete window.location;
    window.location = { href: '', pathname: '/en/search', search: '' };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('generate mode', () => {
    it('starts in normal search mode', async () => {
      const block = document.createElement('div');
      await decorate(block);
      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
      expect(block.querySelector('.query-search-btn').hidden).toBe(false);
    });

    it('enters generate mode when 1+ image assets are selected', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);

      expect(block.querySelector('.generate-mode-badge').hidden).toBe(false);
      expect(block.querySelector('.generate-mode-submit').hidden).toBe(false);
      expect(block.querySelector('.query-search-btn').hidden).toBe(true);
    });

    it('ignores non-image selections', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset({ format: 'application/pdf' })]);

      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
    });

    it('exits generate mode when selection is cleared', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);
      expect(block.querySelector('.generate-mode-badge').hidden).toBe(false);

      dispatchSelection([]);
      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
    });

    it('exits generate mode via the cancel button', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);
      block.querySelector('.generate-mode-cancel').click();

      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
    });

    it('does not submit when the prompt is empty', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);
      block.querySelector('.generate-mode-submit').click();

      expect(getCoaState().coaPendingRequest).toBeNull();
      expect(window.location.href).toBe('');
    });

    it('does not submit when no image assets are selected', async () => {
      const block = document.createElement('div');
      await decorate(block);

      block.querySelector('.query-input').value = 'a prompt';
      block.querySelector('.generate-mode-submit').click();

      expect(getCoaState().coaPendingRequest).toBeNull();
    });

    it('on submit: stores the pending request, sets loading state, and navigates to /renditions immediately — without calling generateRenditions itself', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);
      block.querySelector('.query-input').value = 'Get me Instagram renditions';
      block.querySelector('.generate-mode-submit').click();

      // Navigation must happen synchronously — this page's JS context is
      // about to be torn down, so the actual generateRenditions() call must
      // happen on the destination page, not here.
      expect(window.location.href).toBe('/renditions');
      expect(getCoaState().coaIsLoading).toBe(true);
      expect(getCoaState().coaRequestId).toBeTruthy();
      expect(getCoaState().coaPendingRequest).toEqual({
        prompt: 'Get me Instagram renditions',
        assets: [{ id: 'urn:aaid:aem:1', name: 'hero.jpg' }],
      });
    });

    it('caps assets stored in the pending request at COA_MAX_ASSETS', async () => {
      const block = document.createElement('div');
      await decorate(block);

      const manyAssets = Array.from({ length: 25 }, (_, i) => imageAsset({ assetId: `id-${i}`, name: `name-${i}` }));
      dispatchSelection(manyAssets);
      block.querySelector('.query-input').value = 'a prompt';
      block.querySelector('.generate-mode-submit').click();

      expect(getCoaState().coaPendingRequest.assets).toHaveLength(20);
    });
  });
});
