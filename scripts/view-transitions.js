/**
 * Progressive-enhancement helpers for the same-document View Transition API.
 * When unsupported (or reduced motion is requested) updates run synchronously
 * without animation, so callers never need their own fallback.
 */

const EXPECTED_ERRORS = new Set(['AbortError', 'InvalidStateError', 'TimeoutError']);

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function canAnimate() {
  return typeof document.startViewTransition === 'function'
    && !prefersReducedMotion()
    && document.visibilityState !== 'hidden';
}

function swallow(promise) {
  promise?.catch?.((err) => {
    if (!EXPECTED_ERRORS.has(err?.name)) {
      // eslint-disable-next-line no-console
      console.warn('[view-transitions]', err);
    }
  });
}

/**
 * Run a DOM update inside a view transition when possible.
 * @param {Function} update - Sync or async function that mutates the DOM
 * @param {Object} [options]
 * @param {string[]} [options.types] - Transition types (for :active-view-transition-type)
 * @returns {ViewTransition|null} The transition, or null when run without animation
 */
export function runViewTransition(update, { types = [] } = {}) {
  if (!canAnimate()) {
    update();
    return null;
  }

  let transition;
  try {
    transition = document.startViewTransition({ update, types });
  } catch (_e) {
    // Older engines only accept the callback form
    transition = document.startViewTransition(update);
  }

  swallow(transition.ready);
  swallow(transition.finished);
  // If the update callback throws, the DOM change still needs to surface to callers
  swallow(transition.updateCallbackDone);
  return transition;
}

/**
 * Set an inline view-transition-name and return a cleanup function.
 */
export function withTempName(el, name, className) {
  if (!el) return () => {};
  el.style.viewTransitionName = name;
  if (className) el.style.viewTransitionClass = className;
  return () => {
    el.style.viewTransitionName = '';
    if (className) el.style.viewTransitionClass = '';
  };
}

/**
 * Is the element connected and (at least partly) inside the viewport?
 * @param {number} [margin=0] - Extra pixels around the viewport to include
 */
export function isInViewport(el, margin = 0) {
  if (!el?.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  return rect.bottom > -margin && rect.top < vh + margin
    && rect.right > -margin && rect.left < vw + margin;
}

/**
 * Convert an arbitrary string (e.g. asset id "urn:aaid:aem:…") into a CSS <custom-ident>.
 */
export function toTransitionName(prefix, value) {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}-${safe}`;
}

/**
 * Wait for an image to decode, but never longer than `timeoutMs`.
 */
export function waitForImage(img, timeoutMs = 300) {
  if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();
  const decoded = typeof img.decode === 'function'
    ? img.decode().catch(() => {})
    : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  return Promise.race([
    decoded,
    new Promise((resolve) => { setTimeout(resolve, timeoutMs); }),
  ]);
}
