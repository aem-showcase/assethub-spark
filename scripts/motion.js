/*
 * Small motion helpers (progressive enhancement, reduced-motion aware).
 *
 * - playExit: animates a copy of an overlay out while the real one is removed/hidden right
 *   away, so existing close logic and open/closed state stay synchronous.
 * - flyToCart: a thumbnail flies from its card into the header cart icon.
 * - animateHeight: smooth expand/collapse around a synchronous DOM change.
 */

const EXIT_MS = 180;
const FLY_MS = 650;
const FLY_END_SIZE = 24;

const PANEL_SELECTOR = [
  '.base-panel',
  '.download-renditions-modal',
  '.global-modal-container',
  '.add-to-collection-modal-content',
  '.email-preview-modal-content',
].join(', ');

export function prefersMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches
    && typeof Element.prototype.animate === 'function';
}

/**
 * Play a close animation for an overlay that is about to be removed or hidden.
 * Call it right before `el.remove()` / `el.style.display = 'none'`.
 * @param {HTMLElement|null} el overlay element (still visible)
 * @param {string} [panelSelector] inner panel that shrinks while the overlay fades
 * @returns {HTMLElement|null} the temporary copy (for tests)
 */
export function playExit(el, panelSelector = PANEL_SELECTOR) {
  if (!el?.isConnected || !el.parentNode || !prefersMotion()) return null;
  if (el.style.display === 'none' || getComputedStyle(el).display === 'none') return null;

  const ghost = el.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.dataset.exitGhost = '';
  ghost.style.pointerEvents = 'none';
  el.after(ghost);

  // Keep the panel's scroll position so the copy matches what the user saw
  const panel = el.matches(panelSelector) ? el : el.querySelector(panelSelector);
  const ghostPanel = ghost.matches(panelSelector) ? ghost : ghost.querySelector(panelSelector);
  if (panel && ghostPanel) ghostPanel.scrollTop = panel.scrollTop;

  const timing = { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' };
  const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  if (ghostPanel && ghostPanel !== ghost) {
    ghostPanel.animate([
      { transform: 'none' },
      { transform: 'translateY(8px) scale(0.96)' },
    ], timing);
  }
  const cleanup = () => ghost.remove();
  fade.finished.then(cleanup, cleanup);
  return ghost;
}

function cartTarget() {
  const el = document.querySelector('.nav-cart-icon button, .nav-cart-icon');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? { el, rect } : null;
}

/**
 * Fly a copy of `sourceImg` into the header cart icon, then bump the icon.
 * @param {HTMLImageElement|null} sourceImg
 * @returns {Animation|null}
 */
export function flyToCart(sourceImg) {
  const target = cartTarget();
  if (!sourceImg || !target || !prefersMotion()) return null;
  const from = sourceImg.getBoundingClientRect();
  const src = sourceImg.currentSrc || sourceImg.src;
  if (!src || from.width === 0 || from.height === 0) return null;

  const flyer = document.createElement('img');
  flyer.src = src;
  flyer.alt = '';
  flyer.className = 'fly-to-cart';
  flyer.setAttribute('aria-hidden', 'true');
  Object.assign(flyer.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  document.body.append(flyer);

  const dx = (target.rect.left + target.rect.width / 2) - (from.left + from.width / 2);
  const dy = (target.rect.top + target.rect.height / 2) - (from.top + from.height / 2);
  const scale = FLY_END_SIZE / Math.max(from.width, from.height);
  const midScale = Math.max(scale, 0.45);

  const flight = flyer.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: '8px' },
    {
      offset: 0.35,
      transform: `translate(${dx * 0.2}px, ${dy * 0.2 - 40}px) scale(${midScale})`,
      opacity: 1,
      borderRadius: '12px',
    },
    {
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      opacity: 0.4,
      borderRadius: '50%',
    },
  ], { duration: FLY_MS, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'forwards' });

  const land = () => {
    flyer.remove();
    const icon = target.el.closest('.nav-cart-icon') || target.el;
    icon.classList.remove('is-bumped');
    // Restart the bump animation on repeated adds
    // eslint-disable-next-line no-unused-expressions
    icon.offsetWidth;
    icon.classList.add('is-bumped');
    icon.addEventListener('animationend', () => icon.classList.remove('is-bumped'), { once: true });
  };
  flight.finished.then(land, () => flyer.remove());
  return flight;
}

/**
 * Run a synchronous DOM change and animate the element's height from before to after,
 * e.g. expanding/collapsing a section. `getEl` is called before and after `change`, so it
 * also works when the change re-renders (replaces) the element.
 * @param {() => HTMLElement|null} getEl
 * @param {() => void} change
 * @param {{ duration?: number, fadeSelector?: string }} [options]
 * @returns {Animation|null}
 */
export function animateHeight(getEl, change, { duration = 220, fadeSelector } = {}) {
  const before = prefersMotion() ? getEl() : null;
  const from = before ? before.getBoundingClientRect().height : 0;
  change();
  if (!before || !from) return null;
  const el = getEl();
  if (!el) return null;
  const to = el.getBoundingClientRect().height;
  if (!to || Math.abs(to - from) < 2) return null;

  const { overflow } = el.style;
  el.style.overflow = 'hidden';
  const anim = el.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  );
  if (to > from && fadeSelector) {
    el.querySelectorAll(fadeSelector).forEach((node) => {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
    });
  }
  const restore = () => { el.style.overflow = overflow; };
  anim.finished.then(restore, restore);
  return anim;
}
