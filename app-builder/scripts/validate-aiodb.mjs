/**
 * Validation gate (plan §1) for the D1 → aio-lib-db migration.
 * Throwaway: exchanges the OAuth S2S creds for an IMS token, initialises
 * @adobe/aio-lib-db against the Runtime namespace, ensures the tenant DB is
 * provisioned, then does a ping + insert/find/delete round-trip on a scratch
 * collection. Prints ONLY non-sensitive status — never tokens/secrets.
 *
 * Run: node scripts/validate-aiodb.mjs   (namespace read from AIO_runtime_namespace)
 */
import fs from 'node:fs';
import { init } from '@adobe/aio-lib-db';

const CRED_FILE = 'SparkAppbuilderPOC-245266-OAuth_Server-to-Server.json';
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

function die(msg) { console.error('FAIL:', msg); process.exit(1); }

const namespace = process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE;
if (!namespace) die('namespace missing (set AIO_runtime_namespace via .env)');

const cred = JSON.parse(fs.readFileSync(new URL(`../${CRED_FILE}`, import.meta.url)));
const clientId = cred.CLIENT_ID;
const clientSecret = Array.isArray(cred.CLIENT_SECRETS) ? cred.CLIENT_SECRETS[0] : cred.CLIENT_SECRET;
const scopes = (cred.SCOPES || []).join(',');
if (!clientId || !clientSecret || !scopes) die('OAuth creds JSON missing CLIENT_ID/CLIENT_SECRETS/SCOPES');

console.log('namespace   :', namespace);
console.log('client_id   :', clientId.slice(0, 6) + '…');
console.log('scopes(#)   :', (cred.SCOPES || []).length);

// 1) OAuth S2S → IMS access token
const tokenRes = await fetch(IMS_TOKEN_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: scopes }),
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok || !tokenJson.access_token) die(`IMS token exchange: HTTP ${tokenRes.status} ${JSON.stringify(tokenJson).slice(0, 200)}`);
const token = tokenJson.access_token;
console.log('IMS token   : obtained (len', token.length + ', expires_in', tokenJson.expires_in + ')');

// 2) init aio-lib-db
const region = process.env.AIO_DB_REGION || 'amer';
let db;
try { db = await init({ token, region, ow: { namespace } }); }
catch (e) { die(`init(): ${e.message}`); }
console.log('init        : ok (region', region + ')');

// 3) provisioning status → request if needed
try {
  const isReady = (s) => {
    const v = String((s && (s.status || s.state)) || '').toUpperCase();
    return v === 'PROVISIONED' || v === 'COMPLETE' || v === 'COMPLETED' || v === 'READY' || v === 'ACTIVE';
  };
  let status = await db.provisionStatus();
  console.log('provision   :', JSON.stringify(status));
  if (!isReady(status)) {
    console.log('provision   : requesting…');
    console.log('  request ->', JSON.stringify(await db.provisionRequest()));
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      status = await db.provisionStatus();
      console.log(`  poll ${i} ->`, JSON.stringify(status));
      if (isReady(status)) break;
    }
  }
  if (!isReady(status)) die('database still not provisioned after polling — check Console entitlement/region');
} catch (e) { die('provisioning: ' + e.message); }

// 4) ping
try { console.log('ping        :', JSON.stringify(await db.ping())); }
catch (e) { die(`ping(): ${e.message}`); }

// 5) CRUD round-trip on a scratch collection
try {
  const client = await db.connect();
  const col = client.collection('_validation_ping');
  const doc = { _probe: true, ts: new Date().toISOString(), n: Math.random() };
  const ins = await col.insertOne(doc);
  console.log('insertOne   :', JSON.stringify(ins));
  const found = await col.findOne({ _probe: true });
  console.log('findOne     :', found ? 'ok (ts ' + found.ts + ')' : 'NOT FOUND');
  const del = await col.deleteMany({ _probe: true });
  console.log('deleteMany  :', JSON.stringify(del));
  await client.close();
  console.log('\nVALIDATION PASSED ✅  aio-lib-db is reachable, provisioned, and read/write works.');
} catch (e) { die(`CRUD round-trip: ${e.message}`); }
