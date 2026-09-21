/**
 * CLI config: argument parsing, customerKey -> paths, and credential resolution
 *. No new secret is introduced — the DM technical-account
 * creds collected in migration Phase B.7 (cloudflare/.secrets) are read at call time.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FLAG_WITH_VALUE = new Set([
  'customer-key', 'dam-path', 'source-url', 'source-urls', 'secrets-file', 'limit',
  'concurrency', 'report-file', 'fixture', 'aem-env-id', 'categories', 'category-map',
  'org', 'repo', 'da-token-file', 'cookie', 'header', 'hero-map', 'rendered-html',
]);

const BOOLEAN_FLAGS = new Set(['dry-run', 'force', 'bring-in']);

export const RESERVED_CUSTOMER_KEYS = new Set([
  'api',
  'auth',
  'blocks',
  'companies',
  'config',
  'en',
  'fonts',
  'icons',
  'ja',
  'login',
  'media',
  'public',
  'scripts',
  'styles',
  'tools',
]);

/** Slugify a customer/brand name into a folder-safe key (e.g. "Santander AG" -> santander-ag). */
export function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse a dotenv-style file into a plain object. */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve DM client credentials. Order: explicit env (SPARK_DM_CLIENT_ID/SECRET) ->
 * cloudflare/.secrets (SPARK_DM_CLIENT_ID/SECRET) -> root secret.env
 * (SPARK_DM_CLIENT_ID/SECRET). Throws with guidance when none are found.
 */
export function resolveCreds({ secretsFile, repoRoot = process.cwd(), env = process.env } = {}) {
  if (env.SPARK_DM_CLIENT_ID && env.SPARK_DM_CLIENT_SECRET) {
    return { clientId: env.SPARK_DM_CLIENT_ID, clientSecret: env.SPARK_DM_CLIENT_SECRET, source: 'env' };
  }

  const candidates = [
    { file: secretsFile || resolve(repoRoot, 'cloudflare/.secrets'), id: 'SPARK_DM_CLIENT_ID', secret: 'SPARK_DM_CLIENT_SECRET' },
    { file: resolve(repoRoot, 'secret.env'), id: 'SPARK_DM_CLIENT_ID', secret: 'SPARK_DM_CLIENT_SECRET' },
  ];

  for (const c of candidates) {
    if (!existsSync(c.file)) continue;
    const parsed = parseEnvFile(readFileSync(c.file, 'utf8'));
    if (parsed[c.id] && parsed[c.secret]) {
      return { clientId: parsed[c.id], clientSecret: parsed[c.secret], source: c.file };
    }
  }

  throw new Error(
    'No DM credentials found. Set SPARK_DM_CLIENT_ID/SPARK_DM_CLIENT_SECRET, or provide '
    + 'SPARK_DM_CLIENT_ID/SECRET in cloudflare/.secrets (migration Phase B.7).',
  );
}

/**
 * Resolve the AEM environment id (pNNN-eNNN), used to build the author host
 * (author-<aemEnvId>.adobeaemcloud.com). Order: explicit opt -> env AEM_ENV_ID ->
 * cloudflare/src/config.js (the worker's own AEM_ENV_ID). Throws when none resolve.
 */
