import { describe, it, expect } from 'vitest';
import {
  mkdtempSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  checkBrandFidelity, checkBackgroundAssetFidelity, checkBackgroundShorthand, checkCascade,
} from '../../scripts/rebrand/verify.mjs';
import { SCHEMA_VERSION } from '../../scripts/rebrand/brand-contract.mjs';

function makeRepo(brand, css) {
  const root = mkdtempSync(join(tmpdir(), 'brandv-'));
  mkdirSync(join(root, 'styles'), { recursive: true });
  mkdirSync(join(root, 'migration-work'), { recursive: true });
  if (css !== undefined) writeFileSync(join(root, 'styles', 'styles.css'), css);
  if (brand) writeFileSync(join(root, 'migration-work', 'brand.json'), JSON.stringify(brand));
  return root;
}

const MEASURED = {
  schemaVersion: SCHEMA_VERSION,
  provenance: {
    sourceUrl: 'https://www.hyundai.com/in/en',
    finalUrl: 'https://www.hyundai.com/in/en',
    extractedAt: '2026-09-17T00:00:00.000Z',
    extractor: 'excat/brand-extract.js',
    gatePassed: true,
  },
  tokens: { colors: { background: 'rgb(255, 255, 255)', link: 'rgb(0, 44, 95)' } },
  tokenMap: [{
    role: 'primary', oldHex: '#EBA439', newHex: '#002C5F', cssVar: '--link-color', source: 'extracted',
  }],
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function svgWithPayload(payload) {
  return `<svg><image xlink:href="data:image/png;base64,${payload}"/></svg>`;
}

function repoWithBackground({ brand = MEASURED, payload = 'NEWIMAGE' } = {}) {
  const root = makeRepo(brand, ':root { --link-color: #002C5F; }');
  mkdirSync(join(root, 'styles', 'backgrounds'), { recursive: true });
  writeFileSync(join(root, 'styles', 'backgrounds', 'big.svg'), svgWithPayload(payload));
  return root;
}

function baseBrandWithBackground(payload = 'BASEIMAGE') {
  return {
    backgroundAssets: {
      'styles/backgrounds/big.svg': {
        fileSha256: sha256(svgWithPayload(payload)),
        embeddedImageSha256: sha256(payload),
      },
    },
  };
}

describe('brand-fidelity', () => {
  it('passes when the theme carries the value measured from the source', async () => {
    const root = makeRepo(MEASURED, ':root { --link-color: #002C5F; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(true);
    expect(r.reason).toMatch(/hyundai\.com/);
  });

  it('FAILS when the theme carries a colour the source never had', async () => {
    // The whole point. Under the old 4g procedure the expected value was read
    // out of this same stylesheet, so this comparison could not fail.
    const root = makeRepo(MEASURED, ':root { --link-color: #D4AF37; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/#d4af37.*measured #002c5f/i);
  });

  it('FAILS when the mapped variable was never declared', async () => {
    const root = makeRepo(MEASURED, ':root { --primary-color: #002C5F; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/--link-color is not declared/);
  });

  it('FAILS when tokens were measured but never mapped to roles', async () => {
    // Extraction without mapping leaves the theme unverifiable — which would be
    // an easy way to satisfy the extraction gate while changing nothing.
    const root = makeRepo({ ...MEASURED, tokenMap: [] }, ':root { --link-color: #002C5F; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/empty tokenMap/);
  });

  it('FAILS when there is no measured record at all', async () => {
    const root = makeRepo(null, ':root { --link-color: #002C5F; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/has not been run/);
  });

  it('FAILS when the record exists but records a gated extraction', async () => {
    const gated = { ...MEASURED, provenance: { ...MEASURED.provenance, gatePassed: false } };
    const root = makeRepo(gated, ':root { --link-color: #002C5F; }');
    const r = await checkBrandFidelity(root, null);
    expect(r.pass).toBe(false);
  });

  it('accepts notation differences between computed and authored colours', async () => {
    const root = makeRepo(MEASURED, ':root { --link-color: rgb(0, 44, 95); }');
    expect((await checkBrandFidelity(root, null)).pass).toBe(true);
  });

  it('allows a var() indirection rather than demanding a literal', async () => {
    const css = ':root { --brand-primary: #002C5F; --link-color: var(--brand-primary); }';
    const root = makeRepo(MEASURED, css);
    expect((await checkBrandFidelity(root, null)).pass).toBe(true);
  });
});

describe('background-shorthand', () => {
  // The exact shape that left a surface cream: two classes on ONE element, equal
  // specificity, the later rule using the shorthand and thereby resetting the
  // image layer as well as the colour.
  const LAYERED = `
    main .section.search-hero { background: linear-gradient(rgb(0 44 95 / 8%), transparent), url("/icons/big.svg") no-repeat; }
  `;

  it('FAILS on a shorthand that clobbers a layered section background', () => {
    const css = `${LAYERED}
      main .section.category-tiles { background: #ffffff; }
    `;
    const r = checkBackgroundShorthand(makeRepo(null, css));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/category-tiles/);
    expect(r.reason).toMatch(/background-color instead/);
  });

  it('passes when the same rule uses background-color', () => {
    const css = `${LAYERED}
      main .section.category-tiles { background-color: #ffffff; }
    `;
    expect(checkBackgroundShorthand(makeRepo(null, css)).pass).toBe(true);
  });

  it('passes when the shorthand carries its own image layer', () => {
    // Replacing a layered background with another layered background is fine.
    const css = `${LAYERED}
      main .section.category-tiles { background: url("/icons/other.svg") no-repeat #fff; }
    `;
    expect(checkBackgroundShorthand(makeRepo(null, css)).pass).toBe(true);
  });

  it('passes when nothing layered exists to clobber', () => {
    const css = 'main .section.category-tiles { background: #ffffff; }';
    const r = checkBackgroundShorthand(makeRepo(null, css));
    expect(r.pass).toBe(true);
    expect(r.reason).toMatch(/no layered/);
  });

  it('does not flag a non-section rule', () => {
    const css = `${LAYERED}
      .cards-card-body { background: #fff; }
    `;
    expect(checkBackgroundShorthand(makeRepo(null, css)).pass).toBe(true);
  });
});

describe('background-asset-fidelity', () => {
  const bgPath = 'styles/backgrounds/big.svg';

  it('FAILS when the embedded landing background payload is unchanged', () => {
    const root = repoWithBackground({ payload: 'BASEIMAGE' });
    const r = checkBackgroundAssetFidelity(root, baseBrandWithBackground('BASEIMAGE'));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/still contains the captured base embedded image/);
  });

  it('FAILS when the image changed but brand.json has no assetMap entry', () => {
    const root = repoWithBackground({ payload: 'NEWIMAGE' });
    const r = checkBackgroundAssetFidelity(root, baseBrandWithBackground('BASEIMAGE'));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/no assetMap\[\] entry/);
  });

  it('FAILS when assetMap provenance is not tied to measured colors', () => {
    const brand = {
      ...MEASURED,
      assetMap: [{
        path: bgPath,
        role: 'landing decorative background',
        source: 'derived',
        derivedFrom: ['#D4AF37'],
        oldEmbeddedImageSha256: sha256('BASEIMAGE'),
        newEmbeddedImageSha256: sha256('NEWIMAGE'),
      }],
    };
    const root = repoWithBackground({ brand, payload: 'NEWIMAGE' });
    const r = checkBackgroundAssetFidelity(root, baseBrandWithBackground('BASEIMAGE'));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/derivedFrom color/);
  });

  it('PASSES when the image changed and assetMap points to measured colors', () => {
    const brand = {
      ...MEASURED,
      tokens: {
        ...MEASURED.tokens,
        accents: [{ hex: '#002C5F', weight: 10, why: ['background'] }],
      },
      assetMap: [{
        path: bgPath,
        role: 'landing decorative background',
        source: 'derived',
        derivedFrom: ['#002C5F'],
        oldEmbeddedImageSha256: sha256('BASEIMAGE'),
        newEmbeddedImageSha256: sha256('NEWIMAGE'),
      }],
    };
    const root = repoWithBackground({ brand, payload: 'NEWIMAGE' });
    const r = checkBackgroundAssetFidelity(root, baseBrandWithBackground('BASEIMAGE'));
    expect(r.pass).toBe(true);
  });
});

describe('cascade', () => {
  // baseHexes must be present: a report produced without them compares every
  // surface against an empty set, so it cannot fail. checkCascade rejects that
  // shape, and these fixtures model real reports rather than vacuous ones.
  function report(surfaces, baseHexes = ['#fdf6e3']) {
    const root = mkdtempSync(join(tmpdir(), 'casc-'));
    const p = join(root, 'cascade-report.json');
    writeFileSync(p, JSON.stringify({ baseHexes, surfaces }));
    return p;
  }

  it('FAILS a surface still painting the base brand colour', () => {
    const r = checkCascade(report([
      { selector: 'body', computed: 'rgb(253, 246, 227)', expected: 'not base', pass: false, note: 'still painting #fdf6e3' },
    ]));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/body/);
  });

  it('passes when every rendered surface is correct', () => {
    const r = checkCascade(report([
      { selector: 'body', computed: 'rgb(255, 255, 255)', pass: true },
      { selector: 'main .section.category-tiles', computed: 'rgb(0, 44, 95)', pass: true },
    ]));
    expect(r.pass).toBe(true);
  });

  it('FAILS — not passes — when the check was never run', () => {
    // A missing report must never read as "nothing wrong found". That failure
    // mode is how the computed-style requirement went unperformed for months.
    const r = checkCascade(null);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/check-cascade\.mjs/);
  });

  it('FAILS on an empty report rather than vacuously passing', () => {
    expect(checkCascade(report([])).pass).toBe(false);
  });

  it('FAILS a report with no baseHexes, even when every surface says pass', () => {
    // The live first run produced exactly this: 7/7 "correct" against an empty
    // comparison set. Green, confident, and asserting nothing.
    const r = checkCascade(report([{ selector: 'body', computed: 'rgb(255, 255, 255)', pass: true }], []));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/vacuously/);
  });
});
