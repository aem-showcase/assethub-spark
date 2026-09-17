import { describe, it, expect } from 'vitest';
import { detectGate, resolveExcatRoot } from '../../scripts/rebrand/extract-brand.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Gate detection is the difference between "we measured the source site" and
 * "we measured whatever page the source site handed us". It is the single most
 * important behaviour in extraction, because its failure mode is silent: an
 * interstitial extracts perfectly cleanly and returns real, plausible, wrong
 * values that then become the customer's brand.
 *
 * The three signals are tested INDEPENDENTLY. On heineken.com all three happen
 * to fire at once, which would let two broken detectors hide behind one working
 * one — so each is exercised alone below.
 */

const REAL = {
  requestedUrl: 'https://www.hyundai.com/in/en',
  finalUrl: 'https://www.hyundai.com/in/en',
  title: 'Hyundai India',
  result: { spacing: { navHeight: '71px', contentMaxWidth: '100%' } },
};

describe('detectGate', () => {
  it('passes a real content page', () => {
    expect(detectGate(REAL)).toEqual([]);
  });

  it('signal 1 alone: redirected to a gate-shaped path', () => {
    const s = detectGate({
      ...REAL,
      finalUrl: 'https://www.heineken.com/in/en/agegateway/?returnUrl=%2fin%2fen%2f',
      requestedUrl: 'https://www.heineken.com/in/en/',
    });
    expect(s.join(' ')).toMatch(/redirected/);
  });

  it('signal 2 alone: the document says it is an interstitial', () => {
    const s = detectGate({ ...REAL, title: 'AgeGateway' });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/interstitial/);
  });

  it('signal 3 alone: degenerate yield', () => {
    // A page with neither a nav height nor a content column is not a content page,
    // however healthy its colours look.
    const s = detectGate({ ...REAL, result: { spacing: { navHeight: '', contentMaxWidth: '' } } });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/degenerate yield/);
  });

  it('the real Heineken observation fires all three', () => {
    const s = detectGate({
      requestedUrl: 'https://www.heineken.com/in/en/',
      finalUrl: 'https://www.heineken.com/in/en/agegateway/?returnUrl=%2fin%2fen%2f',
      title: 'AgeGateway',
      result: { spacing: { navHeight: '', contentMaxWidth: '' } },
    });
    expect(s).toHaveLength(3);
  });

  it('does not fire on a page that merely lacks a max-width', () => {
    // Requiring BOTH spacing signals keeps this from firing on full-bleed layouts.
    // Hyundai itself reports contentMaxWidth "100%", which must not read as absent.
    expect(detectGate({ ...REAL, result: { spacing: { navHeight: '71px', contentMaxWidth: 'none' } } })).toEqual([]);
  });

  it('does not fire on a benign same-site redirect', () => {
    // Trailing-slash and index normalisation are not gates.
    expect(detectGate({
      ...REAL,
      requestedUrl: 'https://www.hyundai.com/in/en',
      finalUrl: 'https://www.hyundai.com/in/en/',
    })).toEqual([]);
  });

  it('treats a cross-host redirect as suspicious even without a gate-shaped path', () => {
    const s = detectGate({
      ...REAL,
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://consent.cdn.example.net/landing',
    });
    expect(s.join(' ')).toMatch(/redirected/);
  });

  it('catches cookie walls and bot challenges, not just age gates', () => {
    expect(detectGate({ ...REAL, title: 'Just a moment...' })).toHaveLength(1);
    expect(detectGate({ ...REAL, title: 'Cookie Consent' })).toHaveLength(1);
    expect(detectGate({ ...REAL, title: 'Attention Required! | Cloudflare' })).toHaveLength(1);
  });

  it('survives an unparseable URL without throwing', () => {
    expect(() => detectGate({ ...REAL, finalUrl: 'not a url' })).not.toThrow();
  });
});

describe('resolveExcatRoot', () => {
  it('prefers an explicit EXCAT_ROOT when it carries the extractor', () => {
    const root = mkdtempSync(join(tmpdir(), 'excat-'));
    mkdirSync(join(root, 'sub-agents', 'excat-block-design-expert'), { recursive: true });
    writeFileSync(join(root, 'sub-agents', 'excat-block-design-expert', 'brand-extract.js'), '() => ({})');
    expect(resolveExcatRoot({ EXCAT_ROOT: root, HOME: '/nonexistent' })).toBe(root);
  });

  it('ignores a candidate that does not actually contain the extractor', () => {
    // An env var pointing at the wrong directory must fall through, not "succeed"
    // and fail later with a confusing read error.
    const empty = mkdtempSync(join(tmpdir(), 'excat-empty-'));
    expect(resolveExcatRoot({ EXCAT_ROOT: empty, HOME: '/nonexistent' })).toBeNull();
  });

  it('returns null rather than throwing when excat is absent', () => {
    expect(resolveExcatRoot({ HOME: '/nonexistent' })).toBeNull();
  });

  it('picks the highest installed version from the plugin cache', () => {
    // Versions sort numerically: 2.1.10 must beat 2.1.9, which a plain string
    // sort would get wrong.
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const base = join(home, '.claude', 'plugins', 'cache', 'excat-marketplace', 'excat');
    for (const v of ['2.1.9', '2.1.10']) {
      const d = join(base, v, 'sub-agents', 'excat-block-design-expert');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'brand-extract.js'), '() => ({})');
    }
    expect(resolveExcatRoot({ HOME: home })).toBe(join(base, '2.1.10'));
  });
});

describe('the excat extractor contract', () => {
  // These are the two traps that make hand-rolled invocation fail silently.
  // Asserting them against the INSTALLED file means an upstream change that
  // invalidates the wrapper is caught here rather than by a demo shipping
  // wrong colours.
  const root = resolveExcatRoot();
  const maybe = root ? it : it.skip;

  maybe('the placeholder appears more than once, so replace() is insufficient', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(root, 'sub-agents', 'excat-block-design-expert', 'brand-extract.js'), 'utf8');
    const count = src.split('__DEFAULT_CONTENT_SELECTORS__').length - 1;
    // One in the doc comment, one in the real declaration. replace() patches only
    // the comment and leaves a ReferenceError behind.
    expect(count).toBeGreaterThan(1);
  });

  maybe('the body is an expression, so it must be called, not merely evaluated', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(root, 'sub-agents', 'excat-block-design-expert', 'brand-extract.js'), 'utf8');
    // page.evaluate(src) on an arrow-function expression returns undefined silently.
    expect(src).toMatch(/\(\)\s*=>\s*\{/);
  });
});
