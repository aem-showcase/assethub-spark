/**
 * Shared Dynamic Media request contract.
 *
 * Both the Cloudflare worker and agent-side scripts use this path-based selector so
 * collection automation cannot drift from the portal proxy's upstream header behavior.
 */

export const DM_COLLECTIONS_PATH_PREFIX = '/adobe/assets/collections';

function toPathname(pathOrUrl) {
  const value = String(pathOrUrl || '');
  try {
    return new URL(value).pathname;
  } catch {
    return value.split('?')[0].split('#')[0];
  }
}

export function isDynamicMediaCollectionsPath(pathOrUrl) {
  const pathname = toPathname(pathOrUrl);
  return pathname === DM_COLLECTIONS_PATH_PREFIX
    || pathname.startsWith(`${DM_COLLECTIONS_PATH_PREFIX}/`);
}

export function getDynamicMediaApiKeyForPath(pathOrUrl, dmClientId) {
  if (!dmClientId) {
    throw new Error('getDynamicMediaApiKeyForPath: dmClientId is required');
  }
  return dmClientId;
}
