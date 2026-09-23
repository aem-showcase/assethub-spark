import { describe, it, expect } from 'vitest';
import { buildProductCategoryRepresentatives } from '../../scripts/assets/representatives.js';

describe('buildProductCategoryRepresentatives', () => {
  it('selects the first asset per productCategory and reports missing expected groups', () => {
    const report = buildProductCategoryRepresentatives([
      {
        asset: {
          assetId: 'a1',
          repoPath: '/content/dam/acme/swift.jpg',
          repoName: 'swift.jpg',
        },
        fields: {
          title: 'Swift',
          productCategory: 'hatchback',
          keywords: ['swift'],
        },
      },
      {
        asset: {
          assetId: 'a2',
          repoPath: '/content/dam/acme/baleno.jpg',
          repoName: 'baleno.jpg',
        },
        fields: {
          title: 'Baleno',
          productCategory: 'hatchback',
        },
      },
      {
        asset: {
          assetId: 'a3',
          repoPath: '/content/dam/acme/brezza.jpg',
          repoName: 'brezza.jpg',
        },
        fields: {
          title: 'Brezza',
          productCategory: 'suv',
        },
      },
    ], {
      expectedCategories: ['hatchback', 'sedan', 'suv'],
    });

    expect(report).toMatchObject({
      groupBy: 'productCategory',
      expected: ['hatchback', 'sedan', 'suv'],
      missing: ['sedan'],
    });
    expect(report.items.hatchback).toMatchObject({
      assetId: 'a1',
      assetPath: '/content/dam/acme/swift.jpg',
      productCategory: 'hatchback',
      source: 'planned-enrichment',
    });
    expect(report.items.suv).toMatchObject({
      assetId: 'a3',
      productCategory: 'suv',
    });
    // cardImageUrl is NOT set here — it's materialized later by da-card-images.js after a
    // real DA upload. Setting it in this selection step was the old worker-proxy pattern,
    // which is removed (verified broken live for statically published landing cards).
    expect(report.items.hatchback.cardImageUrl).toBeUndefined();
  });

  // --hero-map (Todo 9). Automatic ranking picks the content-richest asset, which on a
  // live run repeatedly selected a flat logo over a real product shot. The agent's only
  // recourse was a hand-written fix-up script (fix-grocery-hero.mjs); this pin is the
  // supported replacement. It matters more now that a category carries 2-3 assets rather
  // than dozens, so the ranking pool is small.
  const plans = [
    {
      asset: { assetId: 'a1', repoPath: '/content/dam/acme/logo.png', repoName: 'logo.png' },
      fields: {
        title: 'Acme Logo',
        productCategory: 'grocery',
        keywords: ['acme', 'brand', 'logo'],
        description: 'A long, keyword-rich description that scores highly.',
      },
    },
    {
      asset: { assetId: 'a2', repoPath: '/content/dam/acme/apples.jpg', repoName: 'apples.jpg' },
      fields: { title: 'Apples', productCategory: 'grocery' },
    },
  ];

  it('pins a category hero by repoName, overriding the richness score', () => {
    const ranked = buildProductCategoryRepresentatives(plans, {});
    expect(ranked.items.grocery.assetId).toBe('a1');

    const pinned = buildProductCategoryRepresentatives(plans, {
      heroMap: { grocery: 'apples.jpg' },
    });
    expect(pinned.items.grocery.assetId).toBe('a2');
  });

  it('pins by assetId and is case-insensitive', () => {
    const pinned = buildProductCategoryRepresentatives(plans, {
      heroMap: { grocery: 'A2' },
    });
    expect(pinned.items.grocery.assetId).toBe('a2');
  });

  it('falls back to ranking when the pin matches nothing in that category', () => {
    const pinned = buildProductCategoryRepresentatives(plans, {
      heroMap: { grocery: 'not-uploaded.jpg', beverages: 'x.jpg' },
    });
    expect(pinned.items.grocery.assetId).toBe('a1');
  });

  it('a pin in one category does not disturb another', () => {
    const withSuv = [
      ...plans,
      {
        asset: { assetId: 'a3', repoPath: '/content/dam/acme/brezza.jpg', repoName: 'brezza.jpg' },
        fields: { title: 'Brezza', productCategory: 'suv' },
      },
    ];
    const pinned = buildProductCategoryRepresentatives(withSuv, {
      heroMap: { grocery: 'apples.jpg' },
    });
    expect(pinned.items.grocery.assetId).toBe('a2');
    expect(pinned.items.suv.assetId).toBe('a3');
  });
});
