/**
 * Dispatcher web action — the single entry point that emulates the Cloudflare
 * Worker's itty-router (cloudflare/src/index.js): CORS, TLS-skip, cookie parse,
 * auth, route table, origin proxy. One `web: raw` action stands in for the
 * Worker's single fetch handler.
 *
 * Route -> port status (see FINDINGS.md):
 *   /auth/login|callback|logout   Entra SSO            ported (crypto core)
 *   /auth/dev-login               PoC-only test login  poc-only
 *   /api/user                     session -> user JSON ported
 *   /api/smart-collections*       D1 CRUD (real code)  ported via D1-over-HTTP
 *   /api/kv-demo                  aio-lib-state proof   ported
 *   /api/audit|analytics|messages stubs                501 (documented limit)
 *   *                             Helix origin proxy    bounded by 1 MB limit #1
 */
import { toRequest, toOwResponse, owError } from '../lib/ow-http.js';
import { parseCookies, serializeCookie, deleteCookieValue } from '../lib/cookies.js';
import {
  ASSET_PROXY_PATH,
  withBase,
  rewriteRootAbsolute,
  rewriteHtml,
  rewriteLocalizeJs,
  rewriteCss,
} from '../lib/basepath.js';
import { config } from '../lib/config.js';
import {
  createSessionJWT,
  verifySessionJWT,
  verifyIdToken,
  sessionFromIdToken,
} from '../lib/session.js';
import { d1Binding } from '../storage/sql.js';
import { kvBinding } from '../storage/kv.js';
import { originHelix } from '../origin/helix.js';
import { stub } from '../api/stubs.js';
// REAL Worker handlers, reused unchanged — only the binding access path differs.
import { smartCollectionsApi } from '../../../cloudflare/src/api/smart-collections.js';
import { originDynamicMedia } from '../../../cloudflare/src/origin/dm.js';

const COOKIE_SESSION = 'Session';
const AUTH_PREFIX = '/auth';

/* ------------------------------ small helpers ------------------------------ */

function originOf(request) {
  const u = new URL(request.url);
  return u.origin;
}

/** OW response with optional Set-Cookie array + JSON body. */
function ow(statusCode, body, { headers = {}, cookies = [] } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (cookies.length) h['Set-Cookie'] = cookies;
  return { statusCode, headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) };
}

function redirect(location, { cookies = [] } = {}) {
  const headers = { location };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  return { statusCode: 302, headers, body: '' };
}

/** Reflective CORS (credentialed). PoC-simplified vs the Worker's allow-list. */
function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

/* --------------------------------- auth ------------------------------------ */

async function currentUser(request, env) {
  const cookies = parseCookies(request);
  const jwt = cookies[COOKIE_SESSION];
  if (!jwt) return null;
  return verifySessionJWT(originOf(request), env.COOKIE_SECRET, jwt);
}

function startLogin(request, originalUrl, base = '') {
  const origin = originOf(request);
  const redirectUri = `${origin}${withBase(base, `${AUTH_PREFIX}/callback`)}`;
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const authorizeUrl =
    `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/v2.0/authorize?` +
    new URLSearchParams({
      client_id: config.MICROSOFT_ENTRA_CLIENT_ID,
      response_type: 'id_token',
      redirect_uri: redirectUri,
      response_mode: 'form_post',
      scope: 'openid profile',
      state,
      nonce,
    });
  // PoC: carry nonce in a short-lived cookie (Worker signs it; equivalent here).
  const cookies = [serializeCookie('AuthNonce', nonce, { SameSite: 'None', MaxAge: 600 })];
  // Mirror the Worker's ORIGINAL_URL_PARAM: remember where to return post-login.
  if (originalUrl && originalUrl !== '/') {
    cookies.push(serializeCookie('AuthReturn', originalUrl, { SameSite: 'None', MaxAge: 600 }));
  }
  return redirect(authorizeUrl, { cookies });
}

/**
 * Mirror the Worker's `redirectToLoginPage` (auth.js): an unauthenticated
 * request is 302-redirected into the Entra SSO flow (NOT answered with a bare
 * 401). This is the "authentication" the portal shows — the browser is bounced
 * to login.microsoftonline.com. The original URL is preserved for return.
 * NOTE: completing the round-trip needs this action's `${origin}/auth/callback`
 * registered as a redirect_uri in the Entra app (see FINDINGS.md).
 */
