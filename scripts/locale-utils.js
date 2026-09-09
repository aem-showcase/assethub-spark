/**
 * Locale utilities for the Spark EDS application.
 * Provides locale detection, path localization, and application label retrieval.
 */

// Supported locales
const SUPPORTED_LOCALES = ['en', 'ja'];
const DEFAULT_LOCALE = 'en';
const LOCALE_STORAGE_KEY = 'spark-preferred-locale';
// Remembers the foldered-demo company base (e.g. '/volkswagen') so localized links stay
// in-folder on boundary pages (404, root-served) where the URL drops the /<company> segment.
const COMPANY_BASE_KEY = 'spark-company-base';

/** EDS locale to AEM content path segment (country/locale) */
const LOCALE_TO_AEM_SEGMENT = { en: 'us/en', ja: 'jp/ja' };

/**
 * Gets the AEM content path segment for a locale (for /content/share/{segment}/...).
 * @param {string} locale - EDS locale code (e.g. 'en' or 'ja')
 * @returns {string} AEM segment (e.g. 'us/en' or 'jp/ja')
 */
export function getAemLocaleSegment(locale) {
  return LOCALE_TO_AEM_SEGMENT[locale] || LOCALE_TO_AEM_SEGMENT[DEFAULT_LOCALE];
}

// Cache for loaded application labels
const appLabelsCache = {};

/**
 * Saves the user's locale preference to localStorage.
 * @param {string} locale - The locale code to save (e.g., 'en' or 'ja')
 */
export function saveLocalePreference(locale) {
  if (SUPPORTED_LOCALES.includes(locale)) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch (e) {
      // localStorage may be unavailable (private browsing, etc.)
    }
  }
}

/**
 * Gets the user's saved locale preference from localStorage.
 * @returns {string|null} The saved locale code, or null if none saved
 */
export function getSavedLocalePreference() {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved && SUPPORTED_LOCALES.includes(saved)) {
      return saved;
    }
  } catch (e) {
    // localStorage may be unavailable
  }
  return null;
}

// Container folder for foldered company demos. A demo is served under
// /<COMPANIES_CONTAINER>/<company>/<locale>/... so the DA/content root stays uncluttered.
// Keep in sync with COMPANIES_CONTAINER in the rebrand-portal skill's asset constants.
const COMPANIES_CONTAINER = 'companies';

/**
 * Detects a foldered company demo base from the CURRENT URL, if present.
 * A demo path is /companies/<company>/<locale>/..., so the base is the first TWO segments
 * (/companies/<company>) and the locale is the THIRD. Returns the base and the index of the
 * locale segment, or null when the current URL carries no company base.
 * @returns {{ base: string, localeIndex: number } | null}
 */
function detectCompanyBaseFromPath() {
  const segments = window.location.pathname.split('/');
  const company = segments[2];
  if (segments[1] === COMPANIES_CONTAINER && company && !SUPPORTED_LOCALES.includes(company)) {
    // /companies/<company>/...  -> base is /companies/<company>, locale (if any) at index 3.
    return { base: `/${COMPANIES_CONTAINER}/${company}`, localeIndex: 3 };
  }
  return null;
}

/**
 * Returns the foldered-demo company base (e.g. '/companies/volkswagen') for the current URL,
 * or '' on the root site. Remembers the last-seen base so boundary pages (e.g. /404.html)
 * that drop the company segment can still keep localized links inside the company folder.
 * @returns {string} The company base path, or '' when none.
 */
