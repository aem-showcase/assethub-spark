/**
 * Origin proxy to the Helix (AEM Edge Delivery) backend.
 *
 * This is the Worker's core job — `origin/helix.js` streams arbitrary-size pages,
 * fonts, icons and media straight through (`new Response(resp.body, resp)`). On
 * App Builder the same pass-through is bounded by the 1 MB buffered-response cap
 * with no streaming (FINDINGS.md hard limit #1). We still perform the real fetch
 * so small assets (HTML shells, JSON, CSS, SVG) work and large ones surface the
 * documented wall via `toOwResponse`.
 */

const HELIX_ORIGIN_RE = /^https:\/\/.*--.*--.*\.(?:aem|hlx)\.(live|page)$/;

/**
 * @param {Request} request
 * @param {object} env  { HELIX_ORIGIN, HELIX_ORIGIN_AUTHENTICATION }
 * @returns {Promise<Response>}
 */
export async function originHelix(request, env) {
  const helixOrigin = env.HELIX_ORIGIN;
  if (!helixOrigin || !HELIX_ORIGIN_RE.test(helixOrigin)) {
    return new Response('Invalid or missing HELIX_ORIGIN', { status: 500 });
  }

  const url = new URL(request.url);
  const [proto, host] = helixOrigin.split('://');
  url.protocol = proto;
  url.host = host;
  url.port = '';

  const headers = new Headers();
  headers.set('x-forwarded-host', request.headers.get('host') || '');
  headers.set('x-byo-cdn-type', 'cloudflare');
  const ua = request.headers.get('user-agent');
  if (ua) headers.set('user-agent', ua);
  if (env.HELIX_ORIGIN_AUTHENTICATION) {
    headers.set('authorization', `token ${env.HELIX_ORIGIN_AUTHENTICATION}`);
  }

  const upstream = await fetch(url.toString(), {
    method: request.method,
    headers,
    cache: 'no-store',
  });

  // Re-wrap so headers are mutable; strip hop-by-hop noise like the Worker does.
  const resp = new Response(upstream.body, upstream);
  resp.headers.delete('age');
  resp.headers.delete('x-robots-tag');
  resp.headers.delete('content-encoding');
  resp.headers.delete('content-length');
  return resp;
}
