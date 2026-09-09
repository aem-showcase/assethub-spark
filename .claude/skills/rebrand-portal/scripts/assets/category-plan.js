/**
 * Category assignment against the source-derived contract.
 *
 * The category vocabulary is the contract the migration derives from the source site at
 * Step 4 (one shared set of {slug,label} used by homepage cards, facet links, asset
 * productCategory, and collections). This module does NOT invent categories and does NOT
 * carry a hardcoded keyword vocabulary — a fixed keyword table can never be generic across
 * verticals (a retail term list silently drops every pharma/finance/etc. asset).
 *
 * Each asset is mapped to exactly one contract slug by an injected classifier. In a real
 * run the agent supplies a `fileName -> slug` map it wrote from the dry-run evidence — per
 * asset that evidence is title + description (AEM's autogen:title/autogen:description), smart
 * tags (autogen:subject/predictedTags), and the filename (--category-map); tests inject a
 * stub. The map is keyed by fileName (assetId as a fallback) only because that is the stable
 * identifier a human writes down; the agent decides the slug from the full evidence, not the
 * filename alone. When the classifier declines an asset, a round-robin over the contract still
 * lands it in a slug — assignment is mandatory, so every asset ends up in exactly one contract
 * category and no homepage card is ever empty.
 */

import { FIELD, AUTOGEN_FIELD } from './constants.js';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function slugifyCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function humanizeCategorySlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Facet-filter search URL for a category slug — the exact shape the DA index cards use. */
export function categorySearchUrl(slug, { basePath = '/en' } = {}) {
  const facetFilters = JSON.stringify({ productCategory: { [slug]: true } });
  return `${basePath}/search?facetFilters=${encodeURIComponent(facetFilters)}`;
}

function stringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

export function autogenSubjectTerms(metadata = {}) {
  return [
    ...stringArray(metadata[AUTOGEN_FIELD.SUBJECT]),
    ...stringArray(metadata[AUTOGEN_FIELD.PREDICTED_TAGS]),
  ].map((v) => v.toLowerCase());
}

/**
 * The evidence bundle handed to the classifier for one asset. Real AEM signal first
 * (autogen:subject/predictedTags smart tags, dc:* fields), then generated fields, then
 * filename/source-page context.
 */
export function assetEvidence(asset = {}, metadata = {}, fields = {}) {
  return {
    assetId: asset.assetId || null,
    fileName: asset.fileName || asset.repoName || null,
    sourcePage: asset.sourcePage || null,
    heading: asset.heading || null,
    altText: asset.altText || null,
    nearbyText: asset.nearbyText || null,
    smartTags: autogenSubjectTerms(metadata),
    autogenTitle: cleanString(metadata[AUTOGEN_FIELD.TITLE]),
    autogenDescription: cleanString(metadata[AUTOGEN_FIELD.DESCRIPTION]),
    dcTitle: cleanString(metadata[FIELD.TITLE]) || cleanString(fields.title),
    dcDescription: cleanString(metadata[FIELD.DESCRIPTION]) || cleanString(fields.description),
    dcSubject: stringArray(metadata[FIELD.SUBJECT]),
    keywords: Array.isArray(fields.keywords) ? fields.keywords : [],
  };
}

/**
 * Round-robin fallback: hand out contract slugs in order so unmapped assets still spread
 * across every card instead of piling into the first one. This runs only when the injected
 * classifier declines an asset (no --category-map entry); a mapped run never reaches it.
 * Stateful across calls within one plan pass, so N unmapped assets land in N different slugs
 * (cycling) rather than all in slug[0] — the card gate needs no empty buckets.
 */
export function roundRobinFallback(contract = []) {
  const slugs = contract.map((c) => c && c.slug).filter(Boolean);
  let next = 0;
  return () => {
    if (slugs.length === 0) return null;
    const slug = slugs[next % slugs.length];
    next += 1;
    return { slug, confidence: 'fallback' };
  };
}

function contractSlugSet(contract = []) {
  return new Set(contract.map((c) => c && c.slug).filter(Boolean));
}

/** Map an arbitrary value onto the nearest contract slug (exact, else slugified match). */
function coerceToContract(value, contract = []) {
  const slug = slugifyCategory(value);
  if (!slug) return null;
  const slugs = contractSlugSet(contract);
  if (slugs.has(slug)) return slug;
  return null;
}

/**
 * Assign a contract category to every planned asset.
 *
 * @param {Array<{asset,fields,existingMetadata,skip}>} planned
 * @param {Object} options
 * @param {Array<{slug,label}>} options.contract  source-derived category contract (required)
 * @param {(evidence)=>{slug,confidence}|string|null} [options.classifier]  injected classifier
 *   (real run: agent's fileName->slug map lookup). When absent or it declines an asset, a
 *   round-robin over the contract still assigns a slug (mandatory single-category).
 * @returns {Array} planned with fields.productCategory set + categoryAssignment
 */
export function applyCategoryPlan(planned = [], options = {}) {
  const contract = Array.isArray(options.contract)
    ? options.contract.filter((c) => c && c.slug)
    : [];
  const classify = options.classifier || (() => null);
  const fallback = roundRobinFallback(contract);

  return planned.map((plan) => {
    if (!plan || !plan.fields || plan.error) return plan;
    const fields = { ...plan.fields };
    const metadata = plan.existingMetadata || {};

    // 1) Existing contract-valid productCategory wins.
    const existing = coerceToContract(metadata[FIELD.PRODUCT_CATEGORY], contract);
    if (existing) {
      fields.productCategory = existing;
      return {
        ...plan,
        fields,
        categoryAssignment: { slug: existing, confidence: 'existing', reason: 'existing-metadata' },
      };
    }

    // 2) A generated productCategory that is already a contract slug wins.
    const generated = coerceToContract(fields.productCategory, contract);
    if (generated) {
      fields.productCategory = generated;
      return {
        ...plan,
        fields,
        categoryAssignment: { slug: generated, confidence: 'generated', reason: 'generated-field' },
      };
    }

    // 3) Ask the injected classifier (agent's fileName->slug map). Mandatory assignment: if it
    //    declines or returns a slug outside the contract, round-robin still lands one.
    const evidence = assetEvidence(plan.asset, metadata, fields);
    const result = classify(evidence);
    let slug = coerceToContract(typeof result === 'string' ? result : result?.slug, contract);
    let confidence = (result && typeof result === 'object' && result.confidence) || 'classified';
    if (!slug) {
      slug = fallback()?.slug || null;
      confidence = 'fallback';
    }

    if (slug) fields.productCategory = slug;
    return {
      ...plan,
      fields,
      categoryAssignment: slug
        ? { slug, confidence, reason: 'classified' }
        : null,
    };
  });
}

export function buildCategoryCoverage(planned = []) {
  const categories = new Map();
  const unclassified = [];

  for (const plan of planned) {
    if (!plan || plan.error) continue;
    const category = cleanString(plan.fields?.productCategory);
    if (!category) {
      unclassified.push(plan.asset?.assetId || plan.asset?.repoPath || plan.asset?.repoName || 'unknown');
      continue;
    }
    const slug = slugifyCategory(category) || category;
    const existing = categories.get(slug) || {
      slug,
      label: humanizeCategorySlug(slug),
      assetCount: 0,
    };
    existing.assetCount += 1;
    categories.set(slug, existing);
  }

  return {
    categories: [...categories.values()].sort((a, b) => b.assetCount - a.assetCount),
    unclassified,
  };
}
