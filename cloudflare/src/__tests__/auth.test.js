import { withCookies } from 'itty-router';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../config.js';

const { fetchHelixSheet, trackAnalyticsEvent, upsertUserLogin } = vi.hoisted(() => ({
  fetchHelixSheet: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  upsertUserLogin: vi.fn(),
}));

vi.mock('../util/helixutil.js', () => ({ fetchHelixSheet }));
vi.mock('../util/analytics-helper.js', () => ({ trackAnalyticsEvent }));
vi.mock('../api/user-logins.js', () => ({ upsertUserLogin }));

const { authRouter, LOGIN_PAGE, withAuthentication } = await import('../auth.js');
const ORIGIN = 'https://frescopamedia.com';
const PREVIEW = 'https://preview.frescopamedia.com';
const SECRET = 'spark-auth-pilot-synthetic-secret-not-a-real-credential';
const SIGNING_KEY = new TextEncoder().encode(SECRET);
const EMAIL = 'analyst@adobe.com';
const TARGET_EMAIL = 'partner@agency.example';
const SESSION_FIELDS = {
  sub: 'spark-test-object',
  name: 'Spark Analyst',
  email: EMAIL,
  domain: 'adobe.com',
  country: 'US',
  employeeType: 'Employee',
  userId: 'spark-test-user-id',
  company: 'Adobe',
  title: 'Analyst',
  permissions: ['search', 'preview', 'sudo', 'report-searches'],
  roles: ['admin', 'employee'],
  userType: 'internal',
  countries: ['us', 'ca'],
};

let rsa;
let publicJwk;
let env;
let application;
let users;
let jwksFetch;

function request(path, { origin = ORIGIN, cookie, parseCookies = true, ...init } = {}) {
  const url = new URL(path, origin);
  const headers = new Headers(init.headers);
  headers.set('Host', url.host);
  if (cookie !== undefined) headers.set('Cookie', cookie);
  const result = new Request(url, { ...init, headers });
  if (parseCookies) {
    withCookies(result);
    for (const name of Object.keys(result.cookies)) {
      result.cookies[name] = decodeURIComponent(result.cookies[name]);
    }
  }
  return result;
}

function cookiePair(response, name) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(cookie, `${name} cookie`).toBeDefined();
  return cookie.split(';', 1)[0];
}

function cookieToken(pair) {
  return pair.slice(pair.indexOf('=') + 1);
}

function expectNoSession(response) {
  expect(response.headers.getSetCookie().some((value) => /^Session=[^;]/.test(value))).toBe(false);
}

async function startLogin({ origin = ORIGIN, target = '/en/search?query=coffee', parseCookies = true } = {}) {
  const response = await authRouter.fetch(
    request(`/auth/login?url=${encodeURIComponent(target)}`, {
      origin,
      parseCookies,
    }),
    env,
  );
  expect(response.status).toBe(302);
  const authorize = new URL(response.headers.get('Location'));
  return {
    response,
    origin,
    state: authorize.searchParams.get('state'),
    nonce: authorize.searchParams.get('nonce'),
    authorize,
    stateCookie: cookiePair(response, 'State'),
  };
}

async function signIdToken(flow, changes = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/v2.0`,
    aud: config.MICROSOFT_ENTRA_CLIENT_ID,
    tid: config.MICROSOFT_ENTRA_TENANT_ID,
    sub: 'microsoft-subject',
    oid: SESSION_FIELDS.sub,
    name: SESSION_FIELDS.name,
    email: 'Analyst@Adobe.COM',
    ctry: SESSION_FIELDS.country,
    EmployeeType: SESSION_FIELDS.employeeType,
    'User ID': SESSION_FIELDS.userId,
    Company: SESSION_FIELDS.company,
    Title: SESSION_FIELDS.title,
    nonce: flow.nonce,
    iat: now,
    exp: now + 600,
    ...changes,
  })
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
    .sign(rsa.privateKey);
}

async function callback(
  flow,
  { changes, token, state = flow.state, cookie = flow.stateCookie, parseCookies = true } = {},
) {
  const body = new URLSearchParams({ state, id_token: token ?? (await signIdToken(flow, changes)) });
  return authRouter.fetch(
    request('/auth/callback', {
      origin: flow.origin,
      method: 'POST',
      body,
      cookie,
      parseCookies,
    }),
    env,
  );
}

async function legacySession(fields = SESSION_FIELDS, origin = ORIGIN) {
  // Match Spark's original generateSessionToken: no typ or iat header/claim.
  const token = await new SignJWT({ ...fields, sid: 'legacy-session-id' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(origin)
    .setAudience(config.MICROSOFT_ENTRA_CLIENT_ID)
    .setNotBefore('0m')
    .setExpirationTime('6h')
    .sign(SIGNING_KEY);
  return `Session=${token}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  rsa = await generateKeyPair('RS256', { extractable: true });
  publicJwk = { ...(await exportJWK(rsa.publicKey)), kid: 'spark-auth-pilot-rsa', alg: 'RS256', use: 'sig' };
});

