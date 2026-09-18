/**
 * Controller for the collections step (Step 6 of rebrand-portal).
 *
 * Runs AFTER enrichment (Step 5): once the company's assets are searchable, this queries
 * them via the DM asset search and builds one company-scoped collection per distinct facet
 * value (default productCategory). Every collection is stamped custom:metadata.company =
 * <companyKey> so the worker's collections company filter can hide/show it per DEMO_COMPANY.
 *
 * Reuses the existing environment exactly like the worker: DM technical-account creds
 * from cloudflare/.secrets and the AEM env id from cloudflare/src/config.js. No new
 * collection credential; the client mirrors the worker's deterministic path-based
 * x-api-key selection. No author writes (collections live on the delivery / Content Hub tier).
 *
 * Dependency-injected (`client`, `log`) so the flow is testable offline; the CLI bootstrap
 * at the bottom wires the real DmCollectionsClient.
 */

import { pathToFileURL } from 'node:url';
import { writeFileSync, readFileSync } from 'node:fs';

import { ImsTokenProvider } from './ims-auth.js';
import { DmCollectionsClient } from './dm-collections-client.js';
import { planCollections, GROUP_FACETS } from './collections-plan.js';
import {
  ASSET_VISIBILITY_POLL_INTERVAL_MS,
  ASSET_VISIBILITY_POLL_TIMEOUT_MS,
  buildDeliveryHost,
} from './constants.js';
import {
  slugify, RESERVED_CUSTOMER_KEYS, resolveCreds, resolveAemEnvId,
} from './config.js';

const FLAGS_WITH_VALUE = new Set([
  'customer-key', 'group-by', 'limit', 'min-assets', 'secrets-file',
  'aem-env-id', 'report-file', 'fixture', 'access-level', 'display-name',
  'category-labels', 'visibility-timeout-ms', 'visibility-poll-interval-ms',
]);
const BOOLEAN_FLAGS = new Set(['dry-run', 'force']);

/** Parse argv into a normalized options object. */
export function parseArgs(argv) {
  const opts = {
    customerKey: null,
    groupBy: 'productCategory',
    limit: 200,
    minAssets: 1,
    accessLevel: 'public',
    dryRun: false,
    force: false,
    secretsFile: null,
    aemEnvId: null,
    reportFile: null,
    fixture: null,
    displayName: null,
    categoryLabels: null,
    visibilityTimeoutMs: ASSET_VISIBILITY_POLL_TIMEOUT_MS,
    visibilityPollIntervalMs: ASSET_VISIBILITY_POLL_INTERVAL_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === 'dry-run') opts.dryRun = true;
      else if (name === 'force') opts.force = true;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(name)) {
      const value = argv[i + 1];
      i += 1;
      switch (name) {
        case 'customer-key': opts.customerKey = slugify(value); break;
        case 'group-by': opts.groupBy = value; break;
        case 'limit': opts.limit = Number(value); break;
        case 'min-assets': opts.minAssets = Number(value); break;
        case 'access-level': opts.accessLevel = value; break;
        case 'secrets-file': opts.secretsFile = value; break;
        case 'aem-env-id': opts.aemEnvId = value; break;
        case 'report-file': opts.reportFile = value; break;
        case 'fixture': opts.fixture = value; break;
        case 'display-name': opts.displayName = value; break;
        case 'category-labels':
          // JSON slug->label map, e.g. '{"iphone":"iPhone","ipad":"iPad"}'. Lets the
          // source-derived contract's proper-noun casing (iPhone/iPad/AirPods) flow into
          // collection titles instead of the title-cased default (Iphone/Ipad/Airpods).
          try { opts.categoryLabels = JSON.parse(value); } catch { opts.categoryLabels = null; }
          break;
        case 'visibility-timeout-ms': opts.visibilityTimeoutMs = Number(value); break;
        case 'visibility-poll-interval-ms': opts.visibilityPollIntervalMs = Number(value); break;
        default: break;
      }
    }
  }
  return opts;
}