export function getBasePrefix() {
  const detected = detectCompanyBaseFromPath();
  if (detected) {
    try {
      sessionStorage.setItem(COMPANY_BASE_KEY, detected.base);
    } catch (e) { /* storage may be unavailable */ }
    return detected.base;
  }
  // No company segment in the current URL: fall back to the last-seen base (if any) so a
  // 404/root-served page keeps localized links inside /companies/<company>. Empty on root.
  try {
    return sessionStorage.getItem(COMPANY_BASE_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Checks if the current URL path has an explicit locale prefix. Handles both the
 * root site (/<locale>/...) and a foldered company demo (/companies/<company>/<locale>/...).
 * @returns {boolean} True if a supported locale is present in the path
 */
export function hasLocalePrefix() {
  const segments = window.location.pathname.split('/');
  // Root site: /<locale>/...
  if (segments[1] && SUPPORTED_LOCALES.includes(segments[1])) return true;
  // Foldered demo: /companies/<company>/<locale>/...
  const detected = detectCompanyBaseFromPath();
  if (detected && SUPPORTED_LOCALES.includes(segments[detected.localeIndex])) return true;
  return false;
}

/**
 * Checks if the user should be redirected to their preferred locale.
 * Only redirects if:
 * - User has a saved preference
 * - Current URL has no explicit locale prefix (legacy URL)
 * - Saved preference differs from default
 * @returns {string|null} The URL to redirect to, or null if no redirect needed
 */
export function getLocaleRedirectUrl() {
  // Only redirect if there's no explicit locale in the URL
  if (hasLocalePrefix()) {
    return null;
  }

  const { pathname, search, hash } = window.location;
  const savedLocale = getSavedLocalePreference();

  // Root path: always redirect to locale-prefixed root
  if (pathname === '/') {
    const locale = savedLocale || DEFAULT_LOCALE;
    return `/${locale}/${search}${hash}`;
  }

  // Other paths: only redirect if saved locale differs from default
  if (savedLocale && savedLocale !== DEFAULT_LOCALE) {
    return `/${savedLocale}${pathname}${search}${hash}`;
  }

  return null;
}

/**
 * Gets the explicit locale prefix from the current URL path (if present).
 * @returns {string} The locale prefix (e.g., '/en' or '/ja') or empty string if none
 */
export function getExplicitLocalePrefix() {
  const segments = window.location.pathname.split('/');

  // Root site: /<locale>/...
  if (segments[1] && SUPPORTED_LOCALES.includes(segments[1])) {
    return `/${segments[1]}`;
  }

  // Foldered company demo: /companies/<company>/<locale>/... -> keep the company base in the
  // prefix so every localized link/fetch stays inside the company folder.
  const detected = detectCompanyBaseFromPath();
  if (detected) {
    const locale = segments[detected.localeIndex];
    if (SUPPORTED_LOCALES.includes(locale)) {
      return `${detected.base}/${locale}`;
    }
  }

  // Boundary page in a foldered demo (e.g. /404.html): the URL has no company/locale segment,
  // but a remembered company base exists -> keep localized links inside the company default
  // locale.
  const base = getBasePrefix();
  if (base) {
    return `${base}/${DEFAULT_LOCALE}`;
  }

  return '';
}

/**
 * Gets the locale prefix from the current URL path.
 * @returns {string} The locale prefix (e.g., '/en' or '/ja'), defaults to '/en'
 */
export function getLocalePrefixFromPath() {
  const explicitPrefix = getExplicitLocalePrefix();
  return explicitPrefix || `/${DEFAULT_LOCALE}`;
}

/**
 * Gets the current locale code.
 * @returns {string} The locale code (e.g., 'en' or 'ja')
 */
export function getCurrentLocale() {
  const prefix = getLocalePrefixFromPath();
  // prefix may be '/en' (root) or '/<company>/en' (demo); the locale is the last segment.
  return prefix ? prefix.split('/').pop() : DEFAULT_LOCALE;
}

/**
 * Localizes a path by adding the current locale prefix if needed.
 * Handles both absolute paths and relative paths.
 * @param {string} path - The path to localize
 * @returns {string} The localized path
 */
export function localizePath(path) {
  if (!path) return path;

  const localePrefix = getLocalePrefixFromPath();

  // If no locale prefix needed, return original path
  if (!localePrefix) return path;

  // If path already has the locale prefix, return as-is
  if (path.startsWith(localePrefix)) return path;

  // Handle absolute paths
  if (path.startsWith('/')) {
    // Don't add prefix to special paths like /api, /icons, /scripts, /styles
    const specialPaths = ['/api', '/icons', '/scripts', '/styles', '/auth', '/media_'];
    if (specialPaths.some((sp) => path.startsWith(sp))) {
      return path;
    }
    return `${localePrefix}${path}`;
  }

  return path;
}

/**
 * Removes the locale prefix from a path.
 * @param {string} path - The path to strip
 * @returns {string} The path without locale prefix
 */
export function stripLocalePrefix(path) {
  if (!path) return path;

  const localePrefix = getLocalePrefixFromPath();
  if (localePrefix && path.startsWith(localePrefix)) {
    return path.substring(localePrefix.length) || '/';
  }

  return path;
}

/**
 * Loads and caches application-level labels for the current locale.
 * Returns a function to retrieve individual labels.
 * @returns {Promise<Function>} A function that takes a key and fallback,
 *  returns the localized string
 */
export async function getAppLabel() {
  const locale = getCurrentLocale();

  if (!appLabelsCache[locale]) {
    try {
      const response = await fetch(`/scripts/locales/${locale}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load app labels for locale: ${locale}`);
      }
      appLabelsCache[locale] = await response.json();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error loading app labels for ${locale}:`, error);
      // Fallback to empty object to prevent repeated errors
      appLabelsCache[locale] = {};
    }
  }

  // Return a function that can be used to retrieve labels
  return (key, fallback) => appLabelsCache[locale][key] || fallback || key;
}

/**
 * Preloads application labels for the current locale.
 * Call this early in the page lifecycle to avoid delays.
 * @returns {Promise<void>}
 */
export async function preloadAppLabels() {
  await getAppLabel();
}
