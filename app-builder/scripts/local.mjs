/**
 * Local dev harness — run the dispatcher on http://localhost:3000 WITHOUT
 * deploying. Wraps each incoming HTTP request into the `__ow_*` params the
 * action expects, calls `main()`, and writes the returned {statusCode,headers,
 * body} back out (decoding base64 for binary responses, like the platform does).
 *
 * This is the fastest inner loop: edit an action file, restart, curl localhost.
 * It exercises the SAME code path as the deployed action. Outbound calls
 * (Helix, Cloudflare D1, aio-lib-state) go to the REAL services — there is no
 * local storage emulation on App Builder (FINDINGS.md limit #8).
 *
 * Usage:  set -a && . ./.env && set +a && node scripts/local.mjs
 */
import http from 'node:http';
import { main } from '../actions/dispatcher/index.js';

const PORT = process.env.PORT || 3000;
// Keep in sync with ow-http.js TEXTUAL_CONTENT_TYPE: svg is treated as binary
// (base64) so the local harness decodes it the same way the platform does.
const TEXT_CT = /^(text\/|application\/(json|javascript|xml))/i;

// aio-lib-state has NO local emulation (FINDINGS.md limit #8): locally it needs
// the OpenWhisk namespace/auth the platform injects automatically when deployed.
// Feed them from the same creds we deploy with so /api/kv-demo works locally too.
if (process.env.AIO_runtime_namespace && !process.env.__OW_NAMESPACE) {
  process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace;
  process.env.__OW_API_KEY = process.env.AIO_runtime_auth;
}

const inputs = {
  HELIX_ORIGIN: process.env.HELIX_ORIGIN,
  HELIX_ORIGIN_AUTHENTICATION: process.env.HELIX_ORIGIN_AUTHENTICATION,
  COOKIE_SECRET: process.env.COOKIE_SECRET,
  // Path A: locally we serve at the ROOT (no prefix) by default, so the
  // dispatcher does no rewriting. Set LOCAL_BASE_PATH to faithfully emulate the
  // deployed action prefix (e.g. /api/v1/web/spark/dispatcher) and exercise the
  // HTML/redirect rewriting exactly as on Stage.
  BASE_PATH: process.env.LOCAL_BASE_PATH || '',
  DM_CLIENT_ID: process.env.DM_CLIENT_ID,
  DM_CLIENT_SECRET: process.env.DM_CLIENT_SECRET,
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
  CF_D1_DATABASE_ID: process.env.CF_D1_DATABASE_ID,
  CF_D1_API_TOKEN: process.env.CF_D1_API_TOKEN,
};
const LOCAL_BASE = process.env.LOCAL_BASE_PATH || '';

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const [path, query = ''] = req.url.split('?');
    // Emulate the platform stripping the action prefix from __ow_path so route
    // matching sees the same sub-path locally as on Stage.
    let owPath = path;
    if (LOCAL_BASE && owPath.startsWith(LOCAL_BASE)) {
      owPath = owPath.slice(LOCAL_BASE.length) || '/';
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
    // Local harness serves plain HTTP; tell the dispatcher so redirects/origin
    // resolve to http://localhost (on Runtime the platform sets this to https).
    headers['x-forwarded-proto'] = 'http';

    const params = {
      __ow_method: req.method.toLowerCase(),
      __ow_path: owPath,
      __ow_query: query,
      __ow_headers: headers,
      // Mirror the platform's `web: raw` contract: request body is base64-encoded.
      __ow_body: chunks.length ? Buffer.concat(chunks).toString('base64') : undefined,
      ...inputs,
    };

    const out = await main(params);
    const h = out.headers || {};
    const ct = h['content-type'] || 'text/plain';
    res.writeHead(out.statusCode || 200, h);
    if (out.body && !TEXT_CT.test(ct)) {
      res.end(Buffer.from(out.body, 'base64')); // binary was base64-encoded
    } else {
      res.end(out.body || '');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Local dispatcher on http://localhost:${PORT}`);
  console.log(`  try:  curl -i http://localhost:${PORT}/auth/dev-login`);
});
