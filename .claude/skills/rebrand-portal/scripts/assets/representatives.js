/**
 * Select representative assets from a planned enrichment run.
 *
 * Step 5 uses this report data to update copied DA cards/top-model visuals without
 * mixing DA page edits into the AEM Assets metadata controller.
 *
 * NOTE: `cardImageUrl` is NOT set here. The worker-proxy path
 * (`/api/adobe/assets/<id>/as/<file>.jpg`) that used to be built in this module is broken
 * for landing-card images — verified live: it depends on the *visitor's* session cookie,
 * which a statically published DA doc never has, and the cards rendered broken/alt-text
 * even for a signed-in user. Card images are instead uploaded to DA as ordinary page
 * images (see da-card-images.js) and that DA source URL is attached to each representative
 * by the enrichment controller, after this selection step runs.
 *
 * Representative RANKING (why not just the first asset): a category's card hero must be
 * real product/brand imagery, not a flat logo, wordmark, or a piece of site chrome (a nav
 * banner, a menu graphic) that happened to sort first. The signal used is AEM's OWN
 * asset-processing output — the same evidence the classifier trusts — never a filename
 * keyword list (a denylist wrongly drops a real product whose name says "banner" and misses
 * chrome that isn't named so). AEM's vision pipeline emits many smart tags plus a rich
 * autogen description for a photograph, and little/none for a flat logo/wordmark/graphic.
 * So richer AEM-derived content ranks higher; a tie falls back to first-seen (stable).
 */

import { autogenSubjectTerms } from './category-plan.js';

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Content-richness score from AEM's own processing output — higher = more photo-like,
 * lower = flatter (logo/wordmark/UI chrome). No filename inspection.
 *   - smart-tag count: a photo gets many object/scene tags; a flat graphic gets few.
 *   - autogen description present: AEM describes photographs, not blank wordmarks.
 */
function contentRichnessScore(plan) {
  const metadata = plan?.existingMetadata || {};
  const smartTags = autogenSubjectTerms(metadata);
  const hasAutogenDescription = Boolean(cleanString(plan?.fields?.description));
  return smartTags.length + (hasAutogenDescription ? 1 : 0);
}

function representativeFor(plan, groupValue) {
  const { asset, fields = {}, skip } = plan;
  return {
    productCategory: groupValue,
    assetId: cleanString(asset.assetId),
    assetPath: cleanString(asset.repoPath),
    repoName: cleanString(asset.repoName),
    title: cleanString(fields.title) || cleanString(asset.repoName),
    description: cleanString(fields.description),
    keywords: Array.isArray(fields.keywords) ? fields.keywords : [],
    // AEM smart tags on the chosen hero — the hero-quality check (verify.mjs) reads these to
    // flag a flat logo/chrome hero (no content signal) without inspecting the filename.
    smartTags: autogenSubjectTerms(plan?.existingMetadata || {}),
    source: skip ? 'already-enriched' : 'planned-enrichment',
  };
}

/**
 * Build one representative asset per productCategory.
 *
 * @param {Array<{asset:Object,fields?:Object,skip?:boolean}>} planned
 * @param {Object} options
 * @param {string[]} [options.expectedCategories] category slugs from curated cards
 * @returns {{groupBy:string,expected:string[],missing:string[],items:Object}}
 */
export function buildProductCategoryRepresentatives(planned = [], options = {}) {
  const expected = Array.isArray(options.expectedCategories)
    ? options.expectedCategories.map(cleanString).filter(Boolean)
    : [];
  const items = {};

  // Keep the best-scoring plan seen per category, not the first. Iteration order is stable,
  // so a strict `>` comparison leaves the first-seen asset winning any tie (never regresses
  // a category to a worse-scoring later asset).
  const best = {};
  planned.forEach((plan, index) => {
    const groupValue = cleanString(plan?.fields?.productCategory);
    if (!groupValue) return;
    const score = contentRichnessScore(plan);
    const current = best[groupValue];
    if (!current || score > current.score) {
      best[groupValue] = { plan, score, index };
    }
  });
  for (const [groupValue, { plan }] of Object.entries(best)) {
    items[groupValue] = representativeFor(plan, groupValue);
  }

  const missing = expected.filter((category) => !items[category]);
  return {
    groupBy: 'productCategory',
    expected,
    missing,
    items,
  };
}
