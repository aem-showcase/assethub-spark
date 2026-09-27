import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  toPrerenderableUrl,
  whenActivated,
  prerenderUrl,
  prerenderOnIntent,
  resetForTests,
} from '../speculation.js';

function rules() {
  return [...document.head.querySelectorAll('script[type="speculationrules"]')]
    .map((s) => JSON.parse(s.textContent).prerender[0].urls);
}

beforeEach(() => {
  HTMLScriptElement.supports = vi.fn((type) => type === 'speculationrules');
});

afterEach(() => {
  resetForTests();
  delete HTMLScriptElement.supports;
  vi.useRealTimers();
});

describe('toPrerenderableUrl', () => {
  it.each([
    '/', '/en/', '/en', '/ja/search?query=x', '/search', '/en/search-collections',
    '/en/collection-details?id=1', '/companies/acme/en/search',
    '/en/reports/report-hub', '/reports/searches', '/companies/acme/ja/reports/asset-activity',
  ])('allows %s', (path) => {
    expect(toPrerenderableUrl(path)).not.toBeNull();
  });

  it.each([
    '/auth/logout', '/login', '/api/user', '/en/report-hub', '/en/searches',
    'https://example.com/en/search', '/en/search/assets',
    '/en/reports/other', '/en/reports/searches/export',
  ])('rejects %s', (path) => {
    expect(toPrerenderableUrl(path)).toBeNull();
  });
});

describe('whenActivated', () => {
  afterEach(() => {
    delete document.prerendering;
  });

  it('runs immediately on a normal page', () => {
    const fn = vi.fn();
    whenActivated(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for prerenderingchange on a prerendered page', () => {
    Object.defineProperty(document, 'prerendering', { value: true, configurable: true });
    const fn = vi.fn();
    whenActivated(fn);
    expect(fn).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('prerenderUrl', () => {
  it('keeps a single rule set with at most two URLs', () => {
    prerenderUrl('/en/search?a=1');
    prerenderUrl('/en/search?a=2');
    prerenderUrl('/en/search?a=3');
    const sets = rules();
    expect(sets).toHaveLength(1);
    expect(sets[0].map((u) => new URL(u).search)).toEqual(['?a=2', '?a=3']);
  });

  it('does nothing when speculation rules are unsupported', () => {
    delete HTMLScriptElement.supports;
    prerenderUrl('/en/search');
    expect(rules()).toHaveLength(0);
  });

  it('ignores URLs outside the allow-list', () => {
    prerenderUrl('/auth/logout');
    expect(rules()).toHaveLength(0);
  });
});

describe('prerenderOnIntent', () => {
  it('prerenders after the pointer rests on the element', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    prerenderOnIntent(el, '/en/search?facetFilters=coffee');
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    expect(rules()).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(rules()).toHaveLength(1);
  });

  it('does not prerender if the pointer leaves quickly', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    prerenderOnIntent(el, '/en/search');
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(500);
    expect(rules()).toHaveLength(0);
  });

  it('prerenders immediately on pointerdown', () => {
    const el = document.createElement('div');
    prerenderOnIntent(el, '/en/search');
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
    expect(rules()).toHaveLength(1);
  });
});
