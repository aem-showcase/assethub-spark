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
// Phase 1a degrade: smart collections are D1-backed (Phase 1b). Return an empty list so the
// search UI's left panel (and thus the facets) renders instead of crashing on proxied HTML.
function smartCollectionsDegraded(request) {
  if (request.method === 'GET') return jsonResponse([], 200);
  return jsonResponse({ error: 'Smart collections require the database (Phase 1b)' }, 501);
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

  // Smart collections (D1-backed) — Phase 1a degrade to an empty list (unblocks the facets panel)
  .all('/api/smart-collections', smartCollectionsDegraded)
  .all('/api/smart-collections/*', smartCollectionsDegraded)

  // Unknown /api/* -> clean JSON 404 (never proxy to Helix, whose HTML breaks frontend JSON.parse).
  // Matches the CF worker's `.all('/api/*', () => error(404))`; covers not-yet-ported endpoints
  // like /api/messages (notifications) until they're ported.
  .all('/api/*', () => jsonResponse({ error: 'Not Found' }, 404))

  // everything else -> Helix proxy (page-access control added in a later step)
  .all('*', async (request, env) => {
    const response = await originHelix(request, env);
    if (response.status === 404) return redirectTo404(request);
    return response;
  });

addEventListener('fetch', (event) => {
  const env = buildEnv();
  event.respondWith(router.fetch(event.request, env));
});
