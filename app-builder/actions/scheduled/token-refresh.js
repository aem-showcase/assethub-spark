/**
 * Monthly token-refresh action — the App Builder equivalent of the Worker's
 * `scheduled()` cron (`0 0 1 * *`). On Runtime a non-web action is fired by the
 * alarms feed (`/whisk.system/alarms/interval` or `.../once`); wiring the trigger
 * is a post-deploy step documented in FINDINGS.md ("cron").
 *
 * Body mirrors cloudflare/src/scheduled/token-refresh.js — a no-op today
 * (email OAuth removed), kept as the port target for the schedule.
 */
export async function main() {
  console.log('[cron] Monthly token refresh tick — no-op (email OAuth not configured)');
  return { statusCode: 200, body: { ok: true, ranAt: new Date().toISOString() } };
}
