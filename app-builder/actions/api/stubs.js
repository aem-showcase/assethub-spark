/**
 * Stubbed endpoints — the routes that cannot run as-is on App Builder and are
 * intentionally NOT ported for the feasibility PoC. Each returns HTTP 501 with a
 * machine-readable reason so the limit is visible at runtime, not just in docs.
 *
 * See FINDINGS.md for the full rationale per endpoint.
 */

const STUBS = {
  // D1-backed, analytics-heavy. Smart Collections is ported as the one
  // representative D1 feature; these are documented as the same "no native
  // relational-SQL binding" limit rather than re-implemented.
  audit: 'D1 relational SQL + heavy aggregation; not ported for PoC (limit #5).',
  search: 'D1 search_events aggregation; not ported for PoC (limit #5).',
  'user-logins': 'D1 user_logins; not ported for PoC (limit #5).',
  // Cloudflare Analytics Engine has no App Builder equivalent.
  analytics: 'Cloudflare Analytics Engine — no App Builder equivalent (limit #7).',
};

export function stub(kind) {
  return {
    statusCode: 501,
    headers: {
      'content-type': 'application/json',
      'x-appbuilder-limit': `stub-${kind}`,
    },
    body: JSON.stringify({
      error: 'NotImplementedOnAppBuilder',
      endpoint: kind,
      reason: STUBS[kind] || 'Not implemented for PoC.',
    }),
  };
}
