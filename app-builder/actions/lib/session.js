/**
 * Session + Entra id_token handling — the platform-neutral crypto core of the
 * Worker's auth.js, ported verbatim in intent. Runs on Node's global WebCrypto
 * via `jose`, proving the auth layer ports cleanly to App Builder.
 *
 * PoC scope note: the Worker's createSession() also resolves per-user roles and
 * permissions from Helix `config/access/*` sheets and writes login analytics to
 * D1 + CF Analytics Engine. Those side-effects are intentionally omitted here
 * (see FINDINGS.md "auth"): they are ordinary authenticated fetch/D1 calls that
 * would port the same way as smart-collections, and are not needed to prove the
 * SSO + signed-session mechanism works on Runtime.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { config } from './config.js';

const JWKS = createRemoteJWKSet(new URL(config.MICROSOFT_ENTRA_JWKS_URL));

/** Sign our own HS256 session cookie (mirrors auth.js createSessionJWT). */
export async function createSessionJWT(origin, secret, session) {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...session, sid: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(origin)
    .setAudience(config.MICROSOFT_ENTRA_CLIENT_ID)
    .setExpirationTime(config.SESSION_COOKIE_EXPIRATION)
    .setNotBefore('0m')
    .sign(key);
}

/** Verify our session cookie (mirrors auth.js validateSessionJWT). */
export async function verifySessionJWT(origin, secret, jwt) {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(jwt, key, {
      issuer: origin,
      audience: config.MICROSOFT_ENTRA_CLIENT_ID,
      clockTolerance: 5,
    });
    return payload;
  } catch {
    return null;
  }
}

/** Verify a Microsoft Entra id_token (mirrors auth.js validateIdToken). */
export async function verifyIdToken(rawIdToken, nonce) {
  const { payload } = await jwtVerify(rawIdToken, JWKS, {
    audience: config.MICROSOFT_ENTRA_CLIENT_ID,
    issuer: `https://login.microsoftonline.com/${config.MICROSOFT_ENTRA_TENANT_ID}/v2.0`,
  });
  if (nonce && payload.nonce !== nonce) throw new Error('Invalid nonce');
  if (payload.tid !== config.MICROSOFT_ENTRA_TENANT_ID) throw new Error('Invalid tenant');
  return payload;
}

/**
 * Build the session payload from a verified id_token. Simplified vs the Worker
 * (no Helix-sheet role/permission merge) — see module note.
 */
export function sessionFromIdToken(idToken) {
  const email = (idToken.email || idToken.preferred_username || '').toLowerCase();
  return {
    sub: idToken.oid,
    name: idToken.name,
    email,
    domain: email.split('@').pop(),
    country: idToken.ctry,
    employeeType: idToken.EmployeeType,
    userId: idToken['User ID'],
    company: idToken.Company,
    title: idToken.Title,
    roles: [],
    permissions: [],
  };
}
