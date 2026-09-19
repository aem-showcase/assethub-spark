import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkHeaderLogo, checkResidue, checkStaleCardImages,
  checkStructuralResidue, checkIconReferenceResolution, checkWelcomeHeaderHomeLink,
  checkCardCeiling, checkCardCount, checkAccessJson,
  checkCopiedHtmlLive, checkBrandAssetsSource, checkBackgroundTone,
} from '../../scripts/rebrand/verify.mjs';
import { MAX_CARDS } from '../../scripts/assets/constants.js';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'verify-'));
  mkdirSync(join(root, 'blocks', 'header'), { recursive: true });
  mkdirSync(join(root, 'styles'), { recursive: true });
  mkdirSync(join(root, 'icons'), { recursive: true });
  mkdirSync(join(root, 'migration-work'), { recursive: true });
  return root;
}

function writeBrand(root, overrides = {}) {
  const brand = {
    schemaVersion: 1,
    provenance: {
      sourceUrl: 'https://www.example.com/us/en/home/',
      finalUrl: 'https://www.example.com/us/en/home/',
      extractedAt: '2026-09-19T00:00:00.000Z',
      extractor: 'test',
      gatePassed: true,
    },
    tokens: {
      colors: {
        background: 'rgb(255, 255, 255)',
        text: 'rgb(70, 70, 70)',
        link: 'rgb(19, 103, 11)',
      },
      accents: [{ hex: '#13670b', weight: 100, why: ['background'] }],
    },
    tokenMap: [{
      role: 'primary-color',
      oldHex: '#00647D',
      newHex: '#13670B',
      cssVar: '--primary-color',
      source: 'extracted',
    }],
    ...overrides,
  };
  writeFileSync(join(root, 'migration-work', 'brand.json'), JSON.stringify(brand, null, 2));
  return brand;
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

describe('verify: brand-assets-source', () => {
  function writeBrandAssets(root, company = 'heineken-usa') {
    writeFileSync(join(root, 'icons', `${company}-icon.svg`), '<svg><path d="M0 0h1v1z"/></svg>');
    writeFileSync(join(root, 'icons', `${company}-beans.svg`), '<svg><path d="M0 0h1v1z"/></svg>');
    writeFileSync(join(root, 'favicon.svg'), '<svg><path d="M0 0h1v1z"/></svg>');
    writeFileSync(join(root, 'favicon.ico'), 'ico');
  }

  it('FAILS when URL-derived logo/favicon candidates exist but produced assets are untraced', () => {
    const root = makeRepo();
    try {
      writeBrandAssets(root);
      writeBrand(root, {
        assetSources: [{
          kind: 'apple-touch-icon',
          sourceUrl: 'https://www.heineken.com/media/nav_logo_heineken.png',
          discoveredFrom: 'https://www.heineken.com/us/en/home/',
          pageFinalUrl: 'https://www.heineken.com/us/en/home/',
          usedFor: [],
        }],
      });
      const r = checkBrandAssetsSource(root, 'heineken-usa');
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/no brand\.json assetSources\[\]\.usedFor trace/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when every portal brand asset maps to a source URL candidate', () => {
    const root = makeRepo();
    try {
      writeBrandAssets(root);
      writeBrand(root, {
        assetSources: [{
          kind: 'apple-touch-icon',
          sourceUrl: 'https://www.heineken.com/media/nav_logo_heineken.png',
          discoveredFrom: 'https://www.heineken.com/us/en/home/',
          pageFinalUrl: 'https://www.heineken.com/us/en/home/',
          usedFor: [
            'icons/heineken-usa-icon.svg',
            'icons/heineken-usa-beans.svg',
            'favicon.svg',
            'favicon.ico',
          ],
        }],
      });
      expect(checkBrandAssetsSource(root, 'heineken-usa').pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS generated fallback when source URL candidates exist', () => {
    const root = makeRepo();
    try {
      writeBrandAssets(root);
      writeBrand(root, {
        assetSources: [
          {
            kind: 'favicon',
            sourceUrl: 'https://www.heineken.com/favicon.ico',
            discoveredFrom: 'https://www.heineken.com/us/en/home/',
            pageFinalUrl: 'https://www.heineken.com/us/en/home/',
            usedFor: [],
          },
          {
            kind: 'generated-fallback',
            reason: 'hand-drawn',
            usedFor: [
              'icons/heineken-usa-icon.svg',
              'icons/heineken-usa-beans.svg',
              'favicon.svg',
              'favicon.ico',
            ],
          },
        ],
      });
      const r = checkBrandAssetsSource(root, 'heineken-usa');
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/generated-fallback even though URL-derived candidate/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('verify: background-tone', () => {
  const css = (bg) => `
:root {
  --light-color: ${bg};
}
main .section.search-hero {
  background-color: var(--light-color);
}
`;

  it('FAILS when a light source hero is applied as a dark portal hero', () => {
    const root = makeRepo();
    try {
      writeBrand(root, {
        surfaceProfile: {
          sourceUrl: 'https://www.heineken.com/us/en/home/',
          finalUrl: 'https://www.heineken.com/us/en/home/',
          hero: { tone: 'light', background: '#ffffff', evidence: 'top viewport' },
          page: { dominantTone: 'light', lightSurfaceRatio: 0.8, darkSurfaceRatio: 0.1 },
        },
      });
      writeFileSync(join(root, 'styles', 'styles.css'), css('#0B2E07'));
      const r = checkBackgroundTone(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/measured light/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when the portal hero tone matches the measured source tone', () => {
    const root = makeRepo();
    try {
      writeBrand(root, {
        surfaceProfile: {
          sourceUrl: 'https://www.heineken.com/us/en/home/',
          finalUrl: 'https://www.heineken.com/us/en/home/',
          hero: { tone: 'light', background: '#ffffff', evidence: 'top viewport' },
          page: { dominantTone: 'light', lightSurfaceRatio: 0.8, darkSurfaceRatio: 0.1 },
        },
      });
      writeFileSync(join(root, 'styles', 'styles.css'), css('#FFFFFF'));
      expect(checkBackgroundTone(root).pass).toBe(true);
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

describe('verify: structural-residue', () => {
  const THEME_FILE = join('blocks', 'search-results', 'styles', 'theme.css');

  it('FAILS when a block-level CSS literal is byte-identical to the pre-capture baseline at the same file+selector, in a file that also carries a named brand hex', () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, 'blocks', 'search-results', 'styles'), { recursive: true });
      // Mirrors the real Woolworths case: theme.css carries a named brand token
      // (#00647D, qualifying the file as brand-adjacent) alongside a one-off
      // literal (#003d4d) that was never one of the 11 named tokens.
      writeFileSync(
        join(root, 'blocks', 'search-results', 'styles', 'theme.css'),
        '.active { color: #00647D; } .pressed { background-color: #003d4d; }',
      );
      const baseBrand = {
        oldHexes: ['#00647D'],
        allBaseHexes: [
          { hex: '#00647D', file: THEME_FILE, selector: '.active' },
          { hex: '#003D4D', file: THEME_FILE, selector: '.pressed' },
        ],
      };
      const r = checkStructuralResidue(root, baseBrand);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/#003D4D/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when the same file+selector now carries a new/changed hex', () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, 'blocks', 'search-results', 'styles'), { recursive: true });
      writeFileSync(
        join(root, 'blocks', 'search-results', 'styles', 'theme.css'),
        '.active { color: #008446; } .pressed { background-color: #0a3d23; }',
      );
      const baseBrand = {
        oldHexes: ['#00647D'],
        allBaseHexes: [
          { hex: '#00647D', file: THEME_FILE, selector: '.active' },
          { hex: '#003D4D', file: THEME_FILE, selector: '.pressed' },
        ],
      };
      expect(checkStructuralResidue(root, baseBrand).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('does NOT flag an unchanged neutral hex in a file that carries no named brand hex at all', () => {
    const root = makeRepo();
    try {
      // A generic icon file that never references any brand token — the
      // exact false-positive case a whole-repo byte-diff would otherwise
      // flood on (black strokes, greys, pure white), which this check must
      // not do since the file never "qualifies" as brand-adjacent.
      writeFileSync(join(root, 'icons', 'arrow.svg'), '<svg><path stroke="#1E1E1E"/></svg>');
      const baseBrand = {
        oldHexes: ['#00647D'],
        allBaseHexes: [{ hex: '#1E1E1E', file: join('icons', 'arrow.svg'), selector: 'top-level' }],
      };
      expect(checkStructuralResidue(root, baseBrand).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('does not flag a hex whose selector matches the semantic-color allowlist, even in a qualifying file', () => {
    const root = makeRepo();
    try {
      mkdirSync(join(root, 'blocks', 'header'), { recursive: true });
      mkdirSync(join(root, '.claude', 'skills', 'rebrand-portal', 'scripts', 'rebrand'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'skills', 'rebrand-portal', 'scripts', 'rebrand', 'semantic-color-allowlist.json'),
        JSON.stringify({ selectorPatterns: ['\\.editing-mode'], filePatterns: [] }),
      );
      // .brand's color has already been rebranded (was #00647D, now #008446, so
      // the file still "qualifies" as brand-adjacent via the pre-capture baseline)
      // — only the allowlisted editing-mode amber is unchanged, and must not FAIL.
      writeFileSync(
        join(root, 'blocks', 'header', 'profile.css'),
        '.brand { color: #008446; } .profile-modal.editing-mode .edit-button { background: #ffeaa7; }',
      );
      const profilePath = join('blocks', 'header', 'profile.css');
      const baseBrand = {
        oldHexes: ['#00647D'],
        allBaseHexes: [
          { hex: '#00647D', file: profilePath, selector: '.brand' },
          { hex: '#FFEAA7', file: profilePath, selector: '.profile-modal.editing-mode .edit-button' },
        ],
      };
      expect(checkStructuralResidue(root, baseBrand).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS with a clear message when baseBrand.allBaseHexes is missing', () => {
    const root = makeRepo();
    try {
      expect(checkStructuralResidue(root, {}).pass).toBe(false);
      expect(checkStructuralResidue(root, null).pass).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS with a clear message when baseBrand.oldHexes is empty', () => {
    const root = makeRepo();
    try {
      const r = checkStructuralResidue(root, { oldHexes: [], allBaseHexes: [] });
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/oldHexes is empty/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('verify: icon-reference-resolution', () => {
  it('FAILS when CSS references an icon file that does not exist', () => {
    const root = makeRepo();
    writeFileSync(
      join(root, 'styles', 'styles.css'),
      ".dropdown-arrow { background: url('/icons/chevron-down.svg'); }",
    );
    try {
      const r = checkIconReferenceResolution(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/chevron-down\.svg/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when every referenced icon exists on disk', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'icons', 'chevron-down.svg'), '<svg/>');
    writeFileSync(
      join(root, 'styles', 'styles.css'),
      ".dropdown-arrow { background: url('/icons/chevron-down.svg'); }",
    );
    try {
      expect(checkIconReferenceResolution(root).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('verify: welcome-header-home-link', () => {
  const WITH_BARE_HREF = `
export default async function decorate(block) {
  if (getMetadata('header') === 'no') {
    const homeLink = document.createElement('a');
    homeLink.setAttribute('href', '/');
    welcomeBar.append(homeLink);
    return;
  }
}
`;

  const WITH_LOCALIZED_HREF = `
export default async function decorate(block) {
  if (getMetadata('header') === 'no') {
    const homeLink = document.createElement('a');
    homeLink.setAttribute('href', localizePath('/'));
    welcomeBar.append(homeLink);
    return;
  }
}
`;

  it('FAILS when the welcome-header home link is a bare "/" literal', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'blocks', 'header', 'header.js'), WITH_BARE_HREF);
    try {
      const r = checkWelcomeHeaderHomeLink(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/bare/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('PASSES when the welcome-header home link resolves via localizePath()', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'blocks', 'header', 'header.js'), WITH_LOCALIZED_HREF);
    try {
      expect(checkWelcomeHeaderHomeLink(root).pass).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('FAILS with a clear message when header.js has no header:no minimal-header path', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'blocks', 'header', 'header.js'), 'export default async function decorate() {}');
    try {
      const r = checkWelcomeHeaderHomeLink(root);
      expect(r.pass).toBe(false);
      expect(r.reason).toMatch(/no longer has/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

/**
 * B4 — the ceiling asserted against the DELIVERED ARTIFACT.
 *
 * Every earlier card check read report.json: the file the run writes about itself. A page
 * authored by some other route (hand-edited HTML, ad-hoc script, raw curl) produces a
 * report that says nothing about what shipped — which is exactly how `stale-card-images`
 * passed its check and shipped the defect twice.
 */
describe('checkCardCeiling (published HTML)', () => {
  const row = (i) => `<div><div><picture><img src="/i${i}.jpg"></picture></div><div><h3>Cat${i}</h3></div></div>`;
  const page = (n, { withTopBrands = false } = {}) => [
    '<body><main>',
    `<div class="carousel tiles">${Array.from({ length: n }, (_, i) => row(i)).join('')}</div>`,
    withTopBrands ? `<div class="cards">${row(99)}</div>` : '',
    '</main></body>',
  ].join('');

  const withFetch = async (html, fn) => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, text: async () => html,
    });
    try { return await fn(); } finally { spy.mockRestore(); }
  };

  it('FAILS when more than MAX_CARDS categories are published', async () => {
    const r = await withFetch(page(9), () => checkCardCeiling('preview.test', 'acme'));
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/9 category cards/);
  });

  it('PASSES at exactly MAX_CARDS with no secondary cards block', async () => {
    const r = await withFetch(page(MAX_CARDS), () => checkCardCeiling('preview.test', 'acme'));
    expect(r.pass).toBe(true);
  });

  it('FAILS when a Top Brands block is still published', async () => {
    const r = await withFetch(
      page(MAX_CARDS, { withTopBrands: true }),
      () => checkCardCeiling('preview.test', 'acme'),
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/Top Brands/);
  });

  it('needs --preview and --company', async () => {
    expect((await checkCardCeiling(null, 'acme')).pass).toBe(false);
    expect((await checkCardCeiling('preview.test', null)).pass).toBe(false);
  });
});

describe('checkCardCount ceiling', () => {
  const writeReport = (cards) => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-report-'));
    const p = join(dir, 'report.json');
    writeFileSync(p, JSON.stringify({ cards }));
    return { p, dir };
  };
  const card = (i) => ({ slug: `c${i}`, label: `C${i}`, href: `/h${i}`, cardImageUrl: `/i${i}.jpg` });

  it('FAILS a report that exceeds the ceiling', () => {
    const { p, dir } = writeReport(Array.from({ length: MAX_CARDS + 1 }, (_, i) => card(i)));
    try {
      expect(checkCardCount(p).pass).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('PASSES at exactly MAX_CARDS', () => {
    const { p, dir } = writeReport(Array.from({ length: MAX_CARDS }, (_, i) => card(i)));
    try {
      expect(checkCardCount(p).pass).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('checkAccessJson', () => {
  const sheet = (data) => ({
    total: data.length,
    limit: data.length,
    offset: 0,
    data,
    ':type': 'sheet',
  });

  describe('checkCopiedHtmlLive', () => {
    const daItem = (path, ext = 'html') => ({
      path: `/aem-showcase/assethub-spark/${path}`,
      name: path.split('/').pop().replace(`.${ext}`, ''),
      ext,
    });
    const daDir = (path) => ({
      path: `/aem-showcase/assethub-spark/${path}`,
      name: path.split('/').pop(),
    });
    const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
    const statusRes = (status) => ({ ok: status >= 200 && status < 300, status });

    function fetchFor({ reportStatus = 404, notificationsStatus = 404 } = {}) {
      return vi.fn(async (url) => {
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme')) {
          return jsonRes([
            daDir('companies/acme/en'),
            daDir('companies/acme/config'),
            daItem('companies/acme/login.html'),
          ]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/en')) {
          return jsonRes([
            daItem('companies/acme/en/index.html'),
            daDir('companies/acme/en/reports'),
            daDir('companies/acme/en/my-dam'),
            daDir('companies/acme/en/drafts'),
          ]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/en/reports')) {
          return jsonRes([daItem('companies/acme/en/reports/report-hub.html')]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/en/my-dam')) {
          return jsonRes([daItem('companies/acme/en/my-dam/my-notifications.html')]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/en/drafts')) {
          return jsonRes([daItem('companies/acme/en/drafts/test-page.html')]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/config')) {
          return jsonRes([daDir('companies/acme/config/access')]);
        }
        if (url.endsWith('/list/aem-showcase/assethub-spark/companies/acme/config/access')) {
          return jsonRes([
            daItem('companies/acme/config/access/application.json', 'json'),
            daItem('companies/acme/config/access/users.json', 'json'),
          ]);
        }
        if (url === 'https://demo-acme--assethub-spark--aem-showcase.aem.live/companies/acme/en/') {
          return statusRes(200);
        }
        if (url === 'https://demo-acme--assethub-spark--aem-showcase.aem.live/companies/acme/login') {
          return statusRes(200);
        }
        if (url === 'https://demo-acme--assethub-spark--aem-showcase.aem.live/companies/acme/en/reports/report-hub') {
          return statusRes(reportStatus);
        }
        if (url === 'https://demo-acme--assethub-spark--aem-showcase.aem.live/companies/acme/en/my-dam/my-notifications') {
          return statusRes(notificationsStatus);
        }
        throw new Error(`unexpected fetch ${url}`);
      });
    }

    it('FAILS when copied report and notification HTML pages exist in DA but are not live', async () => {
      const fetchFn = fetchFor();
      const result = await checkCopiedHtmlLive('demo-acme.dev.frescopamedia.com', 'acme', {
        daToken: 'token',
        fetchFn,
      });

      expect(result.pass).toBe(false);
      expect(result.reason).toMatch(/reports\/report-hub/);
      expect(result.reason).toMatch(/my-dam\/my-notifications/);
    });

    it('PASSES when all copied non-draft HTML pages are live and does not probe JSON sheets', async () => {
      const fetchFn = fetchFor({ reportStatus: 200, notificationsStatus: 200 });
      const result = await checkCopiedHtmlLive('demo-acme.dev.frescopamedia.com', 'acme', {
        daToken: 'token',
        fetchFn,
      });

      expect(result.pass).toBe(true);
      const urls = fetchFn.mock.calls.map(([url]) => url);
      expect(urls.some((url) => String(url).includes('/application'))).toBe(false);
      expect(urls.some((url) => String(url).includes('/users'))).toBe(false);
      expect(urls.some((url) => String(url).includes('/drafts/test-page'))).toBe(false);
    });

    it('needs --preview, --company, and a DA token', async () => {
      expect((await checkCopiedHtmlLive(null, 'acme', { daToken: 'token' })).pass).toBe(false);
      expect((await checkCopiedHtmlLive('preview.test', null, { daToken: 'token' })).pass).toBe(false);
      expect((await checkCopiedHtmlLive('preview.test', 'acme', { repoRoot: '/nope' })).pass).toBe(false);
    });
  });
  const res = ({ status = 200, body = {} } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('PASSES when company-scoped access sheets are published and grant preview', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({
        body: sheet([{ email: 'adobe.com', permissions: 'preview,sudo' }]),
      }))
      .mockResolvedValueOnce(res({
        body: sheet([{ email: 'mohitar@adobe.com', roles: 'admin' }]),
      }));

    const result = await checkAccessJson('preview.test', 'disney-in', fetchFn);

    expect(result.pass).toBe(true);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://preview.test/companies/disney-in/config/access/application.json',
      { redirect: 'manual' },
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://preview.test/companies/disney-in/config/access/users.json',
      { redirect: 'manual' },
    );
  });

  it('reads the branch AEM origin when given a dev worker preview host', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({
        body: sheet([{ email: 'adobe.com', permissions: 'preview' }]),
      }))
      .mockResolvedValueOnce(res({ body: sheet([]) }));

    await checkAccessJson('demo-disney-in-6.dev.frescopamedia.com', 'disney-in', fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://demo-disney-in-6--assethub-spark--aem-showcase.aem.page/companies/disney-in/config/access/application.json',
      { redirect: 'manual' },
    );
  });

  it('FAILS when application.json is not published under the company folder', async () => {
    const result = await checkAccessJson(
      'preview.test',
      'disney-in',
      vi.fn().mockResolvedValueOnce(res({ status: 404 })),
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/application\.json.*404/);
  });

  it('FAILS when users.json is not published under the company folder', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({
        body: sheet([{ email: 'adobe.com', permissions: ['preview'] }]),
      }))
      .mockResolvedValueOnce(res({ status: 404 }));

    const result = await checkAccessJson('preview.test', 'disney-in', fetchFn);

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/users\.json.*404/);
  });

  it('FAILS when application.json has no preview permission grant', async () => {
    const result = await checkAccessJson(
      'preview.test',
      'disney-in',
      vi.fn().mockResolvedValueOnce(res({
        body: sheet([{ email: 'adobe.com', permissions: 'sudo' }]),
      })),
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/no row granting preview/);
  });

  it('FAILS when a path serves media or HTML instead of EDS sheet JSON', async () => {
    const result = await checkAccessJson(
      'preview.test',
      'disney-in',
      vi.fn().mockResolvedValueOnce(res({ body: { html: '<p>not a sheet</p>' } })),
    );

    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/not an EDS sheet JSON/);
  });

  it('needs --preview and --company', async () => {
    expect((await checkAccessJson(null, 'acme')).pass).toBe(false);
    expect((await checkAccessJson('preview.test', null)).pass).toBe(false);
  });
});
