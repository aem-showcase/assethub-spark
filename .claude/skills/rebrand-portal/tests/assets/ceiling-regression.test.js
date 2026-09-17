/**
 * R1 regression: the failure that actually happened.
 *
 * On a live demo run the agent found a per-invocation cap of 50, correctly refused to
 * bypass it ("I shouldn't try to work around this cap by editing the script — it's likely
 * an intentional safety rail"), and instead did the compliant thing: it "restructured into
 * 7 separate single-category, single-page runs". Seven runs x ~36 assets shipped 252
 * assets across 7 categories — 16.8x the intended demo shape of 5 categories x 2-3 assets.
 *
 * The lesson: a per-invocation cap is not a ceiling. It is a rate limit, and a compliant
 * agent defeats it by invoking more. A ceiling tested only on a single invocation has not
 * been tested at all.
 *
 * This suite replays that sequence. It runs the pipeline seven times in a row against one
 * persistent DAM folder, exactly as the transcript did, and asserts the result converges on
 * the demo shape instead of accumulating.
 */
import { describe, it, expect } from 'vitest';

import { enrichAssets, checkCardGate } from '../../scripts/assets/enrich-assets.js';
import { updateIndexCards } from '../../scripts/assets/update-index-cards.js';
import {
  MAX_CARDS,
  MAX_ASSETS_PER_CATEGORY,
  BRING_IN_MAX_IMAGES,
} from '../../scripts/assets/constants.js';
import { makeRes } from './helpers.js';

const silent = { info: () => {}, warn: () => {} };

const FOLDER = '/content/dam/acme';

// Seven categories and seven source pages: the shape the agent actually ran with.
const CATEGORIES = [
  'beverages', 'disposables', 'candy-snacks', 'grocery',
  'janitorial', 'office', 'restaurant-supplies',
];
const CONTRACT = CATEGORIES.map((slug) => ({ slug, label: slug }));
const IMAGES_PER_PAGE = 30; // what each source page offered on the live run

const pageUrl = (cat) => `https://brand.example/${cat}`;

function htmlRes(html) {
  return {
    ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => html,
  };
}

function assetRes() {
  const bytes = new Uint8Array(12 * 1024).fill(1);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    ok: true,
    status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => buf,
  };
}

/**
 * A DAM folder that persists across runs — the thing a per-run cap cannot see.
 */
function createFakeDam() {
  const assets = new Map(); // repoPath -> { assetId, repoName, metadata }
  let seq = 0;

  const client = {
    calls: [],
    authorHost: 'https://author.test',
    async buildHeaders(extra = {}) { return { Authorization: '******', ...extra }; },
    async request(op, opts) {
      this.calls.push({ op, path: opts?.path, method: opts?.method });
      const p = opts?.path || '';

      if (op === 'search') {
        return makeRes({
          body: {
            items: [...assets.entries()].map(([repoPath, a]) => ({
              assetId: a.assetId,
              repositoryMetadata: { 'repo:path': repoPath, 'repo:name': a.repoName },
            })),
          },
        });
      }
      if (op === 'rendition') return makeRes({ status: 404 });

      if (op === 'sling') {
        const repoPath = decodeURIComponent(p.split('/jcr:content')[0]);
        const asset = assets.get(repoPath);
        if (!asset) return makeRes({ status: 404, body: {} });
        if (p.includes('jcr:content.json')) {
          return makeRes({ body: { 'dam:assetState': 'processed' } });
        }
        if (opts.method === 'POST') {
          // Sling form write: fold the submitted fields into the stored metadata.
          new URLSearchParams(opts.body || '').forEach((value, key) => {
            if (key.startsWith('./') || key.includes('@')) return;
            asset.metadata[key] = value;
          });
          return makeRes({ status: 200 });
        }
        return makeRes({
          body: { ...asset.metadata, 'dc:format': 'image/png' },
          headers: { ETag: '"v1"' },
        });
      }
      throw new Error(`unexpected op ${op} ${p}`);
    },
  };

  // fetchFn serves the source pages, the image bytes, and the repository upload protocol.
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method || 'GET';

    const cat = CATEGORIES.find((c) => url === pageUrl(c));
    if (cat) {
      const imgs = Array.from(
        { length: IMAGES_PER_PAGE },
        (_, i) => `<img src="/${cat}-${i}.png" alt="${cat} product ${i}">`,
      ).join('');
      return htmlRes(`<title>${cat}</title><h1>${cat}</h1>${imgs}`);
    }

    if (method === 'POST' && url.includes(';api=block_upload_finalize')) {
      return makeRes({ status: 201, headers: { location: lastCreatedPath } });
    }
    if (method === 'POST' && url.includes(';api=block_upload')) {
      return makeRes({
        status: 200,
        body: {
          'repo:blocksize': 10 * 1024 * 1024,
          _links: {
            'http://ns.adobe.com/adobecloud/rel/block/transfer': [{ href: 'https://blob.test/b?1' }],
            'http://ns.adobe.com/adobecloud/rel/block/finalize': { href: 'https://author/x;api=block_upload_finalize;token=t' },
          },
        },
      });
    }
    if (method === 'POST' && url.includes(';api=create')) {
      const m = url.match(/;api=create;path=([^;]+)/);
      const name = m ? decodeURIComponent(m[1]) : '';
      if (!name.includes('.')) return makeRes({ status: 200 }); // folder create
      seq += 1;
      const repoPath = `${FOLDER}/${name}`;
      lastCreatedPath = repoPath;
      assets.set(repoPath, {
        assetId: `urn:aaid:aem:${seq}`, repoName: name, metadata: {},
      });
      return makeRes({ status: 200, headers: { 'asset-id': `urn:aaid:aem:${seq}`, etag: '"0"' } });
    }
    if (method === 'PUT') return makeRes({ status: 201 });

    return assetRes(); // image download
  };

  let lastCreatedPath = '';

  return { assets, client, fetchFn };
}

