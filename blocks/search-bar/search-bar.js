import {
  SEARCH_URL_PARAMS,
} from '../../scripts/scripts.js';
import { getAppLabel, localizePath } from '../../scripts/locale-utils.js';
import { setCoaState } from '../../scripts/coa-state.js';
import { COA_MAX_ASSETS } from '../search-results/clients/coa-client.js';
import { isImageMimeType } from '../search-results/utils/mime-type-converter.js';
import {
  loadSortPreference,
  SORT_TYPE,
  SORT_DIRECTION,
} from '../search-results/utils/sort-utils.js';

const ASSETS_SEARCH_PATH = '/search';

const SEARCH_TYPES = [
  {
    id: 'assets',
    path: ASSETS_SEARCH_PATH,
    labelKey: 'assets',
    labelDefault: 'Assets',
  },
  {
    id: 'collections',
    path: '/search-collections',
    labelKey: 'collections',
    labelDefault: 'Collections',
  },
];

export default async function decorate(block) {
  const t = await getAppLabel();

  let selectedImageAssets = [];
  let isGenerateMode = false;

  const currentPath = window.location.pathname;
  let selectedType = currentPath.includes('search-collections') ? 'collections' : 'assets';

  const queryInputContainer = document.createElement('div');
  queryInputContainer.className = 'query-input-container';

  const queryInputBar = document.createElement('div');
  queryInputBar.className = 'query-input-bar';

  // Type selector
  const typeSelector = document.createElement('div');
  typeSelector.className = 'type-selector';

  const typeSelectorBtn = document.createElement('button');
  typeSelectorBtn.className = 'type-selector-btn';
  typeSelectorBtn.type = 'button';
  typeSelectorBtn.setAttribute('aria-haspopup', 'listbox');
  typeSelectorBtn.setAttribute('aria-expanded', 'false');

  const typeSelectorLabel = document.createElement('span');
  typeSelectorLabel.className = 'type-selector-label';

  const typeSelectorArrow = document.createElement('span');
  typeSelectorArrow.className = 'type-selector-arrow';

  typeSelectorBtn.append(typeSelectorLabel, typeSelectorArrow);

  const typeSelectorDropdown = document.createElement('ul');
  typeSelectorDropdown.className = 'type-selector-dropdown';
  typeSelectorDropdown.setAttribute('role', 'listbox');
  typeSelectorDropdown.hidden = true;

  const updateSelectedType = (typeId) => {
    selectedType = typeId;
    const found = SEARCH_TYPES.find((type) => type.id === typeId);
    typeSelectorLabel.textContent = t(found.labelKey, found.labelDefault);
    typeSelectorDropdown.querySelectorAll('li').forEach((li) => {
      const isSelected = li.dataset.type === typeId;
      li.setAttribute('aria-selected', String(isSelected));
      li.classList.toggle('active', isSelected);
    });
  };

  SEARCH_TYPES.forEach(({ id, labelKey, labelDefault }) => {
    const li = document.createElement('li');
    li.dataset.type = id;
    li.setAttribute('role', 'option');
    li.textContent = t(labelKey, labelDefault);
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      updateSelectedType(id);
      typeSelectorBtn.setAttribute('aria-expanded', 'false');
      typeSelectorDropdown.hidden = true;
    });
    typeSelectorDropdown.appendChild(li);
  });

  typeSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !typeSelectorDropdown.hidden;
    typeSelectorDropdown.hidden = isOpen;
    typeSelectorBtn.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', () => {
    typeSelectorDropdown.hidden = true;
    typeSelectorBtn.setAttribute('aria-expanded', 'false');
  });

  updateSelectedType(selectedType);
  typeSelector.append(typeSelectorBtn, typeSelectorDropdown);

  // Input
  const queryInputWrapper = document.createElement('div');
  queryInputWrapper.className = 'query-input-wrapper';

  const querySearchIcon = document.createElement('span');
  querySearchIcon.className = 'query-search-icon';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'query-input';
  input.placeholder = t('searchPlaceholder', 'What are you looking for?');
  input.autofocus = true;

  const clearIcon = document.createElement('span');
  clearIcon.className = 'query-clear-icon';
  clearIcon.style.display = 'none';

  queryInputWrapper.append(querySearchIcon, input, clearIcon);

  const urlParams = new URLSearchParams(window.location.search);
  const queryParam = urlParams.get(SEARCH_URL_PARAMS.QUERY)
    || urlParams.get(SEARCH_URL_PARAMS.FULLTEXT);
  if (queryParam) {
    input.value = decodeURIComponent(queryParam) || '';
  }

  const getAssetsSearchPath = () => {
    if (document.querySelector('.search-results')) {
      return window.location.pathname;
    }
    return localizePath(ASSETS_SEARCH_PATH);
  };

  const performSearch = () => {
    const query = input.value;
    const typeConfig = SEARCH_TYPES.find((type) => type.id === selectedType);
    const searchPath = selectedType === 'assets'
      ? getAssetsSearchPath()
      : localizePath(typeConfig.path);
    const newParams = new URLSearchParams();
    newParams.set(SEARCH_URL_PARAMS.QUERY, query);

    if (selectedType === 'assets') {
      const storedSort = loadSortPreference(searchPath);
      if (storedSort) {
        newParams.set('sortType', storedSort.sortType);
        newParams.set('sortDirection', storedSort.sortDirection);
      } else {
        newParams.set('sortType', SORT_TYPE.TOP_RESULTS);
        newParams.set('sortDirection', SORT_DIRECTION.DESCENDING);
      }
    }

    window.location.href = `${searchPath}?${newParams.toString()}`;
  };

  const searchBtn = document.createElement('button');
  searchBtn.className = 'query-search-btn';
  searchBtn.setAttribute('aria-label', t('search', 'Search'));
  searchBtn.textContent = t('search', 'Search');
  searchBtn.addEventListener('click', performSearch);
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      if (isGenerateMode) {
        submitGenerate();
      } else {
        performSearch();
      }
    }
  });

  const toggleClearIcon = () => {
    clearIcon.style.display = input.value ? 'block' : 'none';
  };

  clearIcon.addEventListener('click', () => {
    input.value = '';
    toggleClearIcon();
    input.focus();
    performSearch();
  });

  input.addEventListener('input', toggleClearIcon);
  toggleClearIcon();

  // Generate mode ("COA") — search bar swaps to prompt mode when the user has
  // selected 1+ image assets in the gallery.
  const generateBadge = document.createElement('div');
  generateBadge.className = 'generate-mode-badge';
  generateBadge.hidden = true;

  const generateCancelBtn = document.createElement('button');
  generateCancelBtn.type = 'button';
  generateCancelBtn.className = 'generate-mode-cancel';
  generateCancelBtn.textContent = t('cancel', 'Cancel');

  generateBadge.append(generateCancelBtn);

  const generateSuggestions = document.createElement('ul');
  generateSuggestions.className = 'generate-mode-suggestions';
  generateSuggestions.hidden = true;

  const GENERATE_SUGGESTION_KEYS = [
    ['promptSuggestion1', 'Get me Instagram and LinkedIn renditions'],
    ['promptSuggestion2', 'Generate a web hero banner rendition with sharpening'],
    ['promptSuggestion3', 'Create a 2000 pixel rendition as webp format with 90% quality'],
  ];
  GENERATE_SUGGESTION_KEYS.forEach(([key, fallback]) => {
    const li = document.createElement('li');
    li.className = 'generate-mode-suggestion';
    li.textContent = t(key, fallback);
    li.addEventListener('click', () => {
      input.value = t(key, fallback);
      toggleClearIcon();
      generateSuggestions.hidden = true;
      input.focus();
    });
    generateSuggestions.appendChild(li);
  });

  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.className = 'generate-mode-submit';
  generateBtn.textContent = t('generate', 'Generate');

  function setGenerateMode(enabled) {
    isGenerateMode = enabled;
    generateBadge.hidden = !enabled;
    generateBtn.hidden = !enabled;
    searchBtn.hidden = enabled;
    generateSuggestions.hidden = !enabled;
    input.placeholder = enabled
      ? t('generatePromptPlaceholder', 'Describe the renditions you want…')
      : t('searchPlaceholder', 'What are you looking for?');
  }

  function handleAssetSelectionChanged(selectedAssets) {
    selectedImageAssets = (selectedAssets ?? []).filter((a) => isImageMimeType(a.format));
    setGenerateMode(selectedImageAssets.length > 0);
  }

  window.addEventListener('assetSelectionChanged', (e) => {
    handleAssetSelectionChanged(e.detail?.selectedAssets);
  });

  generateCancelBtn.addEventListener('click', () => {
    setGenerateMode(false);
  });

  const submitGenerate = () => {
    const prompt = input.value.trim();
    if (!prompt || selectedImageAssets.length === 0) return;

    const requestId = crypto.randomUUID();
    const assets = selectedImageAssets
      .slice(0, COA_MAX_ASSETS)
      .map((a) => ({ id: a.assetId, name: a.name }));

    // Don't call generateRenditions() here — a full-page navigation is about
    // to tear down this page's JS context, which would abort the fetch before
    // it resolves. Store the pending request; /renditions issues the actual
    // call itself once it has loaded, so the fetch's lifetime matches the
    // page that will render its result.
    setCoaState({
      coaIsLoading: true,
      coaResult: null,
      coaError: null,
      coaRequestId: requestId,
      coaPendingRequest: { prompt, assets },
    });

    window.location.href = localizePath('/renditions');
  };

  generateBtn.addEventListener('click', submitGenerate);

  setGenerateMode(false);

  queryInputBar.append(typeSelector, queryInputWrapper, generateBadge, generateBtn, searchBtn);
  queryInputContainer.append(queryInputBar, generateSuggestions);

  block.textContent = '';
  block.append(queryInputContainer);
}
