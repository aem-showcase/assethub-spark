import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import {
  getBasePrefix, hasLocalePrefix, getExplicitLocalePrefix, getCurrentLocale,
} from '../locale-utils.js';

// Drive the URL-based company-base derivation for the NESTED layout
// (/companies/<company>/<locale>/...), the root site (/<locale>/...), and boundary pages
// (/404.html with a remembered base). window.location + sessionStorage are mocked per test.
const realLocation = window.location;

function setPath(pathname) {
  delete window.location;
  window.location = { pathname, search: '', hash: '' };
}

beforeEach(() => {
  try { window.sessionStorage.clear(); } catch { /* jsdom provides it */ }
});

afterEach(() => {
  window.location = realLocation;
});

describe('locale-utils — nested /companies/<company> base', () => {
  it('getBasePrefix returns /companies/<company> on a nested demo path', () => {
    setPath('/companies/volkswagen/en/search');
    expect(getBasePrefix()).toBe('/companies/volkswagen');
  });

  it('getBasePrefix returns "" on the root site', () => {
    setPath('/en/search');
    expect(getBasePrefix()).toBe('');
  });

  it('does NOT treat the container word as the base without a company+locale', () => {
    // /companies alone (no company/locale) must not be mistaken for a demo base.
    setPath('/companies');
    expect(getBasePrefix()).toBe('');
  });

  it('hasLocalePrefix true for nested /companies/<company>/<locale>/...', () => {
    setPath('/companies/volkswagen/en/');
    expect(hasLocalePrefix()).toBe(true);
  });

  it('hasLocalePrefix true for root /<locale>/...', () => {
    setPath('/ja/search');
    expect(hasLocalePrefix()).toBe(true);
  });

  it('hasLocalePrefix false when the base is present but no locale segment', () => {
    // /companies/<company>/ with no locale yet
    setPath('/companies/volkswagen/');
    expect(hasLocalePrefix()).toBe(false);
  });

  it('getExplicitLocalePrefix keeps the company base + locale for a nested demo', () => {
    setPath('/companies/volkswagen/ja/search');
    expect(getExplicitLocalePrefix()).toBe('/companies/volkswagen/ja');
  });

  it('getExplicitLocalePrefix returns just /<locale> on the root site', () => {
    setPath('/en/search');
    expect(getExplicitLocalePrefix()).toBe('/en');
  });

  it('getCurrentLocale reads the locale AFTER the company base (not the container)', () => {
    setPath('/companies/volkswagen/ja/collection-details');
    // The bug this guards: a naive split()[1] would return "companies".
    expect(getCurrentLocale()).toBe('ja');
  });

  it('boundary page (/404.html) keeps localized links inside the remembered company base', () => {
    // First visit a nested page so the base is remembered...
    setPath('/companies/volkswagen/en/search');
    getBasePrefix();
    // ...then land on a base-less boundary page.
    setPath('/404.html');
    expect(getExplicitLocalePrefix()).toBe('/companies/volkswagen/en');
  });
});
