import { loadCSS } from '../../scripts/aem.js';

/**
 * Hero collage: diagonal (parallelogram) image panels that end in a solid
 * brand panel carrying the page headline.
 *
 * Authoring:
 *   row 1: one cell per image panel; empty cells show an error message
 *   row 2: headline content (optional eyebrow paragraph before the h1,
 *          supporting copy after it)
 * @param {Element} block
 */
export default async function decorate(block) {
  await loadCSS(new URL('./hero-collage.css?v=20261103-flexible-panels', import.meta.url).href);

  const rows = [...block.children];
  const contentRow = rows.length > 1 ? rows[rows.length - 1] : null;
  const imageCells = rows[0] && rows.length > 1 ? [...rows[0].children] : [];

  const collage = document.createElement('div');
  collage.className = 'hero-collage-inner';
  collage.style.setProperty('--panel-count', Math.max(1, imageCells.length).toString());
  if (!imageCells.length) collage.classList.add('is-text-only');

  imageCells.forEach((cell, i) => {
    const panel = document.createElement('div');
    panel.className = `hero-collage-panel p${i + 1}`;
    panel.style.setProperty('--panel-index', i.toString());
    const picture = cell.querySelector('picture');
    if (picture) {
      const img = picture.querySelector('img');
      if (img && i === 0) {
        img.loading = 'eager';
        img.fetchPriority = 'high';
      }
      panel.append(picture);
    } else {
      panel.classList.add('is-empty');
    }
    collage.append(panel);
  });

  const brand = document.createElement('div');
  brand.className = 'hero-collage-brand';
  const inner = document.createElement('div');
  inner.className = 'hero-collage-content';
  const source = contentRow || rows[0];
  if (source) {
    inner.append(...[...source.children].flatMap((cell) => [...cell.childNodes]));
    const heading = inner.querySelector('h1, h2');
    const first = inner.firstElementChild;
    if (first && heading && first !== heading && first.tagName === 'P') {
      first.classList.add('hero-collage-eyebrow');
    }
  }
  brand.append(inner);
  collage.append(brand);

  block.replaceChildren(collage);
}