function redirectToLogin(request, base = '') {
  const u = new URL(request.url);
  return startLogin(request, u.pathname + u.search, base);
}

async function handleCallback(request, env) {
  const base = env.BASE_PATH || '';
  const form = new URLSearchParams(await request.text());
  const idToken = form.get('id_token');
  if (!idToken) {
    // Entra POSTs error/error_description here when the flow fails (e.g. ID tokens
    // not enabled → AADSTS700054). Surface it instead of a generic "No id_token".
    const err = form.get('error');
    const desc = form.get('error_description');
    if (err) return owError(401, `Entra error: ${err} — ${desc || '(no description)'}`);
    return owError(401, 'No id_token (and no error field) in callback POST body');
  }
  const nonce = parseCookies(request).AuthNonce;
  let claims;
  try {
    claims = await verifyIdToken(idToken, nonce);
  } catch (e) {
    return owError(401, `Invalid id_token: ${e.message}`);
  }
  const session = sessionFromIdToken(claims);
  const jwt = await createSessionJWT(originOf(request), env.COOKIE_SECRET, session);
  const cookie = serializeCookie(COOKIE_SESSION, jwt, { SameSite: 'Lax' });
  // Return to the originally-requested URL (Worker parity), default /api/user.
  const returnTo = parseCookies(request).AuthReturn;
  const dest = returnTo && returnTo.startsWith('/') ? returnTo : '/api/user';
  return redirect(`${originOf(request)}${withBase(base, dest)}`, {
    cookies: [cookie, deleteCookieValue('AuthReturn'), deleteCookieValue('AuthNonce')],
  });
}

/**
 * PoC-only test login — mints a Session cookie for a fixed test identity so the
 * authenticated API paths (/api/user, /api/smart-collections) can be exercised
 * end-to-end without registering an adobeioruntime.net redirect URI in the Entra
 * app. MUST be removed before any shared/production use (documented in FINDINGS).
 */
async function handleDevLogin(request, env) {
  // PoC identity. Defaults to a placeholder, but accepts ?email=&name= so you
  // can sign in as your own identity (e.g. tphan@adobe.com) without real SSO.
  const q = new URL(request.url).searchParams;
  const email = q.get('email') || 'poc-dev@example.com';
  const name = q.get('name') || email.split('@')[0];
  const domain = email.includes('@') ? email.split('@')[1] : 'example.com';
  const session = {
    sub: `dev-${email}`,
    name,
    email,
    domain,
    // Enough identity for the ported asset-search authorization (dm.js
    // buildAssetAuthClauses reads roles/userType/country/countries). 'admin'
    // bypasses per-user filters so search returns the demo-company assets.
    roles: ['admin'],
    userType: 'internal',
    country: 'us',
    countries: ['us'],
    permissions: ['preview', 'admin'],
  };
  const jwt = await createSessionJWT(originOf(request), env.COOKIE_SECRET, session);
  const cookie = serializeCookie(COOKIE_SESSION, jwt, { SameSite: 'Lax' });
  return ow(200, { ...session, note: 'PoC-only dev session issued' }, { cookies: [cookie] });
}

/** Wrap a plaintext secret as the Secrets-Store binding shape (`{ get() }`). */
function secretShim(value) {
  return { get: async () => value };
}

/** No-op execution-context shim (Runtime has no ctx.waitUntil). */
const ctxShim = { waitUntil: (p) => Promise.resolve(p).catch(() => {}) };

// Paths the Worker serves WITHOUT authentication (cloudflare/src/index.js — the
// routes registered before `.all('*', withAuthentication)`). Everything else —
// pages like /en/search and /api/* — is gated behind SSO.
const PUBLIC_ASSET_PATTERNS = [
  /^\/public\//, /^\/tools\//, /^\/scripts\//, /^\/styles\//,
  /^\/blocks\//, /^\/fonts\//, /^\/icons\//,
  /^\/favicon\.ico$/, /^\/robots\.txt$/,
];
const isPublicAsset = (pathname) => PUBLIC_ASSET_PATTERNS.some((re) => re.test(pathname));

