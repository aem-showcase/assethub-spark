import { Router } from 'itty-router';
import { jwtVerify, SignJWT, createLocalJWKSet } from 'jose';
import config, { companyBasePath } from './config.js';
import { createSession, getUser } from './user.js';
import { createSignedCookie, deleteCookie, isValidUrl, setCookie, validateSignedCookie } from './util/http.js';
import { maskEmail } from './util/log-utils.js';
import { fetchBackend } from './platform/backends.js';

// Ported from cloudflare/src/auth.js. Adaptations (all commented):
//   - createRemoteJWKSet -> manual JWKS fetch over the entra_jwks backend + createLocalJWKSet
//     (Phase 0 finding: createRemoteJWKSet throws "AbortSignal is not defined" on js-compute);
//   - DISABLE_AUTHENTICATION bypass re-enabled for local dev (config store sets it true locally,
//     false on the edge — must NEVER ship enabled);
//   - login analytics + user-login upsert degrade to log-only (Phase 1a, T1a.6 — no DB yet).

export const LOGIN_PAGE = `${companyBasePath()}/public/welcome`;

const AUTH_PREFIX = '/auth';

const COOKIE_SESSION = 'Session';
const COOKIE_STATE = 'State';
const COOKIE_LOGIN_VISITED = 'LoginVisited';
const ORIGINAL_URL_PARAM = 'url';

const REQUIRED_ENV_VARS = ['COOKIE_SECRET'];

// --- JWKS fix (Phase 0): fetch Entra's JWKS over the declared backend and build a
// local key set, instead of jose's createRemoteJWKSet (which needs AbortSignal). ---
let jwksCache = { keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h; TODO(T1a.5/1b): move to KV so it's shared across instances

async function getEntraJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const resp = await fetchBackend(config.MICROSOFT_ENTRA_JWKS_URL);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const body = await resp.json();
  jwksCache = { keys: body.keys, fetchedAt: now };
  return body.keys;
}

async function createSessionJWT(request, env, session) {
  const payload = { ...session, sid: crypto.randomUUID() };
  const key = new TextEncoder().encode(await env.COOKIE_SECRET.get());
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(request.uri.origin)
    .setAudience(config.MICROSOFT_ENTRA_CLIENT_ID)
    .setExpirationTime(config.SESSION_COOKIE_EXPIRATION)
    .setNotBefore('0m')
    .sign(key);
}

async function validateSessionJWT(request, env, sessionJWT) {
  try {
    const key = new TextEncoder().encode(await env.COOKIE_SECRET.get());
    const { payload } = await jwtVerify(sessionJWT, key, {
      issuer: request.uri.origin,
      audience: config.MICROSOFT_ENTRA_CLIENT_ID,
      clockTolerance: 5,
    });
    return payload;
  } catch (error) {
    request.error = `Invalid ${COOKIE_SESSION} cookie: ${error.message}`;
    return null;
  }
}

async function validateMicrosoftSignInCallback(request, state) {
  const formData = await request.formData();
  if (formData.has('error')) {
    request.error = `Microsoft OIDC error: ${formData.get('error')} - ${formData.get('error_description')}`;
    return null;
  }
  if (!formData.has('id_token')) {
    request.error = 'Microsoft OIDC error: No id_token in form data';
    return null;
  }
  if (formData.get('state') !== state) {
    request.error = 'OIDC error: Invalid state parameter';
    return null;
  }
  return formData;
}