export function resolveAemEnvId({ aemEnvId, repoRoot = process.cwd(), env = process.env } = {}) {
  const fromOpt = aemEnvId || env.AEM_ENV_ID || null;
  if (fromOpt) return fromOpt;

  const configFile = resolve(repoRoot, 'cloudflare/src/config.js');
  if (existsSync(configFile)) {
    const text = readFileSync(configFile, 'utf8');
    const m = text.match(/AEM_ENV_ID:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  }

  throw new Error(
    'No AEM environment id found. Pass --aem-env-id pNNN-eNNN, set AEM_ENV_ID, '
    + 'or run from a repo whose cloudflare/src/config.js defines AEM_ENV_ID.',
  );
}

/**
 * Parse argv (process.argv.slice(2)) into a normalized options object.
 */
export function parseArgs(argv) {
  const opts = {
    dryRun: false,
    force: false,
    bringIn: false,
    concurrency: 4,
    limit: null,
    sourceUrl: null,
    // Additional bring-in source pages (comma/space list). Combined with sourceUrl and
    // deduped by resolveSourceUrls() so one run scrapes every per-category page at once,
    // instead of the agent serially re-invoking the script once per page.
    sourceUrls: null,
    reportFile: null,
    customerKey: null,
    damPath: null,
    secretsFile: null,
    fixture: null,
    aemEnvId: null,
    // Source-derived category contract (Step 4). Comma-separated slugs on the CLI, e.g.
    // --categories dermatology,cancer,diabetes,obesity,alzheimers. normalizeContract() in
    // enrich-assets.js parses this into [{slug,label}].
    categoryContract: null,
    // Path to the agent's category map: JSON object of `fileName|assetId -> slug`, written from
    // the dry-run evidence. buildMapClassifier() turns it into the injected classifier so each
    // asset gets the agent's stated category verbatim. Assets absent from the map round-robin
    // into the contract. Reproducible: same map file -> same assignment.
    categoryMap: null,
    // DA org/repo (same as the GitHub org/repo — resolved by the calling flow from the git
    // remote, same as scripts/da/copy-folder.sh's <org> <repo> args) and the token file
    // (default token.env at repo root) — needed to upload representative card images to DA
    // (see da-card-images.js). Card-image upload is skipped (not fatal) if these aren't set.
    org: null,
    repo: null,
    daTokenFile: null,
    // Source-fetch escapes. Some source sites sit behind a WAF/bot-manager (Akamai et al)
    // or require a session, and return 403/404 to a plain scripted GET while serving a
    // browser fine. --cookie sets the Cookie header and --header (repeatable,
    // "Name: value") sets any other request header on the SCRAPE fetches only; neither
    // touches AEM/DA calls. Without these the only way through is hand-rolled curl, which
    // moves the work off the supported path where the gates cannot see it.
    cookie: null,
    headers: [],
    // Per-category hero override: path to a JSON object of `slug -> fileName|assetId`,
    // used to pin the card hero when automatic ranking picks a logo or chrome image.
    heroMap: null,
    // Path to a saved rendered-HTML file to scrape instead of re-fetching pageUrl. For
    // client-rendered sources where the server HTML carries no <img> tags.
    renderedHtml: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === 'dry-run') opts.dryRun = true;
      else if (name === 'force') opts.force = true;
      else if (name === 'bring-in') opts.bringIn = true;
      continue;
    }
    if (FLAG_WITH_VALUE.has(name)) {
      const value = argv[i + 1];
      i += 1;
      switch (name) {
        case 'customer-key': opts.customerKey = slugify(value); break;
        case 'dam-path': opts.damPath = value; break;
        case 'source-url': opts.sourceUrl = value; break;
        case 'source-urls': opts.sourceUrls = value; break;
        case 'secrets-file': opts.secretsFile = value; break;
        case 'limit': opts.limit = Number(value); break;
        case 'concurrency': opts.concurrency = Number(value); break;
        case 'report-file': opts.reportFile = value; break;
        case 'fixture': opts.fixture = value; break;
        case 'aem-env-id': opts.aemEnvId = value; break;
        case 'categories': opts.categoryContract = value; break;
        case 'category-map': opts.categoryMap = value; break;
        case 'org': opts.org = value; break;
        case 'repo': opts.repo = value; break;
        case 'da-token-file': opts.daTokenFile = value; break;
        case 'cookie': opts.cookie = value; break;
        case 'header': if (value) opts.headers.push(value); break;
        case 'hero-map': opts.heroMap = value; break;
        case 'rendered-html': opts.renderedHtml = value; break;
        default: break;
      }
    }
  }

  if (opts.customerKey && !opts.damPath) {
    opts.damPath = `/content/dam/${opts.customerKey}`;
  }
  if (opts.sourceUrl || opts.sourceUrls) opts.bringIn = true;

  return opts;
}

/**
 * Read DA_TOKEN from a dotenv-style file (default token.env at repo root — the same file
 * Step 4a's ensure-eds-tokens.sh writes/verifies). Returns null (never throws) when absent
 * or empty — card-image upload is best-effort, not a hard requirement to enrich metadata.
 */
export function resolveDaToken({ daTokenFile, repoRoot = process.cwd() } = {}) {
  const file = daTokenFile || resolve(repoRoot, 'token.env');
  if (!existsSync(file)) return null;
  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  return parsed.DA_TOKEN || null;
}

/**
 * Turn `--cookie` / repeatable `--header "Name: value"` into a plain header object for
 * the scrape fetches. Later values win. Invalid entries (no colon) are reported by
 * validateOptions rather than silently dropped here.
 */
export function buildSourceHeaders({ cookie, headers } = {}) {
  const out = {};
  for (const raw of headers || []) {
    const idx = String(raw).indexOf(':');
    if (idx <= 0) continue;
    const name = String(raw).slice(0, idx).trim();
    const value = String(raw).slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  if (cookie) out.Cookie = cookie;
  return out;
}

export function validateOptions(opts) {
  const errors = [];
  if (!opts.customerKey) errors.push('--customer-key is required');
  if (opts.customerKey && RESERVED_CUSTOMER_KEYS.has(opts.customerKey)) {
    errors.push(`--customer-key "${opts.customerKey}" is reserved; use a real company key`);
  }
  if (opts.damPath && opts.customerKey) {
    const expected = `/content/dam/${opts.customerKey}`;
    if (opts.damPath !== expected && !opts.damPath.startsWith(`${expected}/`)) {
      errors.push(`--dam-path must stay under ${expected} (got ${opts.damPath})`);
    }
  }
  for (const raw of opts.headers || []) {
    if (String(raw).indexOf(':') <= 0) {
      errors.push(`--header "${raw}" must be "Name: value"`);
    }
  }
  if (opts.renderedHtml && !existsSync(opts.renderedHtml)) {
    errors.push(`--rendered-html file not found: ${opts.renderedHtml}`);
  }
  if (opts.heroMap && !existsSync(opts.heroMap)) {
    errors.push(`--hero-map file not found: ${opts.heroMap}`);
  }
  return errors;
}
