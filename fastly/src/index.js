/// <reference types="@fastly/js-compute" />
//
// Fastly Compute entry for assethub-spark — Phase 1a (auth-gated portal).
// Ported from cloudflare/src/index.js. Scope so far: cookie parsing, OIDC auth router,
// root redirect, public static assets, the auth gate, /api/user, and the Helix proxy.
// DM/COA proxies, notifications, reports, and page-access control are layered on next.
//
// Adaptations: env comes from the ./platform adapter (not a runtime-supplied arg);
// Cloudflare's withTlsCheck (request.cf.tlsVersion) is dropped (CF-specific — TLS
// enforcement will use Fastly's TLS API later).
import { Router, withCookies } from 'itty-router';
import { buildEnv } from './platform/env.js';
import { authRouter, withAuthentication } from './auth.js';
import { originHelix } from './origin/helix.js';
import { originDynamicMedia } from './origin/dm.js';
import { originCoa, originCoaImage } from './origin/coa.js';
import { notificationsApi } from './api/notifications.js';
import { smartCollectionsApi } from './api/smart-collections.js';
import { isUserExcluded, parsePageExclusions } from './origin/page-access.js';
import { apiUser } from './user.js';
import { cors } from './util/itty.js';
import { companyBasePath } from './config.js';

const allowedOrigins = [
  'https://frescopamedia.com',
  'https://preview.frescopamedia.com',
  /https:\/\/.*\.dev\.frescopamedia\.com$/,
  /https:\/\/.*\.edgecompute\.app$/, // Fastly preview domains
  /http:\/\/localhost:.*/,
  /http:\/\/127\.0\.0\.1:.*/,
];

/** Switch to AEM preview content for preview hostnames. */
function withPreviewOrigin(request, env) {
  const { hostname } = new URL(request.url);
  if (hostname === 'preview.frescopamedia.com') {
    request.helixOrigin = (env.HELIX_ORIGIN || '').replace('.aem.live', '.aem.page');
  }
}

const { preflight, corsify } = cors({
  origin: allowedOrigins,
  allowMethods: ['GET', 'POST', 'DELETE', 'PUT'],
  credentials: true,
  maxAge: 600,
});

const BASE = companyBasePath();

function redirectTo(url, status = 302) {
  const r = new Response(null, { status });
  r.headers.set('Location', url);
  return r;
}
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function redirectTo404(request) {
  const url = new URL(request.url);
  return redirectTo(`${url.origin}/404.html`, 302);
}

const router = Router({
  before: [preflight, withPreviewOrigin],
  finally: [corsify],
  catch: (err) => {
    console.error('error', err);
    throw err;
  },
});

router
  // parse cookies
  .all('*', (request) => {
    withCookies(request);
    for (const key in request.cookies) {
      request.cookies[key] = decodeURIComponent(request.cookies[key]);
    }
  })

  // login/logout flows (must come first)
  .all('*', authRouter.fetch)

  // bare root -> default locale home
  .get('/', (request) => redirectTo(`${new URL(request.url).origin}${BASE}/en/`, 302))

  // public static assets (no auth)
  .get(`${BASE}/public/*`, originHelix)
  .get('/tools/*', originHelix)
  .get('/scripts/*', originHelix)
  .get('/styles/*', originHelix)
  .get('/blocks/*', originHelix)
  .get('/fonts/*', originHelix)
  .get('/icons/*', originHelix)
  .get('/favicon.ico', originHelix)
  .get('/robots.txt', originHelix)

  // from here on, authentication required
  .all('*', withAuthentication)

  // restrict config/access paths to admins
  .all(`${BASE}/config/access/*`, (request) => {
    if (!request.user?.roles?.includes('admin')) return new Response('Forbidden', { status: 403 });
  })

  // user info
  .get('/api/user', apiUser)

  // dynamic media (asset proxy, search, metadata)
  .all('/api/adobe/assets/*', originDynamicMedia)

  // Content Optimization Agent (AI image renditions)
  .post('/api/adobe/coa/generate', originCoa)
  .get('/api/adobe/coa/image', originCoaImage)

  // Notifications API (KV-backed) — Phase 1a degrades to EDS system notifications when KV is absent
  .all('/api/messages', notificationsApi)
  .all('/api/messages/*', notificationsApi)

  // Smart collections (D1-backed via the D1-over-HTTP shim; degrades to [] if D1 unconfigured)
  .all('/api/smart-collections', smartCollectionsApi)
  .all('/api/smart-collections/*', smartCollectionsApi)

  // Unknown /api/* -> clean JSON 404 (never proxy to Helix, whose HTML breaks frontend JSON.parse).
  // Matches the CF worker's `.all('/api/*', () => error(404))`; covers not-yet-ported endpoints
  // like /api/messages (notifications) until they're ported.
  .all('/api/*', () => jsonResponse({ error: 'Not Found' }, 404))

  // everything else -> Helix proxy with page-level access control (exclude-roles).
  .all('*', async (request, env) => {
    // We may need to read the HTML body to enforce exclude-roles, so ask helix.js for an
    // uncompressed body (Fastly doesn't auto-decompress subrequest bodies — a compressed
    // body would make .text() garbage and the exclusion check fail-open).
    request.stripAcceptEncoding = true;
    const response = await originHelix(request, env);

    if (response.status === 404) return redirectTo404(request);

    const contentType = response.headers.get('content-type') || '';
    // Only HTML pages for authenticated non-admins are access-controlled; everything
    // else (assets, JSON, unauthenticated, admins) streams straight through.
    if (!contentType.includes('text/html') || !request.user) return response;
    if (request.user.roles?.includes('admin')) return response;

    // Read once and reconstruct — Fastly backend responses have no `.clone()`
    // (the CF original used `response.clone().text()`).
    const html = await response.text();
    const exclusions = parsePageExclusions(html);
    if (isUserExcluded(request.user, exclusions)) {
      console.warn(
        `[PageAccess] Denied ${request.user.email} from ${new URL(request.url).pathname} (user roles: ${request.user.roles}, excluded: ${JSON.stringify(exclusions)})`,
      );
      return redirectTo404(request);
    }

    const headers = new Headers(response.headers);
    headers.delete('content-length'); // body re-encoded from text; let the runtime recompute
    return new Response(html, { status: response.status, headers });
  });

addEventListener('fetch', (event) => {
  const env = buildEnv();
  event.respondWith(router.fetch(event.request, env));
});
