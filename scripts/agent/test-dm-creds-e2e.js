/**
 * Standalone live probe: fires the exact folder-create request the AEM Assets UI sends
 * (captured HAR shape), authenticated ONLY via SPARK_DM_CLIENT_ID / SPARK_DM_CLIENT_SECRET
 * (client_credentials grant, x-api-key = SPARK_DM_CLIENT_ID). No pre-issued
 * AUTHOR_SPARK_IMS_TOKEN is used. Prints the real HTTP status/body — this is meant to give
 * a live yes/no on whether this DM technical account is allowlisted for the author API on
 * this env (PLAN.md §4.2 W1 documents this pairing as failing with 403 "IMS Client ID not
 * allowlisted"), not to assume the outcome.
 *
 * Usage:
 *   node scripts/agent/test-dm-creds-e2e.js --customer-key <key> [--aem-env-id pNNN-eNNN]
 *
 * Requires SPARK_DM_CLIENT_ID / SPARK_DM_CLIENT_SECRET in env, cloudflare/.secrets, or
 * secret.env (same resolution as enrich-assets.js).
 */

import { randomUUID } from 'node:crypto';
import { resolveCreds, resolveAemEnvId, parseArgs } from './config.js';
import { IMS_TOKEN_URL, buildAuthorHost } from './constants.js';

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// Scope decoded off the working pre-issued AUTHOR_SPARK_IMS_TOKEN JWT (not the broader
// AEM-as-a-Cloud-Service scope set in constants.js IMS_SCOPE) — requested here to test
// whether the DM technical account behaves differently against the author API with this
// narrower, session-shaped scope.
const PROBE_SCOPE = [
  'additional_info.ownerOrg',
  'additional_info.projectedProductContext',
  'AdobeID',
  'openid',
  'session',
  'read_organizations',
  'ab.manage',
  'org.read',
  'aem.adobe.experimental',
].join(',');

/**
 * client_credentials grant with an explicit scope override
 * (mirrors ims-auth.js createImsToken).
 */
async function createImsTokenWithScope({ clientId, clientSecret, scope }) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IMS token grant failed: ${res.status} ${text}`.trim());
  }
  const json = await res.json();
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.customerKey) {
    console.error('Usage: node scripts/agent/test-dm-creds-e2e.js --customer-key <key> [--aem-env-id pNNN-eNNN]');
    process.exit(2);
  }

  const aemEnvId = resolveAemEnvId({ aemEnvId: options.aemEnvId });
  const creds = resolveCreds({ secretsFile: options.secretsFile });
  const folderName = options.customerKey;

  console.log(`[probe] customerKey=${options.customerKey} folderName=${folderName} aemEnvId=${aemEnvId}`);
  console.log(`[probe] using SPARK_DM_CLIENT_ID from ${creds.source} (client_credentials grant)`);

  // --- Stage 1: IMS client_credentials grant ---
  section('1. IMS client_credentials grant');
  let accessToken;
  try {
    ({ accessToken } = await createImsTokenWithScope({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      scope: PROBE_SCOPE,
    }));
    console.log(`[probe] OK — token acquired (len=${accessToken.length})`);
    console.log(`[probe] TOKEN: ${accessToken}`);
  } catch (err) {
    console.error(`[probe] FAILED — ${err.message}`);
    process.exit(1);
  }

  // --- Stage 2: folder creation, exact AEM Assets UI request shape ---
  section('2. Folder creation (POST /adobe/repository .../;api=create)');
  const respondWith = encodeURIComponent(JSON.stringify({
    reltype: 'http://ns.adobe.com/adobecloud/rel/metadata/repository',
  }));
  const t = Date.now();
  const url = `${buildAuthorHost(aemEnvId)}/adobe/repository/content/dam;api=create;t=${t};path=${encodeURIComponent(folderName)};intermediates=true;respondWith=${respondWith}`;

  const headers = {
    accept: '*/*',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    authorization: `Bearer ${accessToken}`,
    'content-length': '0',
    'content-type': 'application/vnd.adobecloud.directory+json',
    origin: 'https://experience.adobe.com',
    referer: 'https://experience.adobe.com/',
    'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'x-aem-affinity-type': 'api',
    'x-api-key': creds.clientId,
    'x-request-id': randomUUID(),
  };

  if (process.env.AGENT_DEBUG) {
    const curlHeaders = Object.entries(headers).map(([k, v]) => `--header '${k}: ${v}'`).join(' \\\n  ');
    console.error(`[probe:curl] curl --location --request POST '${url}' \\\n  ${curlHeaders}`);
  }

  try {
    const res = await fetch(url, { method: 'POST', headers });
    const body = await res.text().catch(() => '');
    console.log(`[probe] status=${res.status} ${res.statusText || ''}`.trim());
    if (body) console.log(`[probe] body: ${body}`);
    if (res.ok) {
      console.log(`[probe] OK — folder created (or already existed) at /content/dam/${folderName}`);
    } else if (res.status === 403 && /not allowlisted/i.test(body)) {
      console.error('[probe] the DM client ID is NOT allowlisted for the author API on this env (PLAN.md §4.2 W1).');
    }
  } catch (err) {
    console.error(`[probe] FAILED — ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[probe] fatal: ${err.stack || err.message}`);
  process.exit(1);
});