export function validateOptions(opts) {
  const errors = [];
  if (!opts.customerKey) errors.push('--customer-key is required');
  if (opts.customerKey && RESERVED_CUSTOMER_KEYS.has(opts.customerKey)) {
    errors.push(`--customer-key "${opts.customerKey}" is reserved; use a real company key`);
  }
  if (!GROUP_FACETS.includes(opts.groupBy)) {
    errors.push(`--group-by must be one of ${GROUP_FACETS.join('|')} (got ${opts.groupBy})`);
  }
  if (!['public', 'public-view', 'private'].includes(opts.accessLevel)) {
    errors.push(`--access-level must be public|public-view|private (got ${opts.accessLevel})`);
  }
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
    errors.push(`--limit must be a positive number (got ${opts.limit})`);
  }
  if (!Number.isFinite(opts.minAssets) || opts.minAssets < 1) {
    errors.push(`--min-assets must be >= 1 (got ${opts.minAssets})`);
  }
  if (!Number.isFinite(opts.visibilityTimeoutMs) || opts.visibilityTimeoutMs < 0) {
    errors.push(`--visibility-timeout-ms must be >= 0 (got ${opts.visibilityTimeoutMs})`);
  }
  if (!Number.isFinite(opts.visibilityPollIntervalMs) || opts.visibilityPollIntervalMs <= 0) {
    errors.push(`--visibility-poll-interval-ms must be > 0 (got ${opts.visibilityPollIntervalMs})`);
  }
  return errors;
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function summarizeSearchVisibility(assets, {
  groupBy = 'productCategory',
  minAssets = 1,
  expectedFacetValues = [],
} = {}) {
  const counts = new Map();
  (assets || []).forEach((asset) => {
    const value = asset?.[groupBy];
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  const expected = (expectedFacetValues || []).filter(Boolean);
  const missingFacetValues = expected
    .filter((value) => (counts.get(value) || 0) < minAssets);
  const ready = (assets || []).length > 0
    && (expected.length === 0 || missingFacetValues.length === 0);
  return {
    ready,
    assetsFound: (assets || []).length,
    facetCounts: Object.fromEntries(counts),
    missingFacetValues,
  };
}

export async function waitForSearchableAssets({
  searchFn,
  company,
  limit,
  groupBy = 'productCategory',
  minAssets = 1,
  expectedFacetValues = [],
  timeoutMs = ASSET_VISIBILITY_POLL_TIMEOUT_MS,
  intervalMs = ASSET_VISIBILITY_POLL_INTERVAL_MS,
  sleepFn = defaultSleep,
  now = Date.now,
  log = console,
}) {
  if (!searchFn) throw new Error('waitForSearchableAssets: searchFn is required');
  const startedAt = now();
  let attempts = 0;
  let assets = [];
  let visibility = summarizeSearchVisibility(assets, { groupBy, minAssets, expectedFacetValues });
  let elapsedMs = 0;

  do {
    attempts += 1;
    assets = await searchFn({ company, limit });
    visibility = summarizeSearchVisibility(assets, { groupBy, minAssets, expectedFacetValues });
    if (visibility.ready) {
      return {
        assets,
        timedOut: false,
        attempts,
        elapsedMs: Math.max(0, now() - startedAt),
        visibility,
      };
    }

    elapsedMs = Math.max(0, now() - startedAt);
    if (timeoutMs === 0 || elapsedMs >= timeoutMs) {
      return {
        assets,
        timedOut: true,
        attempts,
        elapsedMs,
        visibility,
      };
    }

    log.warn?.(
      '[collections] waiting for enriched assets to become searchable '
      + `(${visibility.assetsFound} visible; missing facets: `
      + `${visibility.missingFacetValues.join(', ') || 'none specified'})`,
    );
    await sleepFn(Math.min(intervalMs, timeoutMs - elapsedMs));
  } while (elapsedMs < timeoutMs);
  return {
    assets,
    timedOut: true,
    attempts,
    elapsedMs: Math.max(0, now() - startedAt),
    visibility,
  };
}

/**
 * Core flow. `client` must implement searchCompanyAssets + createCollection.
 * Returns a report object; never calls process.exit (the CLI bootstrap does).
 */
export async function createCollectionsRun({
  options,
  client,
  assets: seededAssets = null,
  log = console,
  sleepFn = defaultSleep,
  now = Date.now,
}) {
  const {
    customerKey, groupBy, limit, minAssets, accessLevel, dryRun, displayName, categoryLabels,
    visibilityTimeoutMs, visibilityPollIntervalMs,
  } = options;

  if (!seededAssets && typeof client?.searchCompanyCollections === 'function') {
    const existingCollections = await client.searchCompanyCollections({
      company: customerKey,
      limit,
    });
    if (existingCollections.length > 0) {
      const report = {
        company: customerKey,
        groupBy,
        dryRun: Boolean(dryRun),
        assetsFound: 0,
        collections: existingCollections.map((collection) => ({
          title: collection.title,
          collectionId: collection.collectionId,
          company: collection.company || customerKey,
          itemCount: collection.itemCount,
          status: 'exists',
        })),
        existing: existingCollections.length,
        created: 0,
        skipped: existingCollections.length,
        failed: 0,
        visibility: {
          ready: true,
          assetsFound: 0,
          facetCounts: {},
          missingFacetValues: [],
          skippedReason: 'same-company-collections-exist',
        },
        visibilityAttempts: 0,
        visibilityElapsedMs: 0,
      };
      log.warn(
        `[collections] ${existingCollections.length} collection(s) already exist for company "${customerKey}"; `
        + 'no collection changes needed.',
      );
      existingCollections.forEach((collection) => {
        log.warn(`[collections] exists "${collection.title}"${collection.collectionId ? ` id=${collection.collectionId}` : ''}`);
      });
      return { report };
    }
  }

  const expectedFacetValues = groupBy === 'productCategory' && categoryLabels
    ? Object.keys(categoryLabels)
    : [];
  const visibilityResult = seededAssets
    ? {
      assets: seededAssets,
      timedOut: false,
      attempts: 0,
      elapsedMs: 0,
      visibility: summarizeSearchVisibility(seededAssets, {
        groupBy,
        minAssets,
        expectedFacetValues,
      }),
    }
    : await waitForSearchableAssets({
      searchFn: (args) => client.searchCompanyAssets(args),
      company: customerKey,
      limit,
      groupBy,
      minAssets,
      expectedFacetValues,
      timeoutMs: visibilityTimeoutMs,
      intervalMs: visibilityPollIntervalMs,
      sleepFn,
      now,
      log,
    });
  const { assets } = visibilityResult;

  const report = {
    company: customerKey,
    groupBy,
    dryRun: Boolean(dryRun),
    assetsFound: assets.length,
    collections: [],
    created: 0,
    skipped: 0,
    failed: 0,
    visibility: visibilityResult.visibility,
    visibilityAttempts: visibilityResult.attempts,
    visibilityElapsedMs: visibilityResult.elapsedMs,
  };

  if (visibilityResult.timedOut) {
    log.error(
      `[collections] assets for company "${customerKey}" did not become searchable before `
      + `${visibilityTimeoutMs}ms. Stop here: leave assets-enriched/search-scoped/`
      + 'collections-created pending or blocked, then resume after indexing catches up.',
    );
    report.error = 'visibility-timeout';
    return { report };
  }

  if (assets.length === 0) {
    log.error(
      `[collections] no searchable assets found for company "${customerKey}". `
      + 'Run enrichment (Step 5, .claude/skills/rebrand-portal/scripts/assets/enrich-assets.js) and confirm assets are '
      + 'searchable before creating collections.',
    );
    report.error = 'no-assets';
    return { report };
  }

  const specs = planCollections(assets, {
    company: customerKey,
    facet: groupBy,
    minAssets,
    titlePrefix: displayName || undefined,
    labels: categoryLabels || undefined,
  });

  if (specs.length === 0) {
    log.warn(
      `[collections] found ${assets.length} assets but none carry a "${groupBy}" value `
      + `(or every group had < ${minAssets}); nothing to group into collections.`,
    );
    report.error = 'no-groups';
    return { report };
  }

  for (const spec of specs) {
    const entry = {
      title: spec.title,
      facetValue: spec.facetValue,
      assetCount: spec.assetIds.length,
      status: 'planned',
    };
    if (dryRun) {
      log.warn(
        `[collections] (dry-run) would create "${spec.title}" `
        + `[${groupBy}=${spec.facetValue}] with ${spec.assetIds.length} assets`,
      );
      report.collections.push(entry);
      continue;
    }
    try {
      const created = await client.createCollection({
        title: spec.title,
        description: `${spec.assetIds.length} ${spec.facetValue} assets for ${customerKey}.`,
        company: customerKey,
        assetIds: spec.assetIds,
        accessLevel,
      });
      entry.status = 'created';
      entry.collectionId = created?.collectionId || created?.id || null;
      report.created += 1;
      log.warn(
        `[collections] created "${spec.title}" (${spec.assetIds.length} assets)`
        + `${entry.collectionId ? ` id=${entry.collectionId}` : ''}`,
      );
    } catch (err) {
      entry.status = 'failed';
      entry.error = err?.message || String(err);
      report.failed += 1;
      log.error(`[collections] FAILED "${spec.title}": ${entry.error}`);
    }
    report.collections.push(entry);
  }

  return { report };
}

/** CLI bootstrap. */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const errors = validateOptions(options);
  if (errors.length > 0) {
    console.error(`Invalid arguments:\n  - ${errors.join('\n  - ')}`);
    process.exit(2);
  }

  let client = null;
  let seededAssets = null;

  if (options.fixture) {
    // Offline preview: assets come from a JSON file; force dry-run (no creation).
    seededAssets = JSON.parse(readFileSync(options.fixture, 'utf8'));
    if (!options.dryRun) {
      console.warn('[collections] --fixture is offline-only; forcing --dry-run.');
      options.dryRun = true;
    }
  } else {
    let creds;
    try {
      creds = resolveCreds({ secretsFile: options.secretsFile });
    } catch (err) {
      console.error(`[collections] ${err.message}`);
      process.exit(2);
      return;
    }
    const aemEnvId = resolveAemEnvId({ aemEnvId: options.aemEnvId });
    const tokenProvider = new ImsTokenProvider({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    client = new DmCollectionsClient({
      tokenProvider,
      clientId: creds.clientId,
      deliveryHost: buildDeliveryHost(aemEnvId),
    });
    console.warn(`[collections] using DM creds from ${creds.source}`);
    console.warn(`[collections] targeting delivery env ${aemEnvId}`);
  }

  const { report } = await createCollectionsRun({ options, client, assets: seededAssets });

  if (options.reportFile) {
    writeFileSync(options.reportFile, JSON.stringify(report, null, 2));
  }

  console.log(
    `[collections] done: assets=${report.assetsFound} `
    + `planned=${report.collections.length} created=${report.created} failed=${report.failed}`
    + `${report.dryRun ? ' (dry-run)' : ''}`,
  );
  process.exit(report.failed > 0 || report.error ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[collections] fatal: ${err?.stack || err?.message || err}`);
    process.exit(1);
  });
}
