/**
 * Analytics fan-out (Phase 1b). Adapted from cloudflare/src/util/analytics-helper.js.
 *
 * 'search' events write to the SEARCH_EVENTS D1 table via writeSearchEvent. 'login'/'download'
 * used Cloudflare Analytics Engine, which is dead/absent on Fastly, so they no-op (audit_events
 * covers asset activity; user_logins is dropped — see docs/fastly-migration-log.md).
 *
 * @param {Object} env
 * @param {string} eventType - 'login' | 'search' | 'download'
 * @param {Object} eventData
 */
export async function trackAnalyticsEvent(env, eventType, eventData) {
  try {
    if (eventType === 'search') {
      if (!env.SEARCH_EVENTS) {
        console.warn('[Analytics] SEARCH_EVENTS D1 not available');
        return;
      }
      const { writeSearchEvent } = await import('../api/analytics.js');
      await writeSearchEvent(env.SEARCH_EVENTS, eventData);
      return;
    }
    // login/download analytics used Cloudflare Analytics Engine (not on Fastly) → no-op.
    console.log(`[analytics:noop] ${eventType} (Analytics Engine not on Fastly)`);
  } catch (err) {
    console.error(`[Analytics] Failed to track ${eventType} event:`, err);
  }
}
