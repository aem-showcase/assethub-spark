/**
 * Static config for the PoC — the environment-independent values copied verbatim
 * from cloudflare/src/config.js (single source of truth on the Worker side).
 * Kept as a plain module so it ports unchanged.
 */
export const config = Object.freeze({
  MICROSOFT_ENTRA_TENANT_ID: '983cbc50-8ad1-4dde-b705-7c80477a4186',
  MICROSOFT_ENTRA_CLIENT_ID: '93e6431f-2f57-4612-96c8-1464640b4280',
  MICROSOFT_ENTRA_JWKS_URL: 'https://login.microsoftonline.com/common/discovery/keys',
  SESSION_COOKIE_EXPIRATION: '6h',
  AEM_ENV_ID: 'p203220-e2129061',
});
