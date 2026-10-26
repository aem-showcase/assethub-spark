/**
 * Empty cart / download panel content.
 */

import { localizePath } from '../../../../scripts/locale-utils.js';

export function renderEmptyCartContent(options = {}, isDownload = false) {
  const {
    message = 'Your cart is empty',
    subHeaderMessage = 'You have no items in your cart',
    homepageButtonText = 'Go to Homepage',
    isDownload: isDownloadOption,
  } = options;
  const isDownloadMode = isDownloadOption === true || isDownload === true;

  if (isDownloadMode) {
    return `
    <div class="empty-content-wrapper">
      <div class="empty-state">
        <div class="empty-state-message">
          <div class="empty-state-header">${message}</div>
        </div>
      </div>
    </div>
  `;
  }

  const homePath = localizePath('/');
  const searchPath = localizePath('/search');

  return `
    <div class="empty-content-wrapper">
      <div class="empty-state">
        <div class="empty-state-message">
          <picture>
            <source media="(prefers-reduced-motion: reduce)"
              srcset="/icons/empty-cart-trolley.png">
            <img class="cart-loader"
              src="/icons/empty-cart-trolley.gif" width="370" height="320" alt="">
          </picture>
          <div class="empty-state-header">${message}</div>
          <div class="cart-empty-sub-header">${subHeaderMessage}</div>
          <div class="cart-empty-links">
            <a href="${searchPath}">Search Assets</a>
          </div>
          <a href="${homePath}" class="primary-button homepage-button">${homepageButtonText}</a>
        </div>
      </div>
    </div>
  `;
}

export default renderEmptyCartContent;
