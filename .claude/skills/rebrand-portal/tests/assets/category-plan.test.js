import { describe, it, expect } from 'vitest';
import {
  applyCategoryPlan,
  buildCategoryCoverage,
  slugifyCategory,
  categorySearchUrl,
  roundRobinFallback,
} from '../../scripts/assets/category-plan.js';
import { buildMapClassifier } from '../../scripts/assets/enrich-assets.js';

// Contracts are the source-derived vocabulary threaded in from Step 4 — no hardcoded list.
const PHARMA = [
  { slug: 'dermatology', label: 'Dermatology' },
  { slug: 'cancer', label: 'Cancer' },
  { slug: 'diabetes', label: 'Diabetes' },
];
const RETAIL = [
  { slug: 'coffee', label: 'Coffee' },
  { slug: 'machines', label: 'Machines' },
];

describe('category-plan', () => {
  it('keeps an existing contract-valid productCategory', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'anything.jpg' },
      fields: { title: 'Anything' },
      existingMetadata: { productCategory: 'cancer' },
    }], { contract: PHARMA });
    expect(plan.fields.productCategory).toBe('cancer');
    expect(plan.categoryAssignment.reason).toBe('existing-metadata');
  });

  it('honors a generated productCategory that is already a contract slug', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'hero.jpg' },
      fields: { title: 'Foo', productCategory: 'diabetes' },
      existingMetadata: {},
    }], { contract: PHARMA });
    expect(plan.fields.productCategory).toBe('diabetes');
    expect(plan.categoryAssignment.reason).toBe('generated-field');
  });

  it('uses an injected classifier (agent map) when provided', () => {
    const classifier = () => ({ slug: 'cancer', confidence: 'mapped' });
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'unknown.jpg' },
      fields: { title: 'X' },
      existingMetadata: {},
    }], { contract: PHARMA, classifier });
    expect(plan.fields.productCategory).toBe('cancer');
    expect(plan.categoryAssignment.confidence).toBe('mapped');
  });

  it('the injected classifier drives the SAME code across different contracts', () => {
    const classifier = () => ({ slug: 'machines', confidence: 'mapped' });
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'espresso-machine.jpg' },
      fields: { title: 'Brewer' },
      existingMetadata: {},
    }], { contract: RETAIL, classifier });
    expect(plan.fields.productCategory).toBe('machines');
  });

  it('mandatory assignment: an unmapped asset still lands in a contract slug (round-robin)', () => {
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'asset.bin' },
      fields: { title: 'Asset' },
      existingMetadata: {},
    }], { contract: PHARMA });
    expect(PHARMA.map((c) => c.slug)).toContain(plan.fields.productCategory);
    expect(plan.categoryAssignment.confidence).toBe('fallback');
  });

  it('re-maps an injected slug outside the contract via the round-robin fallback', () => {
    const classifier = () => ({ slug: 'not-a-contract-slug' });
    const [plan] = applyCategoryPlan([{
      asset: { assetId: 'a1', repoName: 'psoriasis-patient.jpg' },
      fields: { title: 'X' },
      existingMetadata: {},
    }], { contract: PHARMA, classifier });
    expect(PHARMA.map((c) => c.slug)).toContain(plan.fields.productCategory);
    expect(plan.categoryAssignment.confidence).toBe('fallback');
  });

  it('builds coverage from map-assigned categories', () => {
    const classifier = buildMapClassifier({
      'cancer-story.jpg': 'cancer',
      'diabetes-care.jpg': 'diabetes',
    });
    const plans = applyCategoryPlan([
      { asset: { assetId: 'a1', fileName: 'cancer-story.jpg' }, fields: { title: 'A' }, existingMetadata: {} },
      { asset: { assetId: 'a2', fileName: 'diabetes-care.jpg' }, fields: { title: 'B' }, existingMetadata: {} },
    ], { contract: PHARMA, classifier });
    const coverage = buildCategoryCoverage(plans);
    const slugs = coverage.categories.map((c) => c.slug).sort();
    expect(slugs).toEqual(['cancer', 'diabetes']);
    expect(coverage.unclassified).toEqual([]);
  });

  it('slugifies display categories', () => {
    expect(slugifyCategory('SUVs & Electric')).toBe('suvs-and-electric');
  });

  it('builds the facet-filter search URL used by DA index cards', () => {
    expect(categorySearchUrl('dermatology')).toBe(
      '/en/search?facetFilters=%7B%22productCategory%22%3A%7B%22dermatology%22%3Atrue%7D%7D',
    );
  });

  it('buildMapClassifier keys on fileName and falls back to assetId', () => {
    const classifier = buildMapClassifier({ 'cap.png': 'accessories', 'asset-2': 'diabetes' });
    expect(classifier({ fileName: 'cap.png', assetId: 'asset-1' }).slug).toBe('accessories');
    expect(classifier({ fileName: 'other.png', assetId: 'asset-2' }).slug).toBe('diabetes');
    expect(classifier({ fileName: 'none.png', assetId: 'asset-3' })).toBe(null);
  });

  it('map wins over round-robin; unmapped assets still spread across slugs', () => {
    // Only the merchandise cap is mapped (the case the old overlap classifier got wrong).
    const classifier = buildMapClassifier({ 'cap.png': 'accessories' });
    const planned = [
      { asset: { assetId: 'a1', fileName: 'cap.png' }, fields: {}, existingMetadata: {} },
      { asset: { assetId: 'a2', fileName: 'unknown-1.png' }, fields: {}, existingMetadata: {} },
      { asset: { assetId: 'a3', fileName: 'unknown-2.png' }, fields: {}, existingMetadata: {} },
    ];
    const META = [
      { slug: 'smart-glasses', label: 'Smart Glasses' },
      { slug: 'accessories', label: 'Accessories' },
    ];
    const out = applyCategoryPlan(planned, { contract: META, classifier });
    expect(out[0].fields.productCategory).toBe('accessories');
    // The two unmapped assets round-robin across BOTH slugs — neither card is empty.
    const fallbackSlugs = [out[1].fields.productCategory, out[2].fields.productCategory];
    expect(new Set(fallbackSlugs)).toEqual(new Set(['smart-glasses', 'accessories']));
  });

  it('roundRobinFallback cycles through the contract slugs in order', () => {
    const next = roundRobinFallback([{ slug: 'a' }, { slug: 'b' }]);
    expect([next().slug, next().slug, next().slug]).toEqual(['a', 'b', 'a']);
  });
});
