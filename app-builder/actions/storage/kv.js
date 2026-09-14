/**
 * KV adapter on @adobe/aio-lib-state, shaped to mimic the Cloudflare KV binding
 * API used by the Worker's `AUTH_TOKENS` token cache — including the
 * `getWithMetadata()` + `put(key, value, { expiration, metadata })` contract
 * that `origin/dm.js` (IMS token caching) relies on.
 *
 * Mapping (FINDINGS.md): Cloudflare KV -> aio-lib-state. aio-lib-state stores
 * only string values with a TTL, so metadata is carried inline in a small JSON
 * envelope and unwrapped transparently.
 */
import stateLib from '@adobe/aio-lib-state';

let _statePromise;
function getState() {
  // In a deployed action, init() auto-detects OpenWhisk namespace/auth from the
  // __OW_* env vars. Locally, scripts/local.mjs feeds those from .env.
  if (!_statePromise) _statePromise = stateLib.init();
  return _statePromise;
}

const WRAP_MARKER = '__kv_meta__';

function ttlFrom(options) {
  if (options.ttl) return options.ttl;
  if (options.expirationTtl) return options.expirationTtl; // CF: seconds from now
  if (options.expiration) return options.expiration - Math.floor(Date.now() / 1000); // CF: absolute epoch
  return undefined;
}

async function readRaw(key) {
  const state = await getState();
  const res = await state.get(key);
  const v = res?.value;
  return v === undefined ? null : v;
}

/** Returns an object with Cloudflare-KV-compatible methods. */
export function kvBinding() {
  return {
    async get(key, type) {
      const raw = await readRaw(key);
      if (raw === null) return null;
      let value = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed[WRAP_MARKER]) value = parsed.value;
      } catch { /* plain string */ }
      return type === 'json' ? JSON.parse(value) : value;
    },

    async getWithMetadata(key) {
      const raw = await readRaw(key);
      if (raw === null) return { value: null, metadata: null };
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed[WRAP_MARKER]) {
          return { value: parsed.value, metadata: parsed.metadata ?? null };
        }
      } catch { /* plain string */ }
      return { value: raw, metadata: null };
    },

    async put(key, value, options = {}) {
      const state = await getState();
      const ttl = ttlFrom(options);
      const stored =
        options.metadata !== undefined
          ? JSON.stringify({ [WRAP_MARKER]: 1, value: String(value), metadata: options.metadata })
          : String(value);
      await state.put(key, stored, ttl && ttl > 0 ? { ttl } : undefined);
    },

    async delete(key) {
      const state = await getState();
      await state.delete(key);
    },
  };
}
