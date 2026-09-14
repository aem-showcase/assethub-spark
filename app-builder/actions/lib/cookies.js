/**
 * Cookie parse/serialize helpers. The Worker uses itty's `withCookies` + a
 * `setCookie` util; on Runtime we parse the raw `cookie` header ourselves and
 * collect `Set-Cookie` values to emit on the action response.
 */

/** Parse a Cookie header into a decoded name->value map. */
export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/** Serialize one Set-Cookie value (mirrors cloudflare/src/util/http.js setCookie). */
export function serializeCookie(name, value, options = {}) {
  return (
    `${name}=${value}; ` +
    `${options.Domain ? `Domain=${options.Domain}; ` : ''}` +
    `Path=${options.Path || '/'};` +
    `${options.HttpOnly === false ? '' : ' HttpOnly;'}` +
    `${options.Secure === false ? '' : ' Secure;'} ` +
    `${options.SameSite === false ? '' : `SameSite=${options.SameSite || 'Strict'};`}` +
    `${options.Expires ? ` Expires=${options.Expires};` : ''}` +
    `${options.MaxAge ? ` Max-Age=${options.MaxAge};` : ''}`
  );
}

export function deleteCookieValue(name) {
  return serializeCookie(name, '', {
    Path: '/',
    Secure: false,
    SameSite: false,
    Expires: 'Thu, 01 Jan 1970 00:00:00 GMT',
  });
}
