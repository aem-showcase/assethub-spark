import { describe, it, expect } from 'vitest';
import { applyCategoryPlan, buildCategoryCoverage, slugifyCategory } from '../category-plan.js';

describe('category-plan', () => {
  it('keeps existing productCategory values', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'anything.jpg' },
      fields: { title: 'Anything' },
      existingMetadata: { productCategory: 'existing-category' },
    }]);
    expect(plan.fields.productCategory).toBe('existing-category');
    expect(plan.categoryAssignment.reason).toBe('existing-metadata');
  });

  it('uses explicit source category when discovery provides one', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', sourceCategory: 'Product Galleries', heading: 'Foo' },
      fields: { title: 'Foo' },
      existingMetadata: {},
    }]);
    expect(plan.fields.productCategory).toBe('product-galleries');
    expect(plan.categoryAssignment.confidence).toBe('high');
  });

  it('infers generic categories from source evidence', () => {
    const [plan] = applyCategoryPlan([{
      asset: {
        assetId: 'a1',
        repoName: 'hero.jpg',
        sourcePage: 'https://brand.example/en/models/foo',
        heading: 'Foo model range',
      },
      fields: { title: 'Foo Hero' },
      existingMetadata: {},
    }]);
    expect(plan.fields.productCategory).toBe('products');
    expect(plan.categoryAssignment.reason).toBe('source-evidence');
  });

  it('does not invent a category without evidence', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'asset.bin' },
      fields: { title: 'Asset' },
      existingMetadata: {},
    }]);
    expect(plan.fields.productCategory).toBeUndefined();
  });

  it('builds coverage only from categories with assets', () => {
    const plans = applyCategoryPlan([
      {
        asset: { assetId: 'a1', sourceCategory: 'Products', sourcePage: 'https://x/products' },
        fields: { title: 'A' },
        existingMetadata: {},
      },
      {
        asset: { assetId: 'a2', repoName: 'asset.bin' },
        fields: { title: 'B' },
        existingMetadata: {},
      },
    ]);
    const coverage = buildCategoryCoverage(plans);
    expect(coverage.categories).toMatchObject([{ slug: 'products', assetCount: 1 }]);
    expect(coverage.unclassified).toEqual(['a2']);
  });

  it('slugifies display categories', () => {
    expect(slugifyCategory('SUVs & Electric')).toBe('suvs-and-electric');
  });
});
