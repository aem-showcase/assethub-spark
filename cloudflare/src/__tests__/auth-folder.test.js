import { withCookies } from 'itty-router';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    default: Object.freeze({ ...original.default, DEMO_BASE_PATH: '/companies/pilot' }),
    companyBasePath: () => '/companies/pilot',
  };
});

const { authRouter, LEGACY_LOGIN_PAGE, LOGIN_PAGE, withAuthentication } = await import('../auth.js');
const { default: config } = await import('../config.js');
const ORIGIN = 'https://frescopamedia.com';
const SECRET = 'spark-folder-pilot-synthetic-secret-not-a-real-credential';
const env = {
  COOKIE_SECRET: {
    async get() {
      return SECRET;
    },
  },
};

function request(path, cookie) {
  const headers = new Headers({ Host: 'frescopamedia.com' });
  if (cookie) headers.set('Cookie', cookie);
  const result = new Request(new URL(path, ORIGIN), { headers });
  withCookies(result);
  for (const name of Object.keys(result.cookies)) {
    result.cookies[name] = decodeURIComponent(result.cookies[name]);
  }
  return result;
}

async function sessionCookie() {
  const token = await new SignJWT({
    sub: 'folder-pilot-user',
    email: 'folder-pilot@example.com',
    roles: ['employee'],
    permissions: ['search'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ORIGIN)
    .setAudience(config.MICROSOFT_ENTRA_CLIENT_ID)
    .setNotBefore('0m')
    .setExpirationTime('6h')
    .sign(new TextEncoder().encode(SECRET));
  return `Session=${token}`;
}

describe('Spark SDK auth with an isolated foldered config', () => {
  it('preserves foldered authored login paths and original targets without changing auth endpoints', async () => {
    expect(LOGIN_PAGE).toBe('/companies/pilot/login');
    expect(LEGACY_LOGIN_PAGE).toBe('/companies/pilot/public/welcome');
    expect(await authRouter.fetch(request(LOGIN_PAGE), env)).toBeUndefined();
    const missing = await withAuthentication(request('/companies/pilot/en/search?query=coffee'), env);
    const destination = new URL(missing.headers.get('Location'));
    expect(destination.pathname).toBe(LOGIN_PAGE);
    expect(destination.searchParams.get('url')).toBe('/companies/pilot/en/search?query=coffee');

    const result = await authRouter.fetch(
      request(`${LOGIN_PAGE}?url=%2Fcompanies%2Fpilot%2Fen%2Fsearch`, await sessionCookie()),
      env,
    );
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe(`${ORIGIN}/companies/pilot/en/search`);

    const login = await authRouter.fetch(request('/auth/login'), env);
    expect(login.status).toBe(302);
    expect(new URL(login.headers.get('Location')).searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
  });

  it('returns Microsoft logout to the foldered locale home and clears both local auth cookies', async () => {
    const result = await authRouter.fetch(request('/auth/logout', await sessionCookie()), env);
    expect(result.status).toBe(302);
    const destination = new URL(result.headers.get('Location'));
    expect(destination.hostname).toBe('login.microsoftonline.com');
    expect(destination.searchParams.get('post_logout_redirect_uri')).toBe(`${ORIGIN}/companies/pilot/en/`);
    const cookies = result.headers.getSetCookie();
    for (const name of ['Session', 'State']) {
      expect(cookies.find((value) => value.startsWith(`${name}=`))).toMatch(/Max-Age=0/);
    }
  });
});
