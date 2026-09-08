import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkHeaderLogo, checkResidue, checkStaleCardImages,
} from '../../scripts/rebrand/verify.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  mkdirSync(join(root, 'blocks', 'header'), { recursive: true });
  mkdirSync(join(root, 'styles'), { recursive: true });
  mkdirSync(join(root, 'icons'), { recursive: true });
  return root;
}

const GOOD_HEADER = `
header nav .nav-brand img {
  width: auto;
  max-width: 180px;
  height: calc(var(--nav-height) - 24px);
  max-height: calc(var(--nav-height) - 24px);
  object-fit: contain;
}
header .nav-brand .icon img,
header .nav-brand .icon svg {
  width: auto;
  max-width: 150px;
  height: calc(var(--nav-height) - 24px);
  max-height: calc(var(--nav-height) - 24px);
  object-fit: contain;
}
`;

const BAD_HEADER = `
header nav .nav-brand img {
  width: 180px;
  height: auto;
}
header .nav-brand .icon img,
header .nav-brand .icon svg {
  width: 150px;
  height: auto;
}
`;

// The invisible-logo regression: max-height present, width:auto — looks fine to
// the old check — but height:auto collapses to 0×0 in the nested flex chain.
const COLLAPSE_HEADER = `
header nav .nav-brand img {
  width: auto;
  max-width: 180px;
  height: auto;
  max-height: calc(var(--nav-height) - 24px);
}
header .nav-brand .icon img,
header .nav-brand .icon svg {
  width: auto;
  max-width: 150px;
  height: auto;
  max-height: calc(var(--nav-height) - 24px);
}
`;

describe('verify: header-logo', () => {
  it('PASSES when logo rules have max-height AND an explicit non-auto height', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'blocks', 'header', 'header.css'), GOOD_HEADER);
      expect(checkHeaderLogo(root).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS when a logo rule is fixed-width with no max-height (the overflow regression)', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'blocks', 'header', 'header.css'), BAD_HEADER);
      const r = checkHeaderLogo(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/max-height/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS when height:auto alone lets the logo collapse to 0×0 (the invisible-logo regression)', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'blocks', 'header', 'header.css'), COLLAPSE_HEADER);
      const r = checkHeaderLogo(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/explicit non-auto height|0×0/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('verify: residue', () => {
  const baseBrand = { baseSlug: 'frescopa', oldHexes: ['#00647D', '#58181D', '#F4E9DC'] };

  it('FAILS when an old brand hex or the base slug survives', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'styles', 'styles.css'), '.x{color:#00647D;}');
      writeFileSync(join(root, 'icons', 'frescopa-icon.svg'), '<svg fill="#58181D"/>');
      const r = checkResidue(root, baseBrand);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/#00647D|frescopa/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS on the decimal rgb() form of an old hex (#58181D -> rgb(88 24 29 …))', () => {
    const root = makeRepo();
    try {
      // No literal #hex anywhere — only the decimal rgb() forms the plain grep missed.
      writeFileSync(join(root, 'styles', 'styles.css'), '.a{box-shadow:0 12px 30px rgb(88 24 29 / 14%);}');
      writeFileSync(join(root, 'styles', 'more.css'), '.b{background:rgb(235, 164, 57);}'); // #EBA439 not in set
      const r = checkResidue(root, { baseSlug: 'frescopa', oldHexes: ['#58181D'] });
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/rgb\(88 24 29\)/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when the tree is fully rebranded (no old hex in #hex OR rgb() form, no slug)', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'styles', 'styles.css'), '.x{color:#022043;box-shadow:0 0 1px rgb(2 32 67 / 10%);}');
      writeFileSync(join(root, 'icons', 'workday-icon.svg'), '<svg fill="#022043"/>');
      expect(checkResidue(root, baseBrand).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS with a clear message when baseBrand is missing', () => {
    const root = makeRepo();
    try {
      expect(checkResidue(root, null).pass).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('verify: stale-card-images', () => {
  function reportWith(urls) {
    const root = mkdtempSync(join(tmpdir(), 'verify-rep-'));
    const p = join(root, 'report.json');
    writeFileSync(p, JSON.stringify({ cards: urls.map((u) => ({ cardImageUrl: u })) }));
    return { root, p };
  }

  it('FAILS on a base-template placeholder (firefly_ / north-roast / frescopa)', () => {
    const { root, p } = reportWith([
      'https://content.da.live/x/media_abc.png',
      'https://content.da.live/x/firefly_gemini_234572.png',
    ]);
    try {
      const r = checkStaleCardImages(p);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/firefly/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when every card image is run-produced', () => {
    const { root, p } = reportWith([
      'https://content.da.live/x/media_human-capital-management.jpg',
      'https://content.da.live/x/media_finance.jpg',
    ]);
    try {
      expect(checkStaleCardImages(p).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
