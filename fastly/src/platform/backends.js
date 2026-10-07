// Platform seam #2 (Fastly-specific): every outbound fetch on Fastly Compute must
// name a declared backend. This maps an outbound URL's host to one of the backends
// declared in fastly.toml, so business logic can call fetchBackend(url) without
// knowing backend names. Swap this file (+ env.js) and the same logic runs elsewhere.

const RULES = [
  [/\.aem\.page$/i, 'helix_page'],
  [/\.aem\.live$/i, 'helix_live'],
  [/(^|\.)ims-na1\.adobelogin\.com$/i, 'ims'],
  [/aem-content-optimizer-agent\.adobe\.io$/i, 'coa'],
  [/\.adobeaemcloud\.com$/i, 'dm_delivery'],
  [/(^|\.)login\.microsoftonline\.com$/i, 'entra_jwks'],
  [/(^|\.)api\.cloudflare\.com$/i, 'cf_api'], // D1 over HTTP (PoC data tier)
];

export function backendFor(input) {
  // Accept a string, a Request (has .url), or a URL object (has .href).
  const href = typeof input === 'string' ? input : (input.url ?? input.href ?? String(input));
  const host = new URL(href).hostname;
  for (const [re, name] of RULES) if (re.test(host)) return name;
  return null;
}

// Drop-in fetch that auto-selects the declared backend for the URL's host.
export function fetchBackend(input, init = {}) {
  const backend = init.backend || backendFor(input);
  // If no declared backend matches, fall through to a bare fetch. On a
  // Dynamic-Backends-enabled service that auto-creates one; otherwise it throws
  // (surfaced clearly rather than silently mis-routing).
  return backend ? fetch(input, { ...init, backend }) : fetch(input, init);
}
