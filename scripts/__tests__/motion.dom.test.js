import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { playExit, flyToCart, animateHeight } from '../motion.js';

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
    expect(document.querySelector('.fly-to-cart')).toBeNull();
  });

  it('does nothing when reduced motion is on', () => {
    setMotion(true);
    document.body.innerHTML = '<div class="nav-cart-icon"><button></button></div><img id="img">';
    flyToCart(document.getElementById('img'));
    expect(document.querySelector('.fly-to-cart')).toBeNull();
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

  it('only runs the change when reduced motion is on', () => {
    setMotion(true);
    document.body.innerHTML = '<section id="s"></section>';
    const change = vi.fn();
    animateHeight(() => document.getElementById('s'), change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });
});
