/**
 * Analytics fan-out — Phase 1a LOG-ONLY degrade (T1a.6).
 *
 * The Cloudflare original routes 'search' events to D1 and 'login'/'download' to
 * Analytics Engine. There's no DB in Phase 1a, so we just log what WOULD be written,
 * so it's visible in `fastly log-tail`. Phase 1b replaces this with real libSQL writes.
 *
 * @param {Object} _env
 * @param {string} eventType - 'login' | 'search' | 'download'
 * @param {Object} eventData
 */
export async function trackAnalyticsEvent(_env, eventType, eventData) {
  try {
    console.log(`[analytics:degraded] ${eventType}`, JSON.stringify(eventData));
  } catch {
    console.log(`[analytics:degraded] ${eventType} (unserializable payload)`);
  }
}
