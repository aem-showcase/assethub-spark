import showToast from '../../../scripts/toast/toast.js';

/**
 * Persist a created archive to the download panel store and optionally open the panel.
 *
 * @param {object} options
 * @param {Array<{
 *   asset: {assetId?: string, name?: string, title?: string},
 *   renditions?: Array<{name?: string}>
 * }>} options.assetsRenditions
 * @param {string} options.archiveId
 * @param {(key: string, fallback: string) => string} options.t
 * @param {boolean} [options.openPanel=true]
 * @param {string} [options.successMessage]
 */
export function saveArchiveAndOpenDownloadPanel({
  assetsRenditions,
  archiveId,
  t,
  openPanel = true,
  successMessage,
}) {
  const existingDownloads = JSON.parse(localStorage.getItem('downloadArchives') || '[]');
  const newDownloadEntry = {
    assetsRenditions: assetsRenditions.map((item) => ({
      assetId: item.asset.assetId || '',
      assetName: item.asset.name || item.asset.title || 'Unknown Asset',
      renditions: (item.renditions || []).map((rendition) => rendition.name || 'original'),
    })),
    archiveId,
  };

  const deduped = existingDownloads.filter((entry) => entry.archiveId !== archiveId);
  deduped.push(newDownloadEntry);
  localStorage.setItem('downloadArchives', JSON.stringify(deduped));

  if (window.updateDownloadBadge) {
    window.updateDownloadBadge(deduped.length);
  }

  showToast(
    successMessage || t('downloadArchiveCreatedSuccessfully', 'Download archive created successfully'),
    'success',
  );

  if (openPanel && window.openDownloadPanel) {
    window.openDownloadPanel();
  }
}

export default saveArchiveAndOpenDownloadPanel;
