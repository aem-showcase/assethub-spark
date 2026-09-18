#!/usr/bin/env node
/**
 * publish-page.js — move a Document Authoring page between disk, DA, and the live site.
 *
 * WHY THIS EXISTS
 * Authoring the landing page is five steps, and until this script only one of them had a
 * runnable entrypoint:
 *
 *   1. GET the current index.html from DA source      <- was unpackaged
 *   2. rewrite the carousel rows                      <- update-index-cards.js
 *   3. PUT the updated HTML back to DA source         <- was unpackaged
 *   4. POST admin.hlx.page/preview/...                <- was unpackaged
 *   5. POST admin.hlx.page/live/...                   <- was unpackaged
 *
 * An agent told to "use the packaged scripts" could therefore complete one step out of
 * five and had to hand-write the rest. Once it was already writing the GET, the PUT and
 * both publishes into one file, folding step 2 in (`import { updateIndexCards }`) was the
 * path of least resistance — which is exactly what a live run's /tmp/author-landing-cards.mjs
 * did, all five steps in a single throwaway script. Work done that way produces no report,
 * trips no gate, and is invisible to verification.
 *
 * SCOPE: this script publishes. It deliberately does NOT know how to build card rows —
 * that stays in update-index-cards.js. Keeping them apart is what stops the publish step
 * from quietly becoming a second, ungoverned content authoring path.
 *
 * usage:
 *   publish-page.js --org <org> --repo <repo> --path <da/path/without/extension> \
 *     [--pull <file>]      download DA source HTML to <file>
 *     [--push <file>]      upload <file> to DA source
 *     [--publish]          POST preview then live
 *     [--preview-only]     POST preview but not live
 *     [--da-token-file <f>] defaults to <repoRoot>/token.env
 *     [--dry-run]          print what would happen; no writes
 *
 * typical flow (three commands, no hand-written script):
 *   publish-page.js --path companies/acme/en/index --pull /tmp/index.html
 *   update-index-cards.js --index-file /tmp/index.html --report-file .internal/acme-assets-report.json
 *   publish-page.js --path companies/acme/en/index --push /tmp/index.html --publish
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveDaToken } from './config.js';

const DA_ADMIN_BASE = process.env.DA_ADMIN_BASE || 'https://admin.da.live';
const HLX_ADMIN_BASE = process.env.HLX_ADMIN_BASE || 'https://admin.hlx.page';

/** DA source paths carry no leading slash and no extension in the CLI form. */
export function normalizeDaPath(path) {
  return String(path || '').trim().replace(/^\/+/, '').replace(/\.html$/i, '');
}

export function sourceUrl({ org, repo, path }) {
  return `${DA_ADMIN_BASE}/source/${org}/${repo}/${normalizeDaPath(path)}.html`;
}

export function adminUrl({
  org, repo, path, stage, branch = 'main',
}) {
  return `${HLX_ADMIN_BASE}/${stage}/${org}/${repo}/${branch}/${normalizeDaPath(path)}`;
}

/** Download the current DA source HTML for a page. */
export async function pullPage({
  org, repo, path, daToken, fetchFn = fetch,
}) {
  const url = sourceUrl({ org, repo, path });
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${daToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} -> ${res.status} ${text}`.trim());
  }
  return res.text();
}

/** Upload HTML to DA source, as the multipart form DA's source API expects. */
export async function pushPage({
  org, repo, path, html, daToken, fetchFn = fetch,
}) {
  const url = sourceUrl({ org, repo, path });
  const form = new FormData();
  form.append('data', new Blob([html], { type: 'text/html' }), 'index.html');
  const res = await fetchFn(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${daToken}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${url} -> ${res.status} ${text}`.trim());
  }
  return url;
}

/**
 * POST one publish stage. Helix accepts the DA token either as a normal bearer or as
 * x-content-source-authorization depending on how the site is wired, so try both before
 * failing — a live run discovered this the hard way and hard-coded the retry in a
 * throwaway script.
 */
