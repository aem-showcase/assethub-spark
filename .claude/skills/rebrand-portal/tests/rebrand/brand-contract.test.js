import { describe, it, expect } from 'vitest';
import {
  normalizeHex, rgbToHex, hexVariants, validateBrand, loadBrand, measuredColors,
  SCHEMA_VERSION,
} from '../../scripts/rebrand/brand-contract.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * brand.json is the independent source of truth that breaks Step 4g's circular
 * gate. If it can be fabricated, nothing downstream means anything — so the
 * provenance rules (I10) are tested as hard as the parsing.
 */

function brand(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    provenance: {
      sourceUrl: 'https://www.hyundai.com/in/en',
      finalUrl: 'https://www.hyundai.com/in/en',
      extractedAt: '2026-09-17T00:00:00.000Z',
      extractor: 'excat/brand-extract.js',
      gatePassed: true,
    },
    tokens: { colors: { background: 'rgb(255, 255, 255)', text: 'rgb(33, 37, 41)', link: 'rgb(0, 44, 95)' } },
    tokenMap: [],
    ...overrides,
  };
}

describe('colour normalisation', () => {
  it('canonicalises the notations excat and authored CSS each produce', () => {
    // excat returns computed styles (rgb); stylesheets use hex. Both must compare equal
    // or every fidelity check would fail on notation alone.
    expect(normalizeHex('rgb(0, 44, 95)')).toBe('#002c5f');
    expect(normalizeHex('#002C5F')).toBe('#002c5f');
    expect(normalizeHex('#FFF')).toBe('#ffffff');
    expect(rgbToHex('rgba(0,44,95,0.5)')).toBe('#002c5f');
  });

  it('returns null for values that are not comparable colours', () => {
    // Callers must treat null as "cannot compare", never as "no match" — a
    // transparent surface is not a failed match.
    expect(normalizeHex('transparent')).toBeNull();
    expect(normalizeHex('inherit')).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it('enumerates every textual form a hex can take in a stylesheet', () => {
    const v = hexVariants('#002C5F');
    expect(v).toContain('#002c5f');
    expect(v).toContain('rgb(0, 44, 95)');
    expect(v).toContain('rgb(0 44 95)');
    // The `rgb(r g b / 8%)` alpha form is what the base theme's section tints use,
    // so a fidelity grep must recognise it.
    expect(v).toContain('rgb(0 44 95 /');
  });

  it('offers the 3-digit shorthand only when it is lossless', () => {
    expect(hexVariants('#ffffff')).toContain('#fff');
    expect(hexVariants('#002c5f')).not.toContain('#02f');
  });
});

describe('validateBrand — structure', () => {
  it('accepts a well-formed record', () => {
    expect(validateBrand(brand()).ok).toBe(true);
  });

  it('rejects a record whose extraction was gated', () => {
    // The Heineken case: tokens present, plausible, and read off an age gateway.
    const r = validateBrand(brand({ provenance: { ...brand().provenance, gatePassed: false } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/gatePassed/);
  });

  it('rejects a record with no measured colours', () => {
    const r = validateBrand(brand({ tokens: { colors: {} } }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/nothing was measured/);
  });

  it('requires every provenance field', () => {
    const p = { ...brand().provenance };
    delete p.sourceUrl;
    const r = validateBrand(brand({ provenance: p }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/provenance.sourceUrl/);
  });
});

describe('validateBrand — provenance of each colour (I10)', () => {
  it('accepts a token whose value was actually measured', () => {
    const r = validateBrand(brand({
      tokenMap: [{
        role: 'primary', oldHex: '#EBA439', newHex: '#002C5F', cssVar: '--link-color', source: 'extracted',
      }],
    }));
    expect(r.ok).toBe(true);
  });

  it('REJECTS a token claiming to be extracted that was never measured', () => {
    // This is the fabrication case, verbatim: #D4AF37 was applied to a Heineken
    // demo and no check anywhere could tell it had been invented.
    const r = validateBrand(brand({
      tokenMap: [{
        role: 'primary', oldHex: '#EBA439', newHex: '#D4AF37', cssVar: '--link-color', source: 'extracted',
      }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not among the measured colours/);
  });

  it('accepts a derived token that names the measured colour it came from', () => {
    const r = validateBrand(brand({
      tokenMap: [{
        role: 'primary-dark', newHex: '#001d3f', cssVar: '--link-hover-color', source: 'derived', derivedFrom: 'rgb(0, 44, 95)',
      }],
    }));
    expect(r.ok).toBe(true);
  });

  it('REJECTS a derived token with no derivedFrom', () => {
    // "Derived" must not become a catch-all that launders a guess.
    const r = validateBrand(brand({
      tokenMap: [{ role: 'x', newHex: '#001d3f', cssVar: '--x', source: 'derived' }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/must name the measured colour/);
  });

  it('REJECTS a derived token whose ancestor was never measured', () => {
    const r = validateBrand(brand({
      tokenMap: [{
        role: 'x', newHex: '#001d3f', cssVar: '--x', source: 'derived', derivedFrom: '#D4AF37',
      }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/never measured/);
  });

  it('REJECTS a token with no source at all', () => {
    const r = validateBrand(brand({
      tokenMap: [{ role: 'x', newHex: '#002C5F', cssVar: '--x' }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/fabrication/);
  });

  it('requires cssVar to be a custom property', () => {
    const r = validateBrand(brand({
      tokenMap: [{ newHex: '#002C5F', cssVar: 'link-color', source: 'extracted' }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/custom property/);
  });
});

describe('measuredColors', () => {
  it('canonicalises every measured value', () => {
    expect(measuredColors(brand())).toEqual(['#ffffff', '#212529', '#002c5f']);
  });
  it('is empty, not throwing, for a malformed record', () => {
    expect(measuredColors({})).toEqual([]);
  });
});

describe('loadBrand', () => {
  it('reports a missing record as a named condition rather than throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'brand-'));
    const r = loadBrand(root);
    expect(r.found).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/has not been run/);
  });

  it('reports malformed JSON without throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'brand-'));
    mkdirSync(join(root, 'migration-work'), { recursive: true });
    writeFileSync(join(root, 'migration-work', 'brand.json'), '{ not json');
    const r = loadBrand(root);
    expect(r.found).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('loads and validates a good record', () => {
    const root = mkdtempSync(join(tmpdir(), 'brand-'));
    mkdirSync(join(root, 'migration-work'), { recursive: true });
    writeFileSync(join(root, 'migration-work', 'brand.json'), JSON.stringify(brand()));
    const r = loadBrand(root);
    expect(r.valid).toBe(true);
    expect(r.data.provenance.gatePassed).toBe(true);
  });
});