const generator = async () => ({
  title: 'Product', description: 'desc', keywords: ['product', 'hero', 'launch'],
});

describe('R1 regression: repeated runs converge on the demo shape', () => {
  it('seven single-category runs ship the demo shape, not 7x the assets', async () => {
    const dam = createFakeDam();
    let pagesFetched = 0;
    const countingFetch = async (url, opts) => {
      if (CATEGORIES.some((c) => url === pageUrl(c))) pagesFetched += 1;
      return dam.fetchFn(url, opts);
    };

    // Exactly what the transcript describes: one run per category, no --limit passed.
    for (const cat of CATEGORIES) {
      // eslint-disable-next-line no-await-in-loop
      await enrichAssets({
        options: {
          customerKey: 'acme',
          damPath: FOLDER,
          dryRun: false,
          force: false,
          bringIn: true,
          concurrency: 1,
          limit: null, // the agent omitted --limit on all 15 live invocations
          categoryContract: CONTRACT,
          sourceUrl: pageUrl(cat),
          fetchFn: countingFetch,
        },
        client: dam.client,
        generator,
        log: silent,
      });
    }

    // Runs 6 and 7 never even fetch their source page: at zero remaining capacity the
    // budget binds BEFORE the first network call. On the live run those same two runs
    // downloaded ~72 more images.
    expect(pagesFetched).toBe(MAX_CARDS);

    // The headline assertion: 15, not 252.
    expect(dam.assets.size).toBe(BRING_IN_MAX_IMAGES);

    // And nothing was downloaded that the demo could not use: the live run discarded 202
    // of 252 downloads because the only real cap applied after every byte had arrived.
    const downloaded = dam.assets.size;
    expect(downloaded).toBeLessThanOrEqual(CATEGORIES.length * MAX_ASSETS_PER_CATEGORY);

    // No category may exceed its per-category quota, and the demo may not sprawl past
    // MAX_CARDS categories.
    const byCategory = new Map();
    dam.assets.forEach((a) => {
      const cat = a.metadata.productCategory;
      if (!cat) return;
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    });
    byCategory.forEach((count, cat) => {
      expect(count, `category ${cat} exceeded its quota`).toBeLessThanOrEqual(MAX_ASSETS_PER_CATEGORY);
    });
    expect(byCategory.size).toBeLessThanOrEqual(MAX_CARDS);
  });

  it('an eighth run against a full folder contributes nothing', async () => {
    const dam = createFakeDam();
    let pagesFetched = 0;
    const countingFetch = async (url, opts) => {
      if (CATEGORIES.some((c) => url === pageUrl(c))) pagesFetched += 1;
      return dam.fetchFn(url, opts);
    };
    const run = () => enrichAssets({
      options: {
        customerKey: 'acme',
        damPath: FOLDER,
        dryRun: false,
        force: false,
        bringIn: true,
        concurrency: 1,
        limit: null,
        categoryContract: CONTRACT,
        sourceUrls: CATEGORIES.map(pageUrl),
        fetchFn: countingFetch,
      },
      client: dam.client,
      generator,
      log: silent,
    });

    await run();
    const afterFirst = dam.assets.size;
    const fetchedByFirst = pagesFetched;
    expect(afterFirst).toBe(BRING_IN_MAX_IMAGES);
    expect(fetchedByFirst).toBeGreaterThan(0);

    await run();
    // Idempotence: re-running is safe. This is what makes a mid-run failure recoverable
    // rather than a decision about whether restarting will corrupt the demo — and it is
    // what turns the 88-minute redo after the source-site change into a cheap operation.
    expect(dam.assets.size).toBe(afterFirst);
    // The second run does no work at all: the folder is full, so it never fetches a page.
    expect(pagesFetched).toBe(fetchedByFirst);
  });

  it('omitting --limit does not disable the budget (R2)', async () => {
    const dam = createFakeDam();
    await enrichAssets({
      options: {
        customerKey: 'acme',
        damPath: FOLDER,
        dryRun: false,
        force: false,
        bringIn: true,
        concurrency: 1,
        limit: null,
        categoryContract: CONTRACT,
        sourceUrls: CATEGORIES.map(pageUrl),
        fetchFn: dam.fetchFn,
      },
      client: dam.client,
      generator,
      log: silent,
    });
    // Previously overallLimit was null without --limit, leaving the cross-page merge
    // unbounded: 7 pages x 30 images.
    expect(dam.assets.size).toBeLessThanOrEqual(BRING_IN_MAX_IMAGES);
    expect(dam.assets.size).toBeLessThan(CATEGORIES.length * IMAGES_PER_PAGE);
  });
});

