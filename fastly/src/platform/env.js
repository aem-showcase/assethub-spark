// Platform seam #1 (Fastly-specific): build a Cloudflare-worker-style `env` object
// from Fastly's stores, so the shared business logic keeps using env.X unchanged
// (e.g. `env.HELIX_ORIGIN`, `await env.COOKIE_SECRET.get()`). This file + backends.js
// are the ONLY Fastly-aware modules — replace them and the same logic runs on
// Cloudflare (where `env` is supplied by the runtime).
import { ConfigStore } from 'fastly:config-store';
import { SecretStore } from 'fastly:secret-store';
import { KVStore } from 'fastly:kv-store';
import { env as fastlyEnv } from 'fastly:env';

function tryOpen(factory) {
  try {
    return factory();
  } catch {
    return null; // store not configured in this environment (e.g. local, or 1a with no DB)
  }
}

// Secret Store binding shim: Cloudflare code calls `await env.SECRET.get()`.
// Resolves to undefined if the store or key is absent (never throws) so a missing
// secret degrades gracefully instead of 500-ing the request.
function secretBinding(storeName, key) {
  return {
    async get() {
      try {
        const store = new SecretStore(storeName);
        const entry = await store.get(key);
        return entry ? entry.plaintext() : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

// KV Store binding shim — subset the app uses (get/getWithMetadata/put/delete/list).
// Fastly KV has no separate metadata param like Cloudflare KV, so values are stored as a
// JSON envelope {value, metadata}. Degrades to null/no-op if the store isn't configured
// (e.g. locally without a declared KV store — IMS token caching simply won't persist).
function kvBinding(storeName) {
  const open = () => {
    try {
      return new KVStore(storeName);
    } catch {
      return null;
    }
  };
  return {
    async get(key, opts) {
      const s = open();
      if (!s) return null;
      const e = await s.get(key);
      if (!e) return null;
      let env;
      try {
        env = JSON.parse(await e.text());
      } catch {
        return null;
      }
      const v = env?.value ?? null;
      return opts && opts.type === 'json' && typeof v === 'string' ? JSON.parse(v) : v;
    },
    async getWithMetadata(key) {
      const s = open();
      if (!s) return { value: null, metadata: null };
      const e = await s.get(key);
      if (!e) return { value: null, metadata: null };
      try {
        const env = JSON.parse(await e.text());
        return { value: env?.value ?? null, metadata: env?.metadata ?? null };
      } catch {
        return { value: null, metadata: null };
      }
    },
    async put(key, value, opts) {
      const s = open();
      if (!s) return;
      await s.put(key, JSON.stringify({ value, metadata: opts?.metadata ?? null }));
    },
    async delete(key) {
      const s = open();
      if (s) await s.delete(key);
    },
    async list() {
      // Notifications (MESSAGES) uses list({prefix}); wired in a later step.
      return { keys: [] };
    },
  };
}

// Construct the env object once per request.
export function buildEnv() {
  const config = tryOpen(() => new ConfigStore('config'));
  const cfg = (k) => (config ? config.get(k) : undefined);
  return {
    // Plain vars (Config Store)
    HELIX_ORIGIN: cfg('HELIX_ORIGIN'),
    DISABLE_AUTHENTICATION: cfg('DISABLE_AUTHENTICATION'),
    DEBUG_ANALYTICS: cfg('DEBUG_ANALYTICS'),
    // Secrets (Secret Store) — resolve to undefined until the store is configured
    COOKIE_SECRET: secretBinding('secrets', 'COOKIE_SECRET'),
    HELIX_ORIGIN_AUTHENTICATION: secretBinding('secrets', 'HELIX_ORIGIN_AUTHENTICATION'),
    DM_CLIENT_ID: secretBinding('secrets', 'DM_CLIENT_ID'),
    DM_CLIENT_SECRET: secretBinding('secrets', 'DM_CLIENT_SECRET'),
    // KV bindings
    AUTH_TOKENS: kvBinding('auth_tokens'),
    MESSAGES: kvBinding('messages'),
    FASTLY_SERVICE_VERSION: fastlyEnv('FASTLY_SERVICE_VERSION') || 'local',
  };
}
