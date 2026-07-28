/**
 * "Popular" badge threshold — relative to the currently loaded page of results
 * rather than a fixed count, so the badge stays meaningful regardless of data volume.
 */

const POPULAR_TOP_N = 3;
// Recent (7-day) downloads count extra toward the popularity score, on top of
// already being included in the 30-day total, so momentum outweighs stale volume.
const RECENT_WEIGHT = 3;

/**
 * Weighted popularity score combining total 30-day volume with recent (7-day) momentum.
 * @param {{downloads7Days?: number, downloads30Days?: number}} image - Asset
 * @returns {number} Popularity score
 */
export function getPopularScore(image) {
  const downloads7Days = image?.downloads7Days || 0;
  const downloads30Days = image?.downloads30Days || 0;
  return downloads30Days + RECENT_WEIGHT * downloads7Days;
}

/**
 * Compute the minimum popularity score an asset needs to be flagged "Popular",
 * based on the top N scores among the given images.
 * @param {Array<{downloads7Days?: number, downloads30Days?: number}>} images - Currently
 *   loaded page of assets
 * @returns {number} Threshold; assets with a score >= this value are "Popular".
 *   Returns Infinity (no badge shown) when there's no meaningful download activity.
 */
export function getPopularThreshold(images) {
  const scores = images
    .map((image) => getPopularScore(image))
    .filter((score) => score > 0)
    .sort((a, b) => b - a);

  if (scores.length === 0) return Infinity;

  return scores[Math.min(POPULAR_TOP_N, scores.length) - 1];
}
