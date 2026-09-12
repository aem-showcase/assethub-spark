/**
 * Static worker configuration — single source of truth.
 * (Copied verbatim from cloudflare/src/config.js — platform-agnostic, ports as-is.)
 */

const config = {
  // AEM environment (Program-Environment) id for the backing DM tenant.
  AEM_ENV_ID: 'p203220-e2129061',

  // Demo customer scope.
  DEMO_COMPANY: 'frescopa',

  // Content base path for a foldered demo ('' = repo root).
  DEMO_BASE_PATH: '',

  // Content Optimization Agent environment.
  COA_ENV: 'prod',

  // Helix push-invalidation mode. 'disabled' turns off cache purge on publish.
  HELIX_PUSH_INVALIDATION: 'disabled',

  // Microsoft Entra ID (Azure AD) app used for SSO login.
  MICROSOFT_ENTRA_TENANT_ID: '983cbc50-8ad1-4dde-b705-7c80477a4186',
  MICROSOFT_ENTRA_CLIENT_ID: '93e6431f-2f57-4612-96c8-1464640b4280',
  MICROSOFT_ENTRA_JWKS_URL: 'https://login.microsoftonline.com/common/discovery/keys',

  // Lifetime of our own session JWT cookie.
  SESSION_COOKIE_EXPIRATION: '6h',

  // (Analytics Engine account id removed — AE is dead code in the Fastly port.)

  // Alphabet for sqids id obfuscation (not yet consumed by shipping code).
  SQIDS_ALPHABET: '8gGQeDOJsS069Pod4mU2BKWRXjpiThLkZEHCantwuV7IrcqfAzMbN3vx1YlF5y',
};

export default Object.freeze(config);

/**
 * Content base path for the current deploy.
 * @returns {string}
 */
export function companyBasePath() {
  const raw = (config.DEMO_BASE_PATH || '').trim();
  if (!raw) return '';
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.replace(/\/+$/, '');
}
