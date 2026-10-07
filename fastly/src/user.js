import { json } from 'itty-router';
import config, { companyBasePath } from './config.js';
import { hasPermission, PERMISSIONS } from './auth/permissions.js';
import { fetchHelixSheet } from './util/helixutil.js';
import { maskEmail } from './util/log-utils.js';

// Ported from cloudflare/src/user.js. Only change: permissions import path
// ('../../scripts/auth/permissions.js' -> './auth/permissions.js', copied into the port).
// All authorization logic (sheet-driven roles/permissions/userType, sudo) is unchanged.

export const ROLE = {
  ADMIN: 'admin',
};

export const USER_TYPE = {
  INTERNAL: 'internal',
  EXTERNAL: 'external',
  ALL: 'all',
};

const INTERNAL_DOMAINS = new Set(['adobe.com']);

function getEmailDomain(email) {
  return email.split('@').pop().toLowerCase();
}

function pushUnique(array, items) {
  items = Array.isArray(items) ? items : [items];
  array.push(...items.filter((item) => !array.includes(item)));
}

function resolveUserType(domain, userOverride) {
  if (userOverride?.userType === USER_TYPE.INTERNAL) return USER_TYPE.INTERNAL;
  if (userOverride?.userType === USER_TYPE.EXTERNAL) return USER_TYPE.EXTERNAL;
  return INTERNAL_DOMAINS.has(domain) ? USER_TYPE.INTERNAL : USER_TYPE.EXTERNAL;
}

async function getUserAttributes(request, env, user) {
  const email = user.email;
  const domain = user.domain;

  const attributes = { roles: [], userType: null, countries: [] };

  const userArrays = ['roles', 'countries'];
  const users = await fetchHelixSheet(request, env, `${companyBasePath()}/config/access/users`, {
    params: { limit: 50000 },
    mergeSheets: {
      key: 'email',
      arrays: userArrays,
      merge: (existing, incoming) => {
        userArrays.forEach((f) => pushUnique(existing[f], incoming[f]));
        if (!existing.userType && incoming.userType) existing.userType = incoming.userType;
        return existing;
      },
    },
  });

  const userOverride = users?.[email] || users?.[domain];
  if (userOverride) {
    pushUnique(attributes.roles, userOverride.roles);
    pushUnique(attributes.countries, userOverride.countries);
  }

  attributes.userType = resolveUserType(domain, userOverride);
  return attributes;
}

async function resolvePermissions(request, env, email) {
  const domain = getEmailDomain(email);
  const access = await fetchHelixSheet(request, env, `${companyBasePath()}/config/access/application`, {
    sheet: { key: 'email', arrays: ['permissions'] },
  });
  return [
    ...(access?.['*']?.permissions || []),
    ...(access?.[domain]?.permissions || []),
    ...(access?.[email]?.permissions || []),
  ];
}

async function handleSudo(request, env, user) {
  if (['SUDO_NAME', 'SUDO_EMAIL', 'SUDO_COUNTRY', 'SUDO_EMPLOYEE_TYPE'].some((c) => request.cookies[c])) {
    if (!hasPermission(user, PERMISSIONS.SUDO)) {
      console.warn('Sudo denied for user:', user.email);
      return user;
    }

    user.su = {
      name: user.name,
      email: user.email,
      country: user.country,
      employeeType: user.employeeType,
      roles: user.roles,
      userType: user.userType,
      countries: user.countries,
      permissions: user.permissions,
    };

    user.name = request.cookies.SUDO_NAME || user.name;
    user.email = request.cookies.SUDO_EMAIL || user.email;
    user.employeeType = request.cookies.SUDO_EMPLOYEE_TYPE || user.employeeType;

    const sudoDomain = getEmailDomain(user.email);
    const attributes = await getUserAttributes(request, env, {
      email: user.email,
      domain: sudoDomain,
      employeeType: user.employeeType,
    });
    user.country = (request.cookies.SUDO_COUNTRY || attributes.countries?.[0] || '').toLowerCase();
    attributes.roles = attributes.roles.filter((role) => role !== ROLE.ADMIN);
    const sudoPermissions = (await resolvePermissions(request, env, user.email))
      .filter((p) => p !== PERMISSIONS.SUDO);
    user = { ...user, domain: sudoDomain, ...attributes, permissions: sudoPermissions };
  }

  return user;
}

export async function createSession(request, env) {
  const idToken = request.idToken;
  if (!idToken || !idToken.email) return null;

  const email = idToken.email?.toLowerCase();
  const domain = getEmailDomain(email);

  const permissions = await resolvePermissions(request, env, email);

  const host = request.headers.get('host') || '';
  const liveHosts = ['localhost', 'frescopamedia.com'];
  const isNonLiveHost = !liveHosts.some((h) => host === h || host.startsWith(`${h}:`));
  if (isNonLiveHost) {
    if (!permissions.includes('preview')) {
      console.warn('User has no permission to access preview environments:', email);
      return false;
    }
  }

  const attributes = await getUserAttributes(request, env, {
    email,
    domain,
    country: idToken.ctry,
    employeeType: idToken.EmployeeType,
  });

  const session = {
    sub: idToken.oid,
    name: idToken.name,
    email,
    domain,
    country: idToken.ctry,
    employeeType: idToken.EmployeeType,
    userId: idToken['User ID'],
    company: idToken.Company,
    title: idToken.Title,
    permissions,
    ...attributes,
  };

  console.warn('New session:', {
    email: maskEmail(session.email),
    userType: session.userType,
    roles: session.roles || [],
    permissions: session.permissions || [],
    countries: session.countries || [],
  });

  return session;
}

export async function getUser(request, env, session) {
  return handleSudo(request, env, session);
}

export async function apiUser(request, _env) {
  const user = {
    ...request.user,
    sessionExpiresInSec: request.user.exp && Math.floor((request.user.exp * 1000 - Date.now()) / 1000),
    aemLoginUrl: config.AEM_ENV_ID ? `https://publish-${config.AEM_ENV_ID}.adobeaemcloud.com/content/share/us/en.html` : '',
  };

  delete user.sub;
  delete user.sid;
  delete user.iss;
  delete user.aud;
  delete user.exp;
  delete user.nbf;

  return json(user);
}
