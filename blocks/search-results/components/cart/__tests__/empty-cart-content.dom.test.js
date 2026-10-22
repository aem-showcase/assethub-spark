import {
  beforeEach, describe, expect, it,
} from 'vitest';
import { renderEmptyCartContent } from '../empty-cart-content.js';

beforeEach(() => {
  document.body.textContent = '';
});

describe('empty cart artwork', () => {
  it('provides a still cart for reduced motion without duplicating the empty-state message', () => {
    document.body.innerHTML = renderEmptyCartContent();

    const picture = document.querySelector('picture');
    const source = picture.querySelector('source');
    const image = picture.querySelector('img');

    expect(source.media).toBe('(prefers-reduced-motion: reduce)');
    expect(source.srcset).toBe('/icons/empty-cart-trolley.png');
    expect(image.getAttribute('src')).toBe('/icons/empty-cart-trolley.gif');
    expect(image.alt).toBe('');
    expect(image.width / image.height).toBe(370 / 320);
    expect(document.querySelector('.empty-state-header').textContent).toBe('Your cart is empty');
  });

  it('preserves supplied labels and navigation alongside the cart', () => {
    document.body.innerHTML = renderEmptyCartContent({
      message: 'Nothing selected',
      subHeaderMessage: 'Add assets to get started',
      homepageButtonText: 'Home',
    });

    expect(document.querySelector('.empty-state-header').textContent).toBe('Nothing selected');
    expect(document.querySelector('.cart-empty-sub-header').textContent).toBe('Add assets to get started');
    expect(document.querySelector('.cart-empty-links a').getAttribute('href')).toBe('/en/search');
    expect(document.querySelector('.homepage-button').getAttribute('href')).toBe('/en/');
    expect(document.querySelector('.homepage-button').textContent).toBe('Home');
  });

  it.each([
    [{ isDownload: true }, false],
    [{}, true],
  ])('keeps the download empty state text-only for options %j and flag %j', (options, flag) => {
    document.body.innerHTML = renderEmptyCartContent(options, flag);

    expect(document.querySelector('.empty-state-header')).not.toBeNull();
    expect(document.querySelector('picture, img')).toBeNull();
  });
});
