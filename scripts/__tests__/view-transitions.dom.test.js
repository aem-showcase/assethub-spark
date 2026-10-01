import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  canAnimate,
  hasActiveTransition,
  runViewTransition,
  withTempName,
  isInViewport,
  toTransitionName,
  waitForImage,
} from '../view-transitions.js';

function mockMatchMedia(reduce) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce });
}

function mockStartViewTransition() {
  const fn = vi.fn((arg) => {
    const update = typeof arg === 'function' ? arg : arg.update;
    const updateCallbackDone = Promise.resolve().then(update);
    return {
      ready: updateCallbackDone,
      finished: updateCallbackDone,
      updateCallbackDone,
    };
  });
  document.startViewTransition = fn;
  return fn;
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  delete document.startViewTransition;
  vi.restoreAllMocks();
});

describe('canAnimate', () => {
  it('is false when the API is missing', () => {
    expect(canAnimate()).toBe(false);
  });

  it('is false when reduced motion is requested', () => {
    mockStartViewTransition();
    mockMatchMedia(true);
    expect(canAnimate()).toBe(false);
  });

  it('is true when supported and motion is allowed', () => {
    mockStartViewTransition();
    expect(canAnimate()).toBe(true);
  });
});

describe('runViewTransition', () => {
  it('runs the update synchronously without the API', () => {
    const update = vi.fn();
    expect(runViewTransition(update)).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update synchronously under reduced motion', () => {
    const start = mockStartViewTransition();
    mockMatchMedia(true);
    const update = vi.fn();
    runViewTransition(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('passes update and types to startViewTransition and runs update once', async () => {
    const start = mockStartViewTransition();
    const update = vi.fn();
    const transition = runViewTransition(update, { types: ['asset-open'] });
    expect(start).toHaveBeenCalledWith({ update, types: ['asset-open'] });
    await transition.finished;
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs setup and cleanup around the transition', async () => {
    mockStartViewTransition();
    const setup = vi.fn();
    const cleanup = vi.fn();
    const transition = runViewTransition(() => {}, { setup, cleanup });
    expect(setup).toHaveBeenCalledTimes(1);
    expect(hasActiveTransition()).toBe(true);
    await transition.finished;
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(hasActiveTransition()).toBe(false);
  });

  it('falls back without starting an overlapping transition', async () => {
    const updates = [];
    let finishFirst;
    document.startViewTransition = vi.fn((arg) => {
      const update = typeof arg === 'function' ? arg : arg.update;
      update();
      const finished = new Promise((resolve) => { finishFirst = resolve; });
      return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve() };
    });

    const first = runViewTransition(() => updates.push('first'));
    const cleanup = vi.fn();
    const second = runViewTransition(() => updates.push('second'), { cleanup });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(updates).toEqual(['first', 'second']);
    expect(cleanup).toHaveBeenCalledTimes(1);
    finishFirst();
    await first.finished;
  });

  it('falls back to the callback form when the options form throws', async () => {
    const start = vi.fn((arg) => {
      if (typeof arg !== 'function') throw new TypeError('unsupported');
      const done = Promise.resolve().then(arg);
      return { ready: done, finished: done, updateCallbackDone: done };
    });
    document.startViewTransition = start;
    const update = vi.fn();
    const transition = runViewTransition(update);
    await transition.finished;
    expect(start).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('swallows expected abort rejections', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const abort = Object.assign(new Error('skipped'), { name: 'AbortError' });
    document.startViewTransition = vi.fn(() => ({
      ready: Promise.reject(abort),
      finished: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
    }));
    runViewTransition(() => {});
    await new Promise((r) => { setTimeout(r, 0); });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('withTempName', () => {
  it('sets and clears the name and class', () => {
    const el = document.createElement('div');
    const cleanup = withTempName(el, 'asset-hero', 'asset-card');
    expect(el.style.viewTransitionName).toBe('asset-hero');
    cleanup();
    expect(el.style.viewTransitionName).toBe('');
  });

  it('is a no-op for a missing element', () => {
    expect(() => withTempName(null, 'x')()).not.toThrow();
  });
});

describe('isInViewport', () => {
  it('is false for detached or missing elements', () => {
    expect(isInViewport(null)).toBe(false);
    expect(isInViewport(document.createElement('div'))).toBe(false);
  });

  it('checks the bounding rect against the viewport', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const rect = (top) => ({
      top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100,
    });
    el.getBoundingClientRect = () => rect(10);
    expect(isInViewport(el)).toBe(true);
    el.getBoundingClientRect = () => rect(window.innerHeight + 50);
    expect(isInViewport(el)).toBe(false);
    expect(isInViewport(el, 100)).toBe(true);
    el.remove();
  });
});

describe('toTransitionName', () => {
  it('produces a valid custom ident', () => {
    expect(toTransitionName('card', 'urn:aaid:aem:1234-abcd'))
      .toBe('card-urn_aaid_aem_1234-abcd');
  });
});

describe('waitForImage', () => {
  it('resolves immediately for loaded or missing images', async () => {
    await expect(waitForImage(null)).resolves.toBeUndefined();
  });

  it('resolves after the timeout if decode never settles', async () => {
    vi.useFakeTimers();
    const img = { complete: false, decode: () => new Promise(() => {}) };
    const p = waitForImage(img, 300);
    vi.advanceTimersByTime(300);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
