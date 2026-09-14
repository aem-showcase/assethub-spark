/**
 * Empirically confirm FINDINGS.md hard limit #1 (1 MB web-action response cap,
 * no streaming) against the DEPLOYED dispatcher.
 *
 * Strategy: hit the deployed Helix origin proxy for a set of URLs of increasing
 * size and record where it flips from 200 (served) to 502 x-appbuilder-limit:
 * response-1mb. Turns "confirmed by docs" into "confirmed by deployed code".
 *
 * Usage:  node scripts/limit-test.mjs https://<ns>.adobeioruntime.net/api/v1/web/spark/dispatcher
 */
const base = process.argv[2];
if (!base) {
  console.error('Usage: node scripts/limit-test.mjs <dispatcher-base-url>');
  process.exit(1);
}

// Paths on the Helix origin, roughly small -> large.
const paths = [
  '/favicon.ico',
  '/robots.txt',
  '/',
  '/en/',
  '/scripts/scripts.js',
  '/styles/styles.css',
];

const results = [];
for (const p of paths) {
  const url = `${base}${p}`;
  try {
    const res = await fetch(url, { redirect: 'manual' });
    const limit = res.headers.get('x-appbuilder-limit') || '';
    const len = res.headers.get('content-length') || '?';
    results.push({
      path: p,
      status: res.status,
      bytes: len,
      limitHit: limit === 'response-1mb' ? 'YES (502, >1MB)' : '',
    });
  } catch (e) {
    results.push({ path: p, status: 'ERR', bytes: '-', limitHit: e.message });
  }
}
console.table(results);
