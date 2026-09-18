import { describe, it, expect } from 'vitest';
import {
  cardRowHtml,
  cardsBlockInnerHtml,
  replaceBlockRows,
  splitTopLevelRows,
  removeBlock,
  updateIndexCards,
} from '../../scripts/assets/update-index-cards.js';
import { MAX_CARDS } from '../../scripts/assets/constants.js';

const cardA = {
  slug: 'dermatology',
  label: 'Dermatology',
  blurb: 'Skin condition imagery.',
  href: '/en/search?facetFilters=%7B%22productCategory%22%3A%7B%22dermatology%22%3Atrue%7D%7D',
  cardImageUrl: 'https://content.da.live/org/repo/company/en/media_dermatology.jpg',
};
const cardB = {
  slug: 'cancer',
  label: 'Cancer',
  blurb: 'Oncology imagery.',
  href: '/en/search?facetFilters=cancer',
  cardImageUrl: 'https://content.da.live/org/repo/company/en/media_cancer.jpg',
};

describe('cardRowHtml', () => {
  it('authors image cell + heading + blurb + facet Browse link', () => {
    const html = cardRowHtml(cardA);
    expect(html).toContain(`src="${cardA.cardImageUrl}"`);
    expect(html).toContain(`srcset="${cardA.cardImageUrl}"`);
    expect(html).not.toContain('/api/adobe/assets/');
    expect(html).toContain('<h3>Dermatology</h3>');
    expect(html).toContain('Skin condition imagery.');
    expect(html).toContain(`<a href="${cardA.href}">Browse →</a>`);
  });

  it('authors a linked-heading tile when withBrowseLink is false', () => {
    const html = cardRowHtml(cardB, { withBrowseLink: false });
    expect(html).toContain('<h3><a href="/en/search?facetFilters=cancer">Cancer</a></h3>');
    expect(html).not.toContain('Browse →');
  });
});

describe('replaceBlockRows', () => {
  it('replaces the inner rows of the matching block, preserving the wrapper', () => {
    const html = '<div class="carousel tiles"><div>OLD</div></div>';
    const out = replaceBlockRows(html, ['carousel', 'tiles'], '<div>NEW</div>');
    expect(out).toContain('<div class="carousel tiles">');
    expect(out).toContain('<div>NEW</div>');
    expect(out).not.toContain('OLD');
  });

  it('balances nested divs so it replaces the whole block, not the first close', () => {
    const html = '<div class="cards"><div><div>inner</div></div></div>AFTER';
    const out = replaceBlockRows(html, ['cards'], 'X');
    expect(out).toBe('<div class="cards">\nX\n</div>AFTER');
  });

  it('throws when the block is absent', () => {
    expect(() => replaceBlockRows('<div class="other"></div>', ['cards'], 'X')).toThrow();
  });
});

