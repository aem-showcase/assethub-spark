import { cors as ittyCors } from 'itty-router';

/**
 * itty-router cors() wrapper. Copied verbatim from cloudflare/src/util/itty.js —
 * platform-agnostic. Allows an array of string/RegExp/Function origins and fixes the
 * immutable-headers issue.
 */
function allowOrigins(...allowedOrigins) {
  return (origin) => {
    if (!origin) return undefined;
    for (const allowed of allowedOrigins) {
      if (typeof allowed === 'string') {
        if (origin === allowed) return origin;
      } else if (allowed instanceof RegExp) {
        if (allowed.test(origin)) return origin;
      } else if (allowed instanceof Function) {
        if (allowed(origin)) return origin;
      }
    }
    return undefined;
  };
}

export function cors(options) {
  options.origin = allowOrigins(...options.origin);

  const appendHeadersAndReturn = (response, headers) => {
    for (const [key, value] of Object.entries(headers)) {
      if (value) response.headers.append(key, value);
    }
    return response;
  };

  const getAccessControlOrigin = (request) => {
    const requestOrigin = request?.headers.get('origin');
    return options.origin(requestOrigin);
  };

  const corsify = (response, request) => {
    if (response?.headers?.get('access-control-allow-origin') || response.status === 101) return response;
    return appendHeadersAndReturn(new Response(response.body, response), {
      'access-control-allow-origin': getAccessControlOrigin(request),
      'access-control-allow-credentials': options.credentials,
    });
  };

  return {
    preflight: ittyCors(options).preflight,
    corsify,
  };
}
