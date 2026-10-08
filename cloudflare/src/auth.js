import { AuthConfigurationError, createEntraAuth } from '@assethub/sdk';
import { Router } from 'itty-router';
import config, { companyBasePath } from './config.js';
import { createSession, getUser } from './user.js';
import { maskEmail } from './util/log-utils.js';

// The authored login page stays public and follows the foldered demo's content base.
export const LOGIN_PAGE = `${companyBasePath()}/login`;
export const LEGACY_LOGIN_PAGE = `${companyBasePath()}/public/welcome`;

async function recordLogin(session, { env }) {
  if (!session.userId) {
    console.warn(
      '[Analytics] Login event written with no user ID.',
      `email=${maskEmail(session.email)}`,
      `company=${session.company}`,
    );
  }
  const { trackAnalyticsEvent } = await import('./util/analytics-helper.js');
  await trackAnalyticsEvent(env, 'login', {
    userId: session.userId,
    country: session.country,
    employeeType: session.employeeType,
    company: session.company,
    roles: session.roles || [],
  });

  const { upsertUserLogin } = await import('./api/user-logins.js');
  await upsertUserLogin(env, {
    email: session.email,
    userId: session.userId,
    fullName: session.name,
    title: session.title,
    country: session.country,
    employeeType: session.employeeType,
    company: session.company,
    roles: session.roles || [],
    permissions: session.permissions || [],
  });
}

const auth = createEntraAuth({
  apps: [
    {
      name: 'spark',
      tenantId: config.MICROSOFT_ENTRA_TENANT_ID,
      clientId: config.MICROSOFT_ENTRA_CLIENT_ID,
      jwksUrl: config.MICROSOFT_ENTRA_JWKS_URL,
    },
  ],
  allowedOrigins: config.ENTRA_ALLOWED_ORIGINS,
  loginPage: LOGIN_PAGE,
  postLogoutPath: `${companyBasePath()}/en/`,
  sessionTtlSeconds: config.SESSION_COOKIE_TTL_SECONDS,
  getSigningSecret: ({ env }) => env.COOKIE_SECRET.get(),
  mapSession: (claims, { request, env }) => {
    request.idToken = claims;
    request.uri = new URL(request.url);
    return createSession(request, env);
  },
  resolveUser: (session, { request, env }) => getUser(request, env, session),
  onLogin: recordLogin,
});

/** Middleware for Spark's protected content and API routes. */
export async function withAuthentication(request, env, context) {
  request.uri = new URL(request.url);
  if (typeof env?.COOKIE_SECRET?.get !== 'function') {
    delete request.user;
    return new Response('Service Unavailable', { status: 503 });
  }
  return auth.withAuthentication(request, env, context);
}

/** Keep Spark's authored login page and guarded logout around the shared protocol. */
export const authRouter = Router({
  before: [
    (request, env) => {
      request.uri = new URL(request.url);
      if (typeof env?.COOKIE_SECRET?.get !== 'function') {
        return new Response('Service Unavailable', { status: 503 });
      }
    },
  ],
});

authRouter
  .get(LOGIN_PAGE, async (request, env, context) => {
    try {
      const result = await auth.readSession(request, env, context);
      if (result.status === 'valid') {
        return Response.redirect(auth.resolveReturnUrl(request, request.uri.searchParams.get('url')), 302);
      }
      // Otherwise pass through to the authored page in index.js.
    } catch (error) {
      if (error instanceof AuthConfigurationError) {
        return new Response('Service Unavailable', { status: 503 });
      }
      throw error;
    }
  })
  .get('/auth/login', auth.login)
  .post('/auth/callback', auth.callback)
  .get('/auth/logout', withAuthentication, auth.logout)
  .all('/auth/*', () => new Response('Not Found', { status: 404 }));
