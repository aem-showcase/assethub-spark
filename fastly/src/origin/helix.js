// Helix/EDS origin proxy — ported from cloudflare/src/origin/helix.js.
// Business logic (search-param sanitization, header hygiene, redirects) is unchanged.
// Fastly-specific adaptations, all isolated and commented:
//   - dropped Cloudflare's extra-ports 301 (a CF-network quirk that would wrongly
//     redirect the Viceroy localhost:PORT URL);
//   - fetch goes through a declared backend (backendFor);
//   - cf.cacheEverything / cache:'no-store' -> Fastly CacheOverride.
import config from '../config.js';
import { backendFor } from '../platform/backends.js';
import { CacheOverride } from 'fastly:cache-override';

const getExtension = (path) => {
  const basename = path.split('/').pop();
  const pos = basename.lastIndexOf('.');
  return basename === '' || pos < 1 ? '' : basename.slice(pos + 1);
};

const isMediaRequest = (url) => /\/media_[0-9a-f]{40,}[/a-zA-Z0-9_-]*\.[0-9a-z]+$/.test(url.pathname);
const isRUMRequest = (url) => /\/\.(rum|optel)\/.*/.test(url.pathname);

export async function originHelix(request, env) {
  const url = new URL(request.url);

  if (isRUMRequest(url)) {
    if (!['GET', 'POST', 'OPTIONS'].includes(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }
  }

  const extension = getExtension(url.pathname);
  const savedSearch = url.search;

  // sanitize search params
  const { searchParams } = url;
  if (isMediaRequest(url)) {
    for (const [key] of searchParams.entries()) {
      if (!['format', 'height', 'optimize', 'width'].includes(key)) searchParams.delete(key);
    }
  } else if (extension === 'json') {
    for (const [key] of searchParams.entries()) {
      if (!['limit', 'offset', 'sheet'].includes(key)) searchParams.delete(key);
    }
  } else {
    url.search = '';
  }
  searchParams.sort();

  // Matches the CF original: preview hostnames set request.helixOrigin (.aem.page) via
  // index.js withPreviewOrigin; otherwise use env.HELIX_ORIGIN (.aem.live).
  const helixOrigin = request.helixOrigin || env.HELIX_ORIGIN;
  if (!helixOrigin) {
    console.error('HELIX_ORIGIN is not set');
    return new Response('HELIX_ORIGIN is not configured', { status: 500 });
  }
  if (
    !helixOrigin.match(/^http:\/\/localhost:\d+$/) &&
    !helixOrigin.match(/^https:\/\/.*--.*--.*\.(?:aem|hlx)\.(live|page)$/)
  ) {
    return new Response('Invalid HELIX_ORIGIN', { status: 500 });
  }
  const [proto, host] = helixOrigin.split('://');
  url.port = '';
  url.protocol = proto;
  url.host = host;

  const req = new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  req.headers.set('x-forwarded-host', request.headers.get('host') || '');
  req.headers.set('x-byo-cdn-type', 'fastly');

  const isLocalHelix = /^http:\/\/localhost:\d+$/.test(helixOrigin);
  if (env.HELIX_ORIGIN_AUTHENTICATION && !isLocalHelix) {
    const token = await env.HELIX_ORIGIN_AUTHENTICATION.get();
    if (token) req.headers.set('authorization', `token ${token}`);
  }
  const pushInvalidation = config.HELIX_PUSH_INVALIDATION !== 'disabled';
  if (pushInvalidation) req.headers.set('x-push-invalidation', 'enabled');

  // CF used cf.cacheEverything / cache:'no-store'. On Fastly: CacheOverride.
  // pushInvalidation is 'disabled' in this app, so we pass (don't cache) — matches
  // the CF no-store branch and avoids caching authenticated/HTML responses.
  const options = {
    backend: backendFor(req.url),
    cacheOverride: new CacheOverride('pass'),
  };

  let resp = await fetch(req, options);

  resp = new Response(resp.body, resp);
  if (resp.status === 301 && savedSearch) {
    const location = resp.headers.get('location');
    if (location && !location.match(/\?.*$/)) {
      resp.headers.set('location', `${location}${savedSearch}`);
    }
  }
  if (resp.status === 304) resp.headers.delete('Content-Security-Policy');
  resp.headers.delete('age');
  resp.headers.delete('x-robots-tag');
  return resp;
}