/**
 * B3 — the generator cap removes the PAYOFF rather than forbidding the action.
 *
 * Assets can reach AEM by routes no gate can observe (raw curl, an ad-hoc .mjs importing
 * internals, a hand-written contract). None of those routes matter if the page generator
 * structurally cannot render them.
 */
describe('B3: an oversized report still yields the demo shape', () => {
  const indexHtml = [
    '<div class="carousel tiles"><div><div><picture></picture></div><div><h3>Old</h3></div></div></div>',
    '<div class="cards"><div><div><picture></picture></div><div><h3>OldBrand</h3></div></div></div>',
  ].join('\n');

  it('9 categories x 20 assets still emits at most MAX_CARDS cards', () => {
    const cards = Array.from({ length: 9 }, (_, i) => ({
      slug: `cat${i}`,
      label: `Cat${i}`,
      blurb: 'b',
      href: `/en/search?facetFilters=cat${i}`,
      cardImageUrl: `https://content.da.live/o/r/media_cat${i}.jpg`,
    }));
    const out = updateIndexCards(indexHtml, { cards });
    const rendered = cards.filter((c) => out.includes(`<h3>${c.label}</h3>`));
    expect(rendered).toHaveLength(MAX_CARDS);
    // ...and the Top Brands block is gone rather than repopulated.
    expect(out).not.toContain('class="cards"');
  });

  it('the card gate rejects a report that exceeds the ceiling', () => {
    const card = (i) => ({
      slug: `c${i}`, label: `C${i}`, href: `/h${i}`, cardImageUrl: `/i${i}.jpg`,
    });
    const tooMany = { cards: Array.from({ length: MAX_CARDS + 1 }, (_, i) => card(i)) };
    expect(checkCardGate(tooMany, []).ok).toBe(false);
    const exact = { cards: Array.from({ length: MAX_CARDS }, (_, i) => card(i)) };
    expect(checkCardGate(exact, []).ok).toBe(true);
  });
});
