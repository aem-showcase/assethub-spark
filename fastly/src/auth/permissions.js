/**
 * Shared permission vocabulary and predicate.
 * Copied verbatim from scripts/auth/permissions.js (isomorphic — used by frontend + worker).
 */

export const PERMISSIONS = {
  ADMIN_REPORTS: 'admin-reports',
  VIEW_AUDIT: 'view-audit',
  SUDO: 'sudo',
};

/**
 * @param {{ permissions?: string[] }} [user]
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(user, permission) {
  return !!user?.permissions?.includes(permission);
}
