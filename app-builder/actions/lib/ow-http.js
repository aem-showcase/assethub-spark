/**
 * Adobe I/O Runtime <-> Fetch adapters.
 *
 * A Cloudflare Worker handler is `(request: Request, env) => Response`. An I/O
 * Runtime action is `(params) => { statusCode, headers, body }`. These helpers
 * bridge the two so the ported route handlers can keep using the standard Fetch
 * `Request`/`Response` objects (both are global in Node 22).
 *
 * `web: raw` action params of interest:
 *   __ow_method   lowercase HTTP method
 *   __ow_path     path after the action name (e.g. "/api/user")
 *   __ow_headers  request headers (lowercased keys)
 *   __ow_body     raw body (base64 string when binary, else utf-8 string)
 *   __ow_query    raw query string
 */

// I/O Runtime web actions return a single buffered result. Binary must be
// base64-encoded with isBase64Encoded=true. The hard cap is ~1 MB (see
// FINDINGS.md limit #1). We surface it as a constant so the proxy can detect
// and report the wall instead of failing opaquely.
export const RUNTIME_RESPONSE_LIMIT_BYTES = 1024 * 1024;

// NOTE: image/svg+xml is deliberately NOT here. The I/O Runtime web-action
// gateway classifies svg as a binary/image projection, so returning it as a
// UTF-8 string body triggers "Response type in header did not match generated
// content type" (400) — the same class of error as the reserved .svg extension
// (limit #13). Treating svg as binary (base64), exactly like other images,
// makes it pass through the /x-asset proxy cleanly.
const TEXTUAL_CONTENT_TYPE =
  /^(text\/|application\/(json|javascript|xml|manifest\+json)|application\/x-ndjson)/i;

/**
 * Reconstruct the public request URL. Runtime strips the action prefix from
 * __ow_path, so we rebuild an absolute URL the route handlers can `new URL()`.
 */
function buildUrl(params) {
  const headers = params.__ow_headers || {};
  const host = headers['x-forwarded-host'] || headers.host || 'localhost';
  const proto = headers['x-forwarded-proto'] || 'https';
  const path = params.__ow_path || '/';
  const query = params.__ow_query ? `?${params.__ow_query}` : '';
  return `${proto}://${host}${path}${query}`;
}

/** Build a standard Fetch `Request` from raw-web-action params. */
export function toRequest(params) {
  const method = (params.__ow_method || 'get').toUpperCase();
  const headers = new Headers(params.__ow_headers || {});

  let body;
  if (params.__ow_body !== undefined && method !== 'GET' && method !== 'HEAD') {
    // Adobe I/O Runtime's `web: raw` delivers `__ow_body` base64-encoded for every
    // content type EXCEPT `application/x-www-form-urlencoded`, which arrives as a
    // plain UTF-8 string. Base64-decoding that plain string corrupts it (this broke
    // the Entra `response_mode=form_post` SSO callback). Detect the exception.
    const ct = (params.__ow_headers || {})['content-type'] || '';
    if (/^application\/x-www-form-urlencoded/i.test(ct)) {
      body = Buffer.from(params.__ow_body, 'utf8');
    } else {
      body = Buffer.from(params.__ow_body, 'base64');
    }
  }

  return new Request(buildUrl(params), { method, headers, body });
}

/**
 * Convert a Fetch `Response` into the object a raw web action must return.
 *
 * Enforces/surfaces the 1 MB response cap: oversized bodies are the PoC's
 * headline hard limit, so rather than let the platform truncate silently we
 * return a 502 that documents the wall (unless the caller opts into truncation
 * for a demo).
 */
// Headers the platform recomputes for the returned body, or that describe the
// original transfer encoding. `fetch()` transparently decompresses, so passing
// the upstream content-encoding/content-length back makes the declared encoding
// disagree with the (now plain) bytes — Adobe I/O Runtime rejects that mismatch
// with "Response type in header did not match generated content type." Node's
// local server tolerates it, which is why it only surfaces on Stage.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

export async function toOwResponse(response, { onOversize = 'error' } = {}) {
  const headers = {};
  for (const [k, v] of response.headers.entries()) {
    if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) headers[k] = v;
  }

  const contentType = response.headers.get('content-type') || '';
  const buf = Buffer.from(await response.arrayBuffer());
  const isText = TEXTUAL_CONTENT_TYPE.test(contentType);

  if (buf.byteLength > RUNTIME_RESPONSE_LIMIT_BYTES && onOversize === 'error') {
    return {
      statusCode: 502,
      headers: {
        'content-type': 'application/json',
        'x-appbuilder-limit': 'response-1mb',
      },
      body: JSON.stringify({
        error: 'AppBuilderResponseLimit',
        message:
          'Upstream body exceeds the Adobe I/O Runtime 1 MB web-action response cap ' +
          '(non-configurable, no streaming). This is FINDINGS.md hard limit #1 — the ' +
          'Worker streams this pass-through; App Builder cannot.',
        upstreamBytes: buf.byteLength,
        limitBytes: RUNTIME_RESPONSE_LIMIT_BYTES,
        contentType,
      }),
    };
  }

  if (isText) {
    return { statusCode: response.status, headers, body: buf.toString('utf-8') };
  }
  return {
    statusCode: response.status,
    headers,
    body: buf.toString('base64'),
  };
}

/** Shape an error object as an I/O Runtime response. */
export function owError(statusCode, message) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}