export async function publishStage({
  org, repo, path, stage, branch = 'main', daToken, fetchFn = fetch,
}) {
  const url = adminUrl({
    org, repo, path, stage, branch,
  });
  let res = await fetchFn(url, { method: 'POST', headers: { Authorization: `Bearer ${daToken}` } });
  if (!res.ok) {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'x-content-source-authorization': `Bearer ${daToken}` },
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${stage} ${url} -> ${res.status} ${text}`.trim());
  }
  return { stage, status: res.status, url };
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (eq === -1) {
      if (value === undefined || value.startsWith('--')) value = true;
      else i += 1;
    }
    opts[key] = value;
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const read = io.readFile || ((p) => readFileSync(p, 'utf8'));
  const write = io.writeFile || ((p, c) => writeFileSync(p, c));
  const log = io.log || console;
  const fetchFn = io.fetchFn || fetch;
  const opts = parseCliArgs(argv);

  const org = typeof opts.org === 'string' ? opts.org : 'aem-showcase';
  const repo = typeof opts.repo === 'string' ? opts.repo : 'assethub-spark';
  const branch = typeof opts.branch === 'string' ? opts.branch : 'main';
  const path = typeof opts.path === 'string' ? opts.path : null;
  const pull = typeof opts.pull === 'string' ? opts.pull : null;
  const push = typeof opts.push === 'string' ? opts.push : null;
  const dryRun = opts['dry-run'] === true;
  const previewOnly = opts['preview-only'] === true;
  const doPublish = opts.publish === true || previewOnly;

  if (!path) {
    throw new Error(
      'usage: publish-page.js --path <da/path> [--pull <file>] [--push <file>] '
      + '[--publish|--preview-only] [--org <org>] [--repo <repo>] [--dry-run]',
    );
  }
  if (!pull && !push && !doPublish) {
    throw new Error('nothing to do: pass at least one of --pull, --push, --publish');
  }

  const daToken = io.daToken || resolveDaToken({
    daTokenFile: typeof opts['da-token-file'] === 'string' ? opts['da-token-file'] : undefined,
  });
  if (!daToken && !dryRun) {
    throw new Error('no DA token found (expected DA_TOKEN in <repoRoot>/token.env or --da-token-file)');
  }

  const results = { path: normalizeDaPath(path), stages: [] };

  if (pull) {
    if (dryRun) {
      log.info?.(`[agent] dry-run: would GET ${sourceUrl({ org, repo, path })} -> ${pull}`);
    } else {
      const html = await pullPage({
        org, repo, path, daToken, fetchFn,
      });
      write(pull, html);
      log.info?.(`[agent] pulled ${results.path} (${html.length} bytes) -> ${pull}`);
      results.pulled = pull;
    }
  }

  if (push) {
    const html = read(push);
    if (dryRun) {
      log.info?.(`[agent] dry-run: would PUT ${push} (${html.length} bytes) -> ${sourceUrl({ org, repo, path })}`);
    } else {
      await pushPage({
        org, repo, path, html, daToken, fetchFn,
      });
      log.info?.(`[agent] pushed ${push} (${html.length} bytes) -> ${results.path}`);
      results.pushed = push;
    }
  }

  if (doPublish) {
    // preview always precedes live: the ceiling check reads the PREVIEWED page, so a
    // live publish that skipped preview would have nothing to verify against.
    const stages = previewOnly ? ['preview'] : ['preview', 'live'];
    for (const stage of stages) {
      if (dryRun) {
        log.info?.(`[agent] dry-run: would POST ${adminUrl({
          org, repo, path, stage, branch,
        })}`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await publishStage({
        org, repo, path, stage, branch, daToken, fetchFn,
      });
      log.info?.(`[agent] ${stage} -> ${out.status}`);
      results.stages.push(out);
    }
  }

  return results;
}

/* c8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[agent] publish-page failed: ${err.message || err}`);
    process.exit(1);
  });
}
/* c8 ignore stop */
