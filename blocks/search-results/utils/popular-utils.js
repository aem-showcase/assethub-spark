/* eslint-disable import/prefer-default-export */
/**
 * "Popular" badge threshold — relative to the currently loaded page of results
 * rather than a fixed count, so the badge stays meaningful regardless of data volume.
 */

const POPULAR_TOP_N = 3;

/**
 * Compute the minimum downloads7Days value an asset needs to be flagged "Popular",
 * based on the top N download counts among the given images.
 * @param {Array<{downloads7Days?: number}>} images - Currently loaded page of assets
 * @returns {number} Threshold; assets with downloads7Days >= this value are "Popular".
 *   Returns Infinity (no badge shown) when there's no meaningful download activity.
 */
export function getPopularThreshold(images) {
  const counts = images
    .map((image) => image.downloads7Days || 0)
    .filter((count) => count > 0)
    .sort((a, b) => b - a);

  if (counts.length === 0) return Infinity;

  return counts[Math.min(POPULAR_TOP_N, counts.length) - 1];
}
