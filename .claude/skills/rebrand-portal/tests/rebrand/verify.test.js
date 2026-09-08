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
  height: auto;
  max-height: calc(var(--nav-bar-height) - 24px);
}
header .nav-brand .icon img,
header .nav-brand .icon svg {
  width: auto;
  max-width: 150px;
  height: auto;
  max-height: calc(var(--nav-bar-height) - 24px);
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

describe('verify: header-logo', () => {
  it('PASSES when logo rules use max-height', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'blocks', 'header', 'header.css'), GOOD_HEADER);
      expect(checkHeaderLogo(root).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS when a logo rule is fixed-width with no max-height (the shipped regression)', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'blocks', 'header', 'header.css'), BAD_HEADER);
      const r = checkHeaderLogo(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/max-height/);
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

  it('PASSES when the tree is fully rebranded (no old hex, no slug)', () => {
    const root = makeRepo();
    try {
      writeFileSync(join(root, 'styles', 'styles.css'), '.x{color:#022043;}');
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