// The route that actually happened. A live run's `apply-index-cards.mjs` imported
// `replaceBlockRows` directly rather than calling updateIndexCards, so a ceiling that
// lived only in the orchestrator would have been bypassed by the one deviation observed
// in practice. These tests pin the cap to the primitives themselves.
describe('ceiling holds when the primitives are imported directly (ad-hoc script route)', () => {
  const manyCards = Array.from({ length: 9 }, (_, i) => ({
    ...cardA, slug: `c${i}`, label: `Cat ${i}`,
  }));

  it('cardsBlockInnerHtml emits at most MAX_CARDS rows', () => {
    const inner = cardsBlockInnerHtml(manyCards, { withBrowseLink: true });
    expect(splitTopLevelRows(inner)).toHaveLength(MAX_CARDS);
  });

  it('replaceBlockRows trims caller-built HTML to MAX_CARDS rows', () => {
    // Bypasses cardsBlockInnerHtml entirely — hand-rolled row HTML, as a script that
    // reimplements the markup would produce.
    const handRolled = Array.from(
      { length: 12 },
      (_, i) => `<div><div>img${i}</div><div><h3>Cat ${i}</h3></div></div>`,
    ).join('\n');
    const out = replaceBlockRows(
      '<div class="carousel tiles"><div>OLD</div></div>',
      ['carousel', 'tiles'],
      handRolled,
    );
    expect(out).toContain('Cat 0');
    expect(out).not.toContain('Cat 5');
    expect(out).not.toContain('Cat 11');
  });

  it('does not trim a block that carries fewer rows than the ceiling', () => {
    const three = Array.from({ length: 3 }, (_, i) => `<div><h3>Cat ${i}</h3></div>`).join('\n');
    const out = replaceBlockRows('<div class="cards"><div>OLD</div></div>', ['cards'], three);
    expect(out).toContain('Cat 0');
    expect(out).toContain('Cat 2');
  });

  it('leaves non-card blocks untouched, however many rows they carry', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<div>row${i}</div>`).join('\n');
    const out = replaceBlockRows('<div class="columns"><div>OLD</div></div>', ['columns'], rows);
    expect(out).toContain('row11');
  });

  it('splitTopLevelRows counts nested rows as one', () => {
    expect(splitTopLevelRows('<div><div>a</div><div>b</div></div><div>c</div>')).toHaveLength(2);
  });
});

describe('removeBlock', () => {
  it('removes the whole block including its wrapper', () => {
    const html = '<p>a</p><div class="cards"><div><span>x</span></div></div><p>b</p>';
    expect(removeBlock(html, ['cards'])).toBe('<p>a</p><p>b</p>');
  });

  it('returns the HTML unchanged when the block is absent', () => {
    const html = '<p>a</p><div class="other"></div>';
    expect(removeBlock(html, ['cards'])).toBe(html);
  });
});

describe('updateIndexCards', () => {
  const indexHtml = [
    '<div class="search-hero category-tiles">',
    '<h2 id="browse-by-category">Browse by category</h2>',
    '<div class="carousel tiles"><div><div><picture></picture></div><div><h3>Old</h3></div></div></div>',
    '<h2 id="top-areas">Top Areas</h2>',
    '<div class="cards"><div><div><picture></picture></div><div><h3>OldBrand</h3></div></div></div>',
    '</div>',
  ].join('\n');

  it('rewrites the carousel from report.cards and removes the Top Brands block', () => {
    const out = updateIndexCards(indexHtml, { cards: [cardA, cardB] });
    expect(out).toContain('<h3>Dermatology</h3>');
    expect(out).toContain('<h3>Cancer</h3>');
    expect(out).toContain('Browse →');
    expect(out).not.toContain('<h3>Old</h3>');
    // The secondary "Top Brands" block is removed outright, so its copied placeholder
    // content cannot ship stale.
    expect(out).not.toContain('<h3>OldBrand</h3>');
    expect(out).not.toContain('class="cards"');
  });

  it('is a no-op on the Top Brands block when it has already been removed', () => {
    const withoutTop = [
      '<div class="search-hero category-tiles">',
      '<div class="carousel tiles"><div><div><picture></picture></div><div><h3>Old</h3></div></div></div>',
      '</div>',
    ].join('\n');
    const out = updateIndexCards(withoutTop, { cards: [cardA] });
    expect(out).toContain('<h3>Dermatology</h3>');
  });

  it('caps the carousel at MAX_CARDS however many cards the report holds', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...cardA, label: `Cat${i}`, slug: `cat${i}`, href: `/en/search?facetFilters=cat${i}`,
    }));
    const out = updateIndexCards(indexHtml, { cards: many });
    const rendered = many.filter((c) => out.includes(`<h3>${c.label}</h3>`));
    expect(rendered).toHaveLength(MAX_CARDS);
    expect(out).toContain('<h3>Cat0</h3>');
    expect(out).not.toContain('<h3>Cat8</h3>');
  });

  it('throws on an empty report', () => {
    expect(() => updateIndexCards(indexHtml, { cards: [] })).toThrow();
  });
});
