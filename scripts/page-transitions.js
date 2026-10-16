/*
 * Cross-document (page-to-page) view transitions.
 *
 * Imported first by scripts/scripts.js. It registers the `pagereveal`/`pageswap` listeners and
 * only then adds the opt-in stylesheet (`@view-transition { navigation: auto; }` in
 * styles/page-transitions.css) and the prerender rules, so whenever a page has opted in, the
 * listeners are already in place.
 *
 * Edge Delivery keeps <body> hidden until JS has decorated the page, so a normally loaded page
 * is blank when it is revealed. We only animate when the new page is already built — i.e. it was
 * prerendered (see scripts/speculation.js) or restored from the back/forward cache — and skip the
 * transition otherwise, which keeps today's behaviour.
 *
 * Shared-element pairs (names are set only for the duration of a transition):
 *   vt-site-header  <header> on both pages, held still
 *   vt-search-box   the search-bar block on both pages
 *   vt-hero         card linking to the other page  <->  results area of the other page
 *   vt-title        collection card name            <->  collection-details breadcrumb name
 *   vt-nav-underline  active header nav underline, slides to the newly active item
 */
import { addPrerenderRules } from './speculation.js';
import { OPTIONAL_SITE_PATH_REGEX_SOURCE } from './locale-utils.js';

(() => {
  if (typeof window === 'undefined' || !('PageRevealEvent' in window)) return;

  const HEADER = 'vt-site-header';
  const SEARCH_BOX = 'vt-search-box';
  const HERO = 'vt-hero';
  const TITLE = 'vt-title';
  const NAV_UNDERLINE = 'vt-nav-underline';
  const VIEWPORT_MARGIN_PX = 100;

  const CARD_SELECTOR = '[data-vt-href]';
  // First visible match wins: the results grid, else the whole results block. The grid can be
  // empty/zero-height at reveal time because the search only runs after prerender activation.
  const HERO_TARGET_SELECTORS = [
    '.search-results .images-main',
    '.collection-details .collection-details-inner',
    '.collection-details.block',
    '.search-results.block',
    '.searches-report-container',
    '.report-asset-activity.block',
  ];
  const CARD_TITLE_SELECTOR = '.scr-card-name, .scr-row-name, .report-card-title';
  const TARGET_TITLE_SELECTOR = '.cd-breadcrumb-name, .searches-title, .aar-title';
  // Pages that hold cards linking into a results page (home, the collections list, report hub).
  const CARD_PAGE_PATH = new RegExp(
    `^${OPTIONAL_SITE_PATH_REGEX_SOURCE}(?:/|/index|/search-collections/?|/reports/report-hub/?)?$`,
  );

  const named = [];
  let lastIntentUrl = null;

  function clearNames() {
    while (named.length) named.pop().style.removeProperty('view-transition-name');
  }

  function setName(el, name) {
    if (!el || el.style.viewTransitionName) return;
    el.style.viewTransitionName = name;
    named.push(el);
  }

  function toUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      return url.origin === window.location.origin ? url : null;
    } catch {
      return null;
    }
  }

  function urlKey(value) {
    const url = toUrl(value);
    if (!url) return null;
    const params = new URLSearchParams(url.search);
    params.sort();
    return `${url.pathname.replace(/\/+$/, '') || '/'}?${params}`;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const h = window.innerHeight || document.documentElement.clientHeight;
    const w = window.innerWidth || document.documentElement.clientWidth;
    // Horizontal check skips carousel slides that are scrolled out of view.
    return r.bottom > -VIEWPORT_MARGIN_PX && r.top < h + VIEWPORT_MARGIN_PX
      && r.right > 0 && r.left < w;
  }

  function isCardPage(value) {
    const url = toUrl(value);
    return !!url && CARD_PAGE_PATH.test(url.pathname);
  }

  function findCardFor(otherUrl) {
    const key = urlKey(otherUrl);
    if (!key) return null;
    return [...document.querySelectorAll(CARD_SELECTOR)]
      .find((el) => urlKey(el.dataset.vtHref) === key && isVisible(el)) || null;
  }

  /**
   * Name this page's side of every shared-element pair, relative to the other page's URL.
   */
  function nameElements(otherUrl) {
    setName(document.querySelector('header'), HEADER);

    const underline = document.querySelector('header .nav-sections a.active > .nav-active-underline');
    if (isVisible(underline)) setName(underline, NAV_UNDERLINE);

    const searchBox = document.querySelector('main .search-bar.block');
    if (isVisible(searchBox)) setName(searchBox, SEARCH_BOX);

    const card = findCardFor(otherUrl);
    if (card) {
      setName(card, HERO);
      setName(card.querySelector(CARD_TITLE_SELECTOR), TITLE);
      return;
    }

    if (isCardPage(otherUrl)) {
      const target = HERO_TARGET_SELECTORS
        .flatMap((sel) => [...document.querySelectorAll(sel)])
        .find(isVisible);
      if (target) setName(target, HERO);
      const title = document.querySelector(TARGET_TITLE_SELECTOR);
      if (isVisible(title)) setName(title, TITLE);
    }
  }

  function isPageReady() {
    const { body } = document;
    if (!body || !body.classList.contains('appear')) return false;
    const firstSection = document.querySelector('main .section');
    return !firstSection || firstSection.dataset.sectionStatus === 'loaded';
  }

  function directionOf(activation) {
    if (!activation || activation.navigationType !== 'traverse') return 'forward';
    const to = activation.entry?.index ?? -1;
    const from = activation.from?.index ?? -1;
    return to > -1 && from > -1 && to < from ? 'back' : 'forward';
  }

  function addTypes(transition, direction) {
    try {
      transition.types?.add('page-nav');
      transition.types?.add(`page-${direction}`);
    } catch {
      // types unsupported — CSS falls back to the untyped rules
    }
  }

  // Remember the destination of JS-driven card clicks for engines without `activation`.
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.(`${CARD_SELECTOR}, a[href]`);
    if (el) lastIntentUrl = el.dataset?.vtHref || el.href || null;
  }, true);

  // Old page: runs right before its snapshot is taken.
  window.addEventListener('pageswap', (e) => {
    const { viewTransition } = e;
    if (!viewTransition) return;
    clearNames();
    const activation = e.activation || null;
    const nextUrl = activation?.entry?.url || lastIntentUrl;
    lastIntentUrl = null;
    addTypes(viewTransition, directionOf(activation));
    nameElements(nextUrl);
  });

  // New page: runs at first render, prerender activation, or bfcache restore.
  window.addEventListener('pagereveal', (e) => {
    const { viewTransition } = e;
    clearNames();
    if (!viewTransition) return;
    if (!isPageReady()) {
      viewTransition.skipTransition();
      return;
    }
    const activation = window.navigation?.activation || null;
    const prevUrl = activation?.from?.url || document.referrer;
    addTypes(viewTransition, directionOf(activation));
    nameElements(prevUrl);
    viewTransition.finished.finally(clearNames);
  });

  // Names set in `pageswap` would otherwise survive in the back/forward cache.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) clearNames();
  });

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../styles/page-transitions.css', import.meta.url).href;
  document.head.append(link);

  addPrerenderRules();
})();
