/**
 * Shared response/body helpers for the aio-lib-db-backed API handlers.
 * They return the raw web-action response shape `{ statusCode, headers, body }`
 * (same contract the dispatcher's `ow()` produces), so the dispatcher can return
 * their result directly without going through the Fetch `Response` adapter.
 */

export function jsonRes(statusCode, obj, headers = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(obj),
  };
}

export function noContent() {
  return { statusCode: 204, headers: {}, body: '' };
}

/** Parse a JSON request body, returning undefined on malformed input. */
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
