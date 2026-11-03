const DELIVERY_ORIGIN = 'https://delivery-p203220-e2129061.adobeaemcloud.com';
const IMAGE_PATH = /^\/adobe\/assets\/urn:aaid:aem:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:original\/)?as\/[^/]+\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

/**
 * Render DM image references through the portal's authenticated proxy.
 * Other links, including references to other repositories, remain links.
 * @param {Element} main Content to decorate before blocks are built.
 */
export default function decorateDmImages(main) {
  main.querySelectorAll('a[href]').forEach((link) => {
    if (!URL.canParse(link.href)) return;
    const url = new URL(link.href);
    if (url.origin !== DELIVERY_ORIGIN || url.username || url.password
      || !IMAGE_PATH.test(url.pathname)) return;

    // EDS unwraps a block cell's sole paragraph, leaving its link directly in a div.
    const container = link.closest('p')
      || (link.parentElement.tagName === 'DIV' ? link.parentElement : null);
    if (!container
      || container.querySelectorAll('a').length !== 1
      || container.querySelector('img')) return;

    const picture = document.createElement('picture');
    const image = document.createElement('img');
    const title = link.getAttribute('title')?.trim();
    const text = link.textContent.trim();
    image.alt = [title, text].find((value) => value && !/^https?:\/\//i.test(value)) || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      picture.classList.add('missing');
      // eslint-disable-next-line no-console
      console.error('[DM images] Failed to load asset through the portal proxy:', image.src);
    });
    image.src = `/api${url.pathname}${url.search}`;
    picture.append(image);
    link.replaceWith(picture);
  });
}
