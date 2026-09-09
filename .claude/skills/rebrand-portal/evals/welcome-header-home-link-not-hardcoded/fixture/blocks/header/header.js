import { getMetadata } from '../../scripts/aem.js';
import { loadFragment } from '../../scripts/scripts.js';
import {
  getAppLabel,
  localizePath,
} from '../../scripts/locale-utils.js';

function isBrandContent(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.tagName === 'UL') return false;
  return Boolean(
    node.querySelector?.('.icon-frescopa-icon')
    || node.querySelector?.('a[href] .icon'),
  );
}

async function createNavBar(t) {
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : localizePath('/nav');
  const fragment = await loadFragment(navPath);
  const nav = document.createElement('nav');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);
  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  return navWrapper;
}

export default async function decorate(block) {
  block.textContent = '';

  if (getMetadata('header') === 'no') {
    // Minimal welcome-page header: just the brand logo, no nav or toolbar
    block.parentElement.style.height = 'var(--nav-height, 64px)';
    const welcomeBar = document.createElement('div');
    welcomeBar.className = 'header-welcome-bar';
    welcomeBar.innerHTML = `
      <a href="/" class="welcome-logo" aria-label="Home">
        <span class="icon icon-frescopa-icon">
          <img src="/icons/frescopa-icon.svg" alt="Fréscopa" loading="eager" />
        </span>
      </a>`;
    block.append(welcomeBar);
    return;
  }

  const t = await getAppLabel();
  block.append(await createNavBar(t));
}