/**
 * Finish a Helix-origin response for Path A: when a base prefix is in effect,
 * rewrite root-absolute Location redirects and root-absolute references inside
 * served HTML so the browser stays under the dispatcher prefix (and reserved-
 * extension assets are routed through /x-asset). No-op when base is empty.
 */
async function finishHelix(resp, base, pathname = '') {
  if (!base) return toOwResponse(resp);

  const loc = resp.headers.get('location');
  if (loc && loc.startsWith('/') && !loc.startsWith('//')) {
    const h = new Headers(resp.headers);
    h.set('location', rewriteRootAbsolute(base, loc));
    resp = new Response(resp.body, { status: resp.status, headers: h });
  }

  const ct = resp.headers.get('content-type') || '';
  if (/text\/html/i.test(ct)) {
    const html = await resp.text();
    const h = new Headers(resp.headers);
    return toOwResponse(new Response(rewriteHtml(html, base), { status: resp.status, headers: h }));
  }

  // Path A: make the frontend's localizePath() base-aware so programmatic
  // navigations (window.location.href = localizePath(...)) stay under the
  // prefix. Gated to the one module that defines it; no-op otherwise.
  if (/javascript/i.test(ct) && /\/scripts\/locale-utils\.js$/.test(pathname)) {
    const js = await resp.text();
    const patched = rewriteLocalizeJs(js, base);
    const h = new Headers(resp.headers);
    return toOwResponse(new Response(patched, { status: resp.status, headers: h }));
  }

  // Path A: rewrite root-absolute url(/…) in CSS (background/mask icons) — the
  // browser fetches these relative to the origin root, bypassing the JS shim.
  if (/text\/css/i.test(ct)) {
    const css = await resp.text();
    const h = new Headers(resp.headers);
    return toOwResponse(new Response(rewriteCss(css, base), { status: resp.status, headers: h }));
  }
  return toOwResponse(resp);
}

