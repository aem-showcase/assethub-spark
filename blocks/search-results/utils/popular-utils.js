/**
 * "Popular" badge threshold — a fixed score cutoff so the badge means the same
 * thing everywhere (not relative to whatever page/batch happens to be loaded).
 */

// Recent (7-day) downloads count extra toward the popularity score, on top of
// already being included in the 30-day total, so momentum outweighs stale volume.
const RECENT_WEIGHT = 3;
const POPULAR_SCORE_THRESHOLD = 300;

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
 * Fixed minimum popularity score an asset needs to be flagged "Popular".
 * @returns {number} Threshold; assets with a score >= this value are "Popular".
 */
export function getPopularThreshold() {
  return POPULAR_SCORE_THRESHOLD;
}

const RECENTLY_DOWNLOADED_WINDOW_DAYS = 7;

/**
 * Whether an asset was downloaded within the last N days, based on lastDownloadedAt.
 * @param {{lastDownloadedAt?: string|number}} image - Asset
 * @returns {boolean} True if downloaded within the recent window
 */
export function isRecentlyDownloaded(image) {
  const raw = image?.lastDownloadedAt;
  if (!raw) return false;
  const downloadedAt = new Date(raw);
  if (Number.isNaN(downloadedAt.getTime())) return false;
  const windowMs = RECENTLY_DOWNLOADED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - downloadedAt.getTime() <= windowMs;
}