beforeEach(() => {
  vi.resetAllMocks();
  env = { COOKIE_SECRET: { get: vi.fn().mockResolvedValue(SECRET) } };
  application = {
    '*': { permissions: ['search'] },
    'adobe.com': { permissions: ['preview'] },
    [EMAIL]: { permissions: ['sudo', 'report-searches'] },
    'agency.example': { permissions: ['download', 'sudo'] },
  };
  users = {
    [EMAIL]: { roles: ['admin', 'employee'], countries: ['us', 'ca'] },
    [TARGET_EMAIL]: { roles: ['admin', 'partner'], countries: ['india'] },
  };
  fetchHelixSheet.mockImplementation(async (_request, _env, path) => {
    if (path === '/config/access/application') return application;
    if (path === '/config/access/users') return users;
    throw new Error(`Unexpected Helix sheet: ${path}`);
  });
  trackAnalyticsEvent.mockResolvedValue(undefined);
  upsertUserLogin.mockResolvedValue(undefined);
  jwksFetch = vi.fn(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== config.MICROSOFT_ENTRA_JWKS_URL) throw new Error(`Unexpected network request: ${url}`);
    return Response.json({ keys: [publicJwk] });
  });
  // Keep real JOSE verification and one key across tests because the SDK caches JWKS.
  vi.stubGlobal('fetch', jwksFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Spark SDK auth adapter', () => {
  it('runs signed login state, Microsoft callback, Spark user mapping, and guarded logout', async () => {
    const flow = await startLogin({ target: '/en/search?query=coffee%20beans' });
    const { payload: state } = await jwtVerify(cookieToken(flow.stateCookie), SIGNING_KEY);
    expect(state).toMatchObject({
      origin: ORIGIN,
      aud: config.MICROSOFT_ENTRA_CLIENT_ID,
      nonce: flow.nonce,
      state: flow.state,
      returnPath: '/en/search?query=coffee%20beans',
    });
    expect(state.exp - state.iat).toBe(600);
    expect(flow.authorize.pathname).toBe(`/${config.MICROSOFT_ENTRA_TENANT_ID}/oauth2/v2.0/authorize`);
    expect(flow.authorize.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(flow.response.headers.getSetCookie()[0]).toMatch(/HttpOnly; Secure; SameSite=None/);

    const response = await callback(flow);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/en/search?query=coffee%20beans`);
    const sessionCookie = cookiePair(response, 'Session');
    const { payload: session } = await jwtVerify(cookieToken(sessionCookie), SIGNING_KEY);
    expect(session).toMatchObject({ ...SESSION_FIELDS, iss: ORIGIN, aud: config.MICROSOFT_ENTRA_CLIENT_ID });
    expect(session.exp - session.iat).toBe(config.SESSION_COOKIE_TTL_SECONDS);
    expect(session.sid).toEqual(expect.any(String));
    expect(cookiePair(response, 'State')).toBe('State=');
    expect(jwksFetch).toHaveBeenCalled();

    const protectedRequest = request('/api/user', { cookie: sessionCookie });
    expect(await withAuthentication(protectedRequest, env)).toBeUndefined();
    expect(protectedRequest.user).toMatchObject(SESSION_FIELDS);
    const logout = await authRouter.fetch(request('/auth/logout', { cookie: sessionCookie }), env);
    expect(logout.status).toBe(302);
    const destination = new URL(logout.headers.get('Location'));
    expect(destination.hostname).toBe('login.microsoftonline.com');
    expect(destination.searchParams.get('post_logout_redirect_uri')).toBe(`${ORIGIN}/en/`);
    expect(cookiePair(logout, 'Session')).toBe('Session=');
    expect(cookiePair(logout, 'State')).toBe('State=');
    const unauthenticated = await withAuthentication(request('/api/user'), env);
    expect(new URL(unauthenticated.headers.get('Location')).pathname).toBe(LOGIN_PAGE);
  });

  it('awaits analytics and login-report hooks with Spark fields before issuing Session', async () => {
    const analyticsEntered = deferred();
    const releaseAnalytics = deferred();
    const reportEntered = deferred();
    const releaseReport = deferred();
    trackAnalyticsEvent.mockImplementation(() => {
      analyticsEntered.resolve();
      return releaseAnalytics.promise;
    });
    upsertUserLogin.mockImplementation(() => {
      reportEntered.resolve();
      return releaseReport.promise;
    });
    const flow = await startLogin();
    let settled = false;
    const pending = callback(flow).then((response) => {
      settled = true;
      return response;
    });
    try {
      await analyticsEntered.promise;
      expect(settled).toBe(false);
      expect(upsertUserLogin).not.toHaveBeenCalled();
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(env, 'login', {
        userId: SESSION_FIELDS.userId,
        country: 'US',
        employeeType: 'Employee',
        company: 'Adobe',
        roles: ['admin', 'employee'],
      });
      releaseAnalytics.resolve();
      await reportEntered.promise;
      expect(settled).toBe(false);
      expect(upsertUserLogin).toHaveBeenCalledWith(env, {
        email: EMAIL,
        userId: SESSION_FIELDS.userId,
        fullName: SESSION_FIELDS.name,
        title: 'Analyst',
        country: 'US',
        employeeType: 'Employee',
        company: 'Adobe',
        roles: ['admin', 'employee'],
        permissions: SESSION_FIELDS.permissions,
      });
    } finally {
      releaseAnalytics.resolve();
      releaseReport.resolve();
    }
    const response = await pending;
    expect(response.status).toBe(302);
    expect(cookiePair(response, 'Session')).toMatch(/^Session=.+/);
  });

  it('fails closed without Session when either awaited login-report hook rejects', async () => {
    for (const failingHook of [trackAnalyticsEvent, upsertUserLogin]) {
      trackAnalyticsEvent.mockResolvedValue(undefined);
      upsertUserLogin.mockResolvedValue(undefined);
      failingHook.mockRejectedValue(new Error('synthetic private report failure'));
      const response = await callback(await startLogin());
      expect(response.status).toBe(503);
      expectNoSession(response);
      expect(await response.text()).toBe('Service Unavailable');
      expect(cookiePair(response, 'State')).toBe('State=');
    }
  });

  it('rejects a preview callback without application preview permission and writes no reports', async () => {
    application = { '*': { permissions: ['search'] } };
    const response = await callback(await startLogin({ origin: PREVIEW }));
    expect(response.status).toBe(401);
    expectNoSession(response);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    expect(upsertUserLogin).not.toHaveBeenCalled();
  });

  it('accepts preview access only after resolving the actual application permissions', async () => {
    const response = await callback(await startLogin({ origin: PREVIEW }));
    expect(response.status).toBe(302);
    const protectedRequest = request('/api/user', { origin: PREVIEW, cookie: cookiePair(response, 'Session') });
    expect(await withAuthentication(protectedRequest, env)).toBeUndefined();
    expect(protectedRequest.user.permissions).toEqual(SESSION_FIELDS.permissions);
    expect(protectedRequest.user.iss).toBe(PREVIEW);
  });

  it('uses real getUser SUDO policy to remove admin and re-resolve target permissions', async () => {
    const response = await callback(await startLogin());
    const protectedRequest = request('/api/user', {
      cookie: `${cookiePair(response, 'Session')}; SUDO_EMAIL=${TARGET_EMAIL}; SUDO_COUNTRY=Italy`,
    });
    expect(await withAuthentication(protectedRequest, env)).toBeUndefined();
    expect(protectedRequest.user).toMatchObject({
      email: TARGET_EMAIL,
      domain: 'agency.example',
      country: 'italy',
      roles: ['partner'],
      userType: 'external',
      countries: ['india'],
      permissions: ['search', 'download'],
      su: { email: EMAIL, roles: ['admin', 'employee'], permissions: SESSION_FIELDS.permissions },
    });
  });

  it('ignores SUDO cookies for a real user without sudo permission', async () => {
    application[EMAIL] = { permissions: ['report-searches'] };
    const response = await callback(await startLogin());
    const protectedRequest = request('/api/user', {
      cookie: `${cookiePair(response, 'Session')}; SUDO_EMAIL=${TARGET_EMAIL}; SUDO_COUNTRY=Italy`,
    });
    expect(await withAuthentication(protectedRequest, env)).toBeUndefined();
    expect(protectedRequest.user.email).toBe(EMAIL);
    expect(protectedRequest.user.country).toBe('US');
    expect(protectedRequest.user.roles).toEqual(['admin', 'employee']);
    expect(protectedRequest.user.su).toBeUndefined();
  });

  it('accepts an old HS256 Spark Session with its original custom payload and no typ or iat', async () => {
    const protectedRequest = request('/api/user', { cookie: await legacySession() });
    expect(await withAuthentication(protectedRequest, env)).toBeUndefined();
    expect(protectedRequest.user).toMatchObject({ ...SESSION_FIELDS, sid: 'legacy-session-id' });
    expect(protectedRequest.user.iat).toBeUndefined();
    expect(fetchHelixSheet).not.toHaveBeenCalled();
  });

  it('passes an unauthenticated authored LOGIN_PAGE through for the outer content router', async () => {
    const result = await authRouter.fetch(request(`${LOGIN_PAGE}?url=%2Fen%2Fsearch`), env);
    expect(result).toBeUndefined();
    expect(fetchHelixSheet).not.toHaveBeenCalled();
    expect(jwksFetch).not.toHaveBeenCalled();
  });

  it('redirects a valid Session from the authored login page to its original target', async () => {
    const result = await authRouter.fetch(
      request(`${LOGIN_PAGE}?url=${encodeURIComponent('/en/search?query=coffee')}`, {
        cookie: await legacySession(),
      }),
      env,
    );
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe(`${ORIGIN}/en/search?query=coffee`);
  });

  it('sends an invalid Session directly to auth/login and removes stale request identity', async () => {
    const protectedRequest = request('/api/user?tab=profile', { cookie: 'Session=invalid-token' });
    protectedRequest.user = { email: 'stale@example.com', roles: ['admin'] };
    const result = await withAuthentication(protectedRequest, env);
    expect(result.status).toBe(302);
    const destination = new URL(result.headers.get('Location'));
    expect(destination.pathname).toBe('/auth/login');
    expect(destination.searchParams.get('url')).toBe('/api/user?tab=profile');
    expect(protectedRequest.user).toBeUndefined();
    expect(cookiePair(result, 'Session')).toBe('Session=');
  });

  it('sanitizes external, malformed, encoded, and looping return targets', async () => {
    const cookie = await legacySession();
    for (const target of [
      'https://evil.example/private',
      '//evil.example',
      '/%ZZ',
      '/%255cevil',
      '/auth/login',
      LOGIN_PAGE,
    ]) {
      const flow = await startLogin({ target });
      const { payload } = await jwtVerify(cookieToken(flow.stateCookie), SIGNING_KEY);
      expect(payload.returnPath).toBe('/');
      const result = await authRouter.fetch(
        request(`${LOGIN_PAGE}?url=${encodeURIComponent(target)}`, { cookie }),
        env,
      );
      expect(result.headers.get('Location')).toBe(`${ORIGIN}/`);
    }
  });

  it('fails closed with 503 for missing secret bindings in middleware and public auth routes', async () => {
    for (const missingEnv of [{}, undefined]) {
      const protectedRequest = request('/api/user');
      protectedRequest.user = { email: 'stale@example.com', roles: ['admin'] };
      const middlewareResult = await withAuthentication(protectedRequest, missingEnv);
      expect(middlewareResult.status).toBe(503);
      expectNoSession(middlewareResult);
      expect(protectedRequest.user).toBeUndefined();
      for (const path of [LOGIN_PAGE, '/auth/login', '/auth/logout']) {
        const result = await authRouter.fetch(request(path), missingEnv);
        expect(result.status).toBe(503);
        expectNoSession(result);
      }
    }
    expect(jwksFetch).not.toHaveBeenCalled();
  });

  it('rejects genuinely RSA-signed Microsoft tokens outside issuer, audience, nonce, tenant, or expiry boundaries', async () => {
    const invalidClaims = [
      { iss: 'https://login.microsoftonline.com/untrusted/v2.0' },
      { aud: 'untrusted-client' },
      { nonce: 'untrusted-nonce' },
      { tid: 'untrusted-tenant' },
      { exp: Math.floor(Date.now() / 1000) - 60 },
      { email: undefined },
    ];
    for (const changes of invalidClaims) {
      const response = await callback(await startLogin(), { changes });
      expect(response.status).toBe(401);
      expectNoSession(response);
      expect(cookiePair(response, 'State')).toBe('State=');
    }
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    expect(upsertUserLogin).not.toHaveBeenCalled();
  });

  it('rejects an altered RSA signature without stubbing JWT verification', async () => {
    const flow = await startLogin();
    const parts = (await signIdToken(flow)).split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const response = await callback(flow, { token: parts.join('.') });
    expect(response.status).toBe(401);
    expectNoSession(response);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('rejects mismatched or missing state and lets the SDK parse native callback cookies itself', async () => {
    const flow = await startLogin({ parseCookies: false });
    const mismatch = await callback(flow, { state: 'not-the-issued-state' });
    expect(mismatch.status).toBe(401);
    expectNoSession(mismatch);
    const missing = await callback(flow, { cookie: '' });
    expect(missing.status).toBe(401);
    expectNoSession(missing);
    const accepted = await callback(flow, { parseCookies: false });
    expect(accepted.status).toBe(302);
    expect(cookiePair(accepted, 'Session')).toMatch(/^Session=.+/);
  });
});
