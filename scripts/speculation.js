/*
 * Prerendering (Speculation Rules) for smoother page transitions.
 *
 * Plain links are covered by the document rule added by `addPrerenderRules`. Cards that
 * navigate from JS (no <a> under the pointer) use `prerenderOnIntent`, which adds a list rule
 * once the pointer rests on the card. Chromium only; other browsers ignore all of this.
 *
 * Only read-only pages are prerendered. Anything that logs usage on load must wait for
 * `whenActivated` so a hover never counts as a visit or a search.
 */

const HOVER_DELAY_MS = 200;
const MAX_INTENT_URLS = 2;

// Keep in sync with PRERENDER_URL_PATTERNS below.
const BASE = String.raw`^(?:/companies/[^/]+)?(?:/(?:en|ja))?`;
const PRERENDER_PATHS = [
  new RegExp(`${BASE}/?$`), // home
  new RegExp(`${BASE}/search/?$`),
  new RegExp(`${BASE}/search-collections/?$`),
  new RegExp(`${BASE}/collection-details/?$`),
  new RegExp(`${BASE}/reports/(?:report-hub|searches|asset-activity)/?$`), // read-only reports
];

const PRERENDER_URL_PATTERNS = [
  '{/companies/:company}?{/:locale(en|ja)}?{/}?',
  '{/companies/:company}?{/:locale(en|ja)}?/search{/}?',
  '{/companies/:company}?{/:locale(en|ja)}?/search-collections{/}?',
  '{/companies/:company}?{/:locale(en|ja)}?/collection-details{/}?',
  '{/companies/:company}?{/:locale(en|ja)}?/reports/:report(report-hub|searches|asset-activity){/}?',
];

const intentUrls = [];
let intentRules = null;

export function supportsPrerender() {
  return typeof HTMLScriptElement !== 'undefined'
    && typeof HTMLScriptElement.supports === 'function'
    && HTMLScriptElement.supports('speculationrules');
}

/**
 * @param {string|URL} href
 * @returns {URL|null} same-origin URL on an allow-listed path, else null
 */
export function toPrerenderableUrl(href) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!PRERENDER_PATHS.some((re) => re.test(url.pathname))) return null;
  url.hash = '';
  return url;
}

/**
 * Runs `fn` now, or once a prerendered page is actually shown to the user.
 * @param {() => void} fn
 */
export function whenActivated(fn) {
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => fn(), { once: true });
  } else {
    fn();
  }
}

/**
 * Prerender allow-listed pages when the pointer rests on a plain link to them.
 */
export function addPrerenderRules() {
  if (!supportsPrerender() || document.querySelector('script[data-prerender-rules]')) return;
  const script = document.createElement('script');
  script.type = 'speculationrules';
  script.dataset.prerenderRules = '';
  script.textContent = JSON.stringify({
    prerender: [{
      where: {
        and: [
          { or: PRERENDER_URL_PATTERNS.map((pathname) => ({ href_matches: { pathname } })) },
          { not: { selector_matches: '[download], [target=_blank], .no-prerender' } },
        ],
      },
      eagerness: 'moderate',
    }],
  });
  document.head.append(script);
}

function writeIntentRules() {
  const next = document.createElement('script');
  next.type = 'speculationrules';
  next.textContent = JSON.stringify({
    prerender: [{ source: 'list', urls: [...intentUrls], eagerness: 'immediate' }],
  });
  // Insert the new rule set before removing the old one so a URL present in both keeps its
  // prerender instead of being cancelled and restarted.
  document.head.append(next);
  intentRules?.remove();
  intentRules = next;
}

export function prerenderUrl(href) {
  if (!supportsPrerender()) return;
  const url = toPrerenderableUrl(href);
  if (!url || url.href === window.location.href) return;
  if (intentUrls.includes(url.href)) return;
  intentUrls.push(url.href);
  while (intentUrls.length > MAX_INTENT_URLS) intentUrls.shift();
  writeIntentRules();
}

/**
 * Prerender `href` when the pointer rests on `el` (or is pressed on touch).
 * @param {Element} el
 * @param {string} href
 */
export function prerenderOnIntent(el, href) {
  if (!el || !supportsPrerender() || !toPrerenderableUrl(href)) return;
  let timer = null;
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(timer);
    timer = setTimeout(() => prerenderUrl(href), HOVER_DELAY_MS);
  });
  el.addEventListener('pointerleave', () => clearTimeout(timer));
  el.addEventListener('pointerdown', () => {
    clearTimeout(timer);
    prerenderUrl(href);
  });
  el.addEventListener('focusin', () => prerenderUrl(href));
}

export function resetForTests() {
  document.querySelectorAll('script[data-prerender-rules]').forEach((el) => el.remove());
  intentUrls.length = 0;
  intentRules?.remove();
  intentRules = null;
}
