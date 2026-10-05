import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  playExit,
  flyToCart,
  pulseConfirmation,
  animateHeight,
} from '../motion.js';

function setMotion(reduce) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: !reduce });
}

function fakeAnimation() {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  return { finished, finish };
}

beforeEach(() => {
  setMotion(false);
  Element.prototype.animate = vi.fn(() => fakeAnimation());
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  delete Element.prototype.animate;
});

describe('playExit', () => {
  it('leaves an inert ghost copy that is removed when the animation ends', async () => {
    document.body.innerHTML = '<div id="overlay" class="modal"><div class="base-panel" id="panel">Hi</div></div>';
    const el = document.getElementById('overlay');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 100 });
    const anims = [];
    Element.prototype.animate = vi.fn(() => {
      const a = fakeAnimation();
      anims.push(a);
      return a;
    });

    playExit(el);
    const ghost = document.querySelector('[data-exit-ghost]');
    expect(ghost).not.toBeNull();
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector('[id]')).toBeNull();
    expect(ghost.id).toBe('');

    anims.forEach((a) => a.finish());
    await Promise.all(anims.map((a) => a.finished));
    await new Promise((r) => { setTimeout(r, 0); });
    expect(document.querySelector('[data-exit-ghost]')).toBeNull();
  });

  it('does nothing when reduced motion is on', () => {
    setMotion(true);
    document.body.innerHTML = '<div id="overlay"></div>';
    playExit(document.getElementById('overlay'));
    expect(document.querySelector('[data-exit-ghost]')).toBeNull();
  });
});

describe('flyToCart', () => {
  it('does nothing without a cart icon', () => {
    document.body.innerHTML = '<img id="img">';
    flyToCart(document.getElementById('img'));
    expect(document.querySelector('.fly-to-header')).toBeNull();
  });

  it('does nothing when reduced motion is on', () => {
    setMotion(true);
    document.body.innerHTML = '<div class="nav-cart-icon"><button></button></div><img id="img">';
    flyToCart(document.getElementById('img'));
    expect(document.querySelector('.fly-to-header')).toBeNull();
  });

  it('flies to cart and highlights a rendered destination row', async () => {
    document.body.innerHTML = `
      <div class="nav-cart-icon"><button></button></div>
      <img id="img" src="https://example.com/asset.png">
      <div class="cart-asset-row" data-asset-id="asset-1"></div>`;
    const img = document.getElementById('img');
    Object.defineProperty(img, 'currentSrc', {
      value: 'https://example.com/asset.png',
      configurable: true,
    });
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 200, left: 100, right: 200, width: 100, height: 100,
    });
    vi.spyOn(document.querySelector('.nav-cart-icon button'), 'getBoundingClientRect')
      .mockReturnValue({
        top: 0, bottom: 40, left: 400, right: 440, width: 40, height: 40,
      });
    const animation = fakeAnimation();
    Element.prototype.animate = vi.fn(() => animation);

    flyToCart(img, 'asset-1');
    expect(document.querySelector('.fly-to-header')).not.toBeNull();
    animation.finish();
    await animation.finished;
    await Promise.resolve();
    expect(document.querySelector('.cart-asset-row').classList)
      .toContain('is-transition-arrival');
  });
});

describe('animateHeight', () => {
  it('runs the change and animates between the measured heights', () => {
    document.body.innerHTML = '<section id="s"></section>';
    const el = document.getElementById('s');
    const heights = [40, 200];
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ height: heights.shift() }));
    const change = vi.fn();

    animateHeight(() => el, change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(el.animate).toHaveBeenCalledWith(
      [{ height: '40px' }, { height: '200px' }],
      expect.objectContaining({ duration: 220 }),
    );
  });

  describe('pulseConfirmation', () => {
    it('animates a connected element when motion is allowed', () => {
      const el = document.createElement('div');
      document.body.append(el);
      expect(pulseConfirmation(el)).not.toBeNull();
      expect(el.animate).toHaveBeenCalledTimes(1);
    });
  });

  it('only runs the change when reduced motion is on', () => {
    setMotion(true);
    document.body.innerHTML = '<section id="s"></section>';
    const change = vi.fn();
    animateHeight(() => document.getElementById('s'), change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });
});
