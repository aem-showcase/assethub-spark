/**
 * Backend authorization gate. Ported from cloudflare/src/util/authz.js — only the
 * permissions import path changes (fastly/src/auth/permissions.js instead of the repo-root
 * scripts/ copy). Returns a 403 Response when denied, null when allowed.
 * Usage: const denied = assertPermission(request, PERMISSIONS.VIEW_AUDIT);
 *        if (denied) return denied;
 */
import { error } from 'itty-router';
import { hasPermission } from '../auth/permissions.js';

export function assertPermission(request, permission) {
  const ok = hasPermission(request.user, permission);
  if (!ok) {
    console.warn(
      JSON.stringify({
        evt: 'authz',
        decision: 'deny',
        permission,
        email: request.user?.email ?? null,
        path: new URL(request.url).pathname,
      }),
    );
  }
  return ok ? null : error(403, 'Forbidden');
}
