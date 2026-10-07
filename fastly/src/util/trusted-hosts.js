/**
 * @fileoverview Trusted-host check for COA-returned image/asset URLs.
 *
 * Ported verbatim from cloudflare/src/util/trusted-hosts.js (pure URL logic; no
 * runtime-specific APIs). Note the interplay with the Fastly backend router: a
 * trusted host that isn't a declared backend (e.g. an `*.adobe.io` host other than
 * the COA/DM ones) still requires Dynamic Backends to be fetched — see
 * origin/coa.js `originCoaImage`.
 *
 * Lets the Worker decide, server-side, whether a COA response URL is safe to fetch
 * with the cached IMS bearer token before streaming it back to the browser.
 */

const TRUSTED_HOST_SUFFIXES = ['adobe.io', 'adobeaemcloud.com'];

/**
 * @param {string} src - URL to check
 * @returns {boolean} true if the URL is https (or localhost) and its hostname is
 *   exactly a trusted suffix or a subdomain of one
 */
export function isTrustedHost(src) {
  try {
    const { hostname, protocol } = new URL(src);
    if (hostname !== 'localhost' && protocol !== 'https:') {
      return false;
    }
    return TRUSTED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}