async function validateIdToken(request, rawIdToken, nonce) {
  try {
    const keys = await getEntraJwks();
    const JWKS = createLocalJWKSet({ keys });
    const { payload } = await jwtVerify(rawIdToken, JWKS, {
      audience: config.MICROSOFT_ENTRA_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/v2.0`,
    });

    if (payload.nonce !== nonce) {
      request.error = `OIDC error: Invalid nonce in id_token: ${payload.nonce}`;
      return null;
    }
    if (payload.tid !== config.MICROSOFT_ENTRA_TENANT_ID) {
      request.error = `OIDC error: Invalid tenant (tid) in id_token: ${payload.tid}`;
      return null;
    }
    return payload;
  } catch (error) {
    request.error = `OIDC error: Invalid id_token: ${error.message}`;
    return null;
  }
}

function unauthorized(request) {
  if (request.error) {
    console.warn(request.error);
    return new Response(`Unauthorized - ${request.error}`, { status: 401 });
  }
  return new Response('Unauthorized', { status: 401 });
}

function redirect(url, status = 302) {
  const response = new Response(null, { status });
  response.headers.set('Location', url);
  return response;
}

function redirectToLoginPage(request, seenBefore = request.cookies[COOKIE_LOGIN_VISITED]) {
  const loginPage = new URL(request.uri.origin);
  loginPage.pathname = seenBefore ? `${AUTH_PREFIX}/login` : LOGIN_PAGE;

  const originalUrl = new URL(request.url);
  const url = originalUrl.pathname + originalUrl.search;
  if (url !== '/') loginPage.searchParams.append(ORIGINAL_URL_PARAM, url);

  const response = redirect(loginPage.href);
  deleteCookie(response, COOKIE_SESSION);
  return response;
}

function getOriginalRedirectUrl(request, originalUrl) {
  let redirectUrl = `${request.uri.origin}/`;
  if (originalUrl?.startsWith('/') && originalUrl !== LOGIN_PAGE && originalUrl !== `${AUTH_PREFIX}/login`) {
    redirectUrl = originalUrl;
  }
  return redirectUrl;
}

/** middleware to check if user is authenticated */
export async function withAuthentication(request, env) {
  request.uri = new URL(request.url);

  // Local-dev bypass (re-enabled from the CF original). Config store sets this 'true'
  // locally and 'false' on the edge. MUST never ship enabled (Risk register #9).
  if (env.DISABLE_AUTHENTICATION === 'true') {
    request.user = {
      email: 'dev@localhost',
      name: 'Local Dev',
      roles: ['admin', 'employee'],
      permissions: ['preview', 'admin-reports', 'manage-rights', 'admin-rights', 'sudo'],
      countries: ['us'],
      userId: 'local-dev',
    };
    console.warn('Authentication is disabled because DISABLE_AUTHENTICATION is set');
    return;
  }

  const sessionJWT = request.cookies[COOKIE_SESSION];
  if (!sessionJWT) {
    console.log('No session cookie found', request.url);
    return redirectToLoginPage(request);
  }

  const session = await validateSessionJWT(request, env, sessionJWT);
  if (!session) {
    console.warn(request.error);
    return redirectToLoginPage(request, true);
  }

  request.user = await getUser(request, env, session);
  if (!request.user) {
    request.error = request.error || 'User not allowed to access this application';
    return unauthorized(request);
  }
}

/** router for dedicated login & logout flows */
export const authRouter = Router({
  before: [
    (request, env) => {
      request.uri = new URL(request.url);
      const missing = REQUIRED_ENV_VARS.filter((v) => !env[v]);
      if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        return new Response('Service Unavailable', { status: 503 });
      }
    },
  ],
});

authRouter
  .get(LOGIN_PAGE, async (request, env) => {
    if (env.DISABLE_AUTHENTICATION !== 'true') {
      const sessionJWT = request.cookies[COOKIE_SESSION];
      if (!sessionJWT && request.cookies[COOKIE_LOGIN_VISITED]) {
        return redirectToLoginPage(request, true);
      }
      const session = await validateSessionJWT(request, env, sessionJWT);
      if (session) {
        return redirect(getOriginalRedirectUrl(request, request.uri.searchParams.get(ORIGINAL_URL_PARAM)));
      }
    }
  })

  .get(`${AUTH_PREFIX}/login`, async (request, env) => {
    const redirectUrl = new URL(request.uri.origin);
    redirectUrl.pathname = `${AUTH_PREFIX}/callback`;

    const url = new URL(request.url);
    let originalUrl = url.searchParams.get(ORIGINAL_URL_PARAM);
    if (!originalUrl) {
      const referer = isValidUrl(request.headers.get('Referer'));
      if (referer && referer.origin === request.uri.origin) {
        originalUrl = referer.searchParams.get(ORIGINAL_URL_PARAM);
      }
    }

    const state = {
      state: crypto.randomUUID() + (originalUrl ? `|${originalUrl}` : ''),
      nonce: crypto.randomUUID(),
    };

    const authorizeUrl =
      `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: config.MICROSOFT_ENTRA_CLIENT_ID,
        response_type: 'id_token',
        redirect_uri: redirectUrl.href,
        response_mode: 'form_post',
        scope: 'openid profile',
        state: state.state,
        nonce: state.nonce,
      });

    const response = redirect(authorizeUrl);
    const userAgent = request.headers.get('User-Agent');

    await createSignedCookie(response, await env.COOKIE_SECRET.get(), COOKIE_STATE, state, {
      SameSite: 'None',
      Secure: userAgent?.includes('Chrome') || userAgent?.includes('Firefox') || request.uri.hostname !== 'localhost',
      MaxAge: 60 * 10,
    });

    setCookie(response, COOKIE_LOGIN_VISITED, '1', {
      Expires: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toUTCString(),
    });

    return response;
  })

  .post(`${AUTH_PREFIX}/callback`, async (request, env) => {
    const state = await validateSignedCookie(request, await env.COOKIE_SECRET.get(), COOKIE_STATE);
    if (!state) return unauthorized(request);

    const formData = await validateMicrosoftSignInCallback(request, state.state);
    if (!formData) return unauthorized(request);

    request.idToken = await validateIdToken(request, formData.get('id_token'), state.nonce);
    if (!request.idToken) return unauthorized(request);

    const session = await createSession(request, env);
    if (!session) {
      request.error = request.error || 'User not allowed to access this application';
      return unauthorized(request);
    }

    const sessionJWT = await createSessionJWT(request, env, session);

    // Phase 1a: DB-backed login tracking degrades to log-only (T1a.6). Flipped to real
    // writes in 1b (trackAnalyticsEvent + upsertUserLogin over the libSQL shim).
    console.log('[login:degraded] would track login + upsert user_login', {
      userId: session.userId,
      email: maskEmail(session.email),
      company: session.company,
      roles: session.roles || [],
    });

    const redirectUrl = getOriginalRedirectUrl(request, state.state.split('|')[1]);
    const response = redirect(redirectUrl);

    setCookie(response, COOKIE_SESSION, sessionJWT, {
      SameSite: 'Lax',
      Secure: request.uri.hostname !== 'localhost',
    });
    deleteCookie(response, COOKIE_STATE);

    return response;
  })

  .get(`${AUTH_PREFIX}/logout`, withAuthentication, (request, _env) => {
    console.log('User logout:', request.user.email);
    const logoutUrl =
      `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/logout?` +
      new URLSearchParams({
        post_logout_redirect_uri: `${request.uri.origin}${companyBasePath()}/en/`,
      });
    const response = redirect(logoutUrl);
    deleteCookie(response, COOKIE_SESSION);
    return response;
  })

  .all(`${AUTH_PREFIX}/*`, () => new Response('Not Found', { status: 404 }));