/* ------------------------------ route table -------------------------------- */

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const base = env.BASE_PATH || '';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(request), body: '' };
  }

  // ---- reserved-extension asset proxy (Path A, public) ----
  // The OpenWhisk gateway 400s any URL ending in .svg/.json/.html/.text/.http
  // (FINDINGS.md limit #13). The Path A rewrite routes those fetches here, with
  // the real sub-path in ?p=, so the URL the platform sees has no reserved
  // extension and the bytes pass through (still bounded by the 1 MB cap #1).
  if (pathname === ASSET_PROXY_PATH) {
    const p = url.searchParams.get('p');
    if (!p || !p.startsWith('/')) return owError(400, 'x-asset: missing/invalid ?p');
    const [pp, ps = ''] = p.split('?');
    const sub = new URL(request.url);
    sub.pathname = pp;
    sub.search = ps ? `?${ps}` : '';
    const proxied = new Request(sub.toString(), { method: 'GET', headers: request.headers });
    return finishHelix(await originHelix(proxied, env), base, pp);
  }

  // ---- auth (public) ----
  if (pathname === `${AUTH_PREFIX}/login`) return startLogin(request, url.searchParams.get('originalUrl'), base);
  if (pathname === `${AUTH_PREFIX}/callback` && method === 'POST') return handleCallback(request, env);
  if (pathname === `${AUTH_PREFIX}/dev-login`) return handleDevLogin(request, env);
  if (pathname === `${AUTH_PREFIX}/logout`) {
    return redirect(`${url.origin}${withBase(base, '/')}`, { cookies: [deleteCookieValue(COOKIE_SESSION)] });
  }

  // ---- limit probe (public, PoC diagnostic) ----
  // Returns a raw body of ?bytes=N WITHOUT the 1 MB guard, so a client can
  // observe the PLATFORM's own response cap. Empirically pins hard limit #1.
  if (pathname === '/api/limit-probe') {
    const bytes = Math.min(parseInt(url.searchParams.get('bytes') || '1024', 10) || 0, 8 * 1024 * 1024);
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain', 'x-probe-bytes': String(bytes) },
      body: 'A'.repeat(bytes),
    };
  }

  // ---- stubs (documented hard limits) ----
  if (pathname.startsWith('/api/audit')) return stub('audit');
  if (pathname.startsWith('/api/analytics')) return stub('analytics');
  if (pathname.startsWith('/api/messages')) return stub('search'); // notifications ~ search-metrics family

  // ---- authenticated API ----
  if (pathname.startsWith('/api/')) {
    const user = await currentUser(request, env);
    // Worker parity: no/invalid session -> 302 into the Entra SSO flow (not a
    // bare 401). This is what makes the browser show the Microsoft login.
    if (!user) return redirectToLogin(request, base);
    request.user = user;

    if (pathname === '/api/user') {
      const u = { ...user };
      delete u.sid; delete u.iss; delete u.aud; delete u.exp; delete u.nbf; delete u.sub;
      return ow(200, u);
    }

    if (pathname === '/api/kv-demo') {
      const kv = kvBinding();
      const n = ((await kv.get('poc_hits', 'json')) || 0) + 1;
      await kv.put('poc_hits', String(n), { expirationTtl: 3600 });
      return ow(200, { store: 'aio-lib-state', key: 'poc_hits', hits: n });
    }

    if (pathname === '/api/smart-collections' || pathname.startsWith('/api/smart-collections/')) {
      const env2 = {
        SMART_COLLECTIONS: d1Binding({
          accountId: env.CF_ACCOUNT_ID,
          databaseId: env.CF_D1_DATABASE_ID,
          token: env.CF_D1_API_TOKEN,
        }),
      };
      const resp = await smartCollectionsApi(request, env2);
      return toOwResponse(resp);
    }

    // Dynamic Media / ContentAI proxy — the REAL Worker handler unchanged.
    // env shim: DM secrets as Secrets-Store-shaped `{get}`, AUTH_TOKENS as the
    // aio-lib-state KV, Analytics Engine as a no-op (limit #9). Small JSON
    // responses (search) fit; rendition/download binaries hit limit #1.
    if (pathname.startsWith('/api/adobe/assets/')) {
      const dmEnv = {
        AUTH_TOKENS: kvBinding(),
        DM_CLIENT_ID: secretShim(env.DM_CLIENT_ID),
        DM_CLIENT_SECRET: secretShim(env.DM_CLIENT_SECRET),
        SPARK_ANALYTICS_ENGINE: { writeDataPoint: () => {} },
      };
      const resp = await originDynamicMedia(request, dmEnv, ctxShim);
      return toOwResponse(resp);
    }

    return owError(404, 'Unknown API route');
  }

  // ---- catch-all: pages + assets via Helix origin (bounded by 1 MB limit #1) ----
  // Worker parity: bare root redirects to the default locale home.
  if (pathname === '/') return redirect(`${url.origin}${withBase(base, '/en/')}`);
  // Public static assets serve without auth; every other page is SSO-gated —
  // an unauthenticated page hit (e.g. /en/search) 302s into the Entra login,
  // exactly like the Worker's `.all('*', withAuthentication)`.
  if (!isPublicAsset(pathname)) {
    const user = await currentUser(request, env);
    if (!user) return redirectToLogin(request, base);
    request.user = user;
  }
  return finishHelix(await originHelix(request, env), base, pathname);
}

/* -------------------------------- entry ------------------------------------ */

export async function main(params) {
  const request = toRequest(params);
  const env = {
    HELIX_ORIGIN: params.HELIX_ORIGIN,
    HELIX_ORIGIN_AUTHENTICATION: params.HELIX_ORIGIN_AUTHENTICATION,
    COOKIE_SECRET: params.COOKIE_SECRET,
    BASE_PATH: params.BASE_PATH || '',
    DM_CLIENT_ID: params.DM_CLIENT_ID,
    DM_CLIENT_SECRET: params.DM_CLIENT_SECRET,
    CF_ACCOUNT_ID: params.CF_ACCOUNT_ID,
    CF_D1_DATABASE_ID: params.CF_D1_DATABASE_ID,
    CF_D1_API_TOKEN: params.CF_D1_API_TOKEN,
  };

  try {
    const res = await route(request, env);
    // Merge CORS onto every response.
    res.headers = { ...corsHeaders(request), ...(res.headers || {}) };
    return res;
  } catch (err) {
    console.error('[dispatcher] error', err);
    return owError(500, `Dispatcher error: ${err.message}`);
  }
}
