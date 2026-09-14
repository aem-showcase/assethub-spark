# Spark/Frescopamedia server layer — Adobe App Builder PoC

Feasibility PoC for the Project Archimedes action item *"Port Frescopamedia onto App Builder —
show what works or the hard limits."* Non-destructive: `cloudflare/` is untouched. This tree
re-implements that single Cloudflare Worker as **Adobe I/O Runtime actions**.

**Read [`FINDINGS.md`](./FINDINGS.md) first** — it is the deliverable (hard-limit table + what
ported vs. what breaks, all confirmed on the deployed action).

## Layout
```
app-builder/
  app.config.yaml            # Runtime manifest (dispatcher + cron actions)
  actions/
    dispatcher/index.js      # single web:raw action — emulates the itty-router Worker
    lib/                     # ow<->fetch adapters, cookies, config, jose session
    storage/sql.js           # Cloudflare D1 over HTTP, shaped like the D1 binding
    storage/kv.js            # aio-lib-state, shaped like the CF KV binding
    origin/helix.js          # EDS origin proxy (bounded by the 1 MB limit)
    api/stubs.js             # 501 stubs for the un-portable endpoints
    scheduled/token-refresh.js
  scripts/limit-test.mjs     # empirical 1 MB response-cap probe
```
The dispatcher **reuses the real Worker handlers** `cloudflare/src/api/smart-collections.js`
and `cloudflare/src/origin/dm.js` **unchanged** — only the platform bindings differ (D1 native
binding → HTTP; CF KV/Secrets → `aio-lib-state` + shims). The DM proxy does the real IMS S2S
token exchange and returns real Frescopa assets for `POST /api/adobe/assets/contentai/search`.

## Run locally (no deploy)
```bash
cd app-builder
npm install
set -a && . ./.env && set +a
node scripts/local.mjs                     # http://localhost:3000
# in another shell:
COOKIE=$(curl -s -i localhost:3000/auth/dev-login | awk 'tolower($1)=="set-cookie:"{print $2}' | cut -d';' -f1)
curl -s -H "cookie: $COOKIE" localhost:3000/api/smart-collections   # live D1 rows
```
`scripts/local.mjs` runs the **same** dispatcher code, wrapping HTTP requests into the
`__ow_*` params the action receives when deployed. Outbound calls (Helix, Cloudflare D1,
`aio-lib-state`) hit the **real** services — App Builder has no local storage emulation
(FINDINGS.md limit #8), so the harness feeds the deploy credentials to `aio-lib-state`.
(`aio app dev` is the official loop but expects a full Console project context; this
harness is the fast path for a headless runtime-only app.)

## Deploy
```bash
cd app-builder
npm install
set -a && . ./.env && set +a      # namespace/auth/secrets/D1 token (git-ignored)
npm run deploy                    # aio app deploy --no-web-assets
# or: ./deploy_stage.sh           # deploy + smoke-test in one step
```

## Browsable UI on the raw Stage URL — "Path A" (no custom domain)
A Runtime web action lives under the fixed prefix `/api/v1/web/<pkg>/<action>`, but the
proxied EDS site + app use **root-absolute** paths (`/scripts`, `/en`, `/api`), so nothing
resolves and the browser can't assemble the page (limit #7). **Path A** rewrites URLs so the
whole site self-hosts under that one prefix — no CDN/custom domain. It is driven by the
`BASE_PATH` input (`.env`): empty = serve at root (local); set to the action path on Stage.

Implemented in `actions/lib/basepath.js`: served-HTML + `Location` rewriting, a `/x-asset`
proxy that dodges the reserved-extension gateway (limit #13) for `.svg`/`.json`, an
injected `<head>` shim (`codeBasePath` + `fetch`/`XHR`/`MutationObserver` remapping) for
runtime-constructed URLs, and an on-the-fly rewrite of the proxied `scripts/locale-utils.js`
so `localizePath()` prefixes the base — this fixes **programmatic full-page navigations**
(`window.location.href = localizePath('/search')`, which the shim cannot intercept because
the `Location` interface is unforgeable). Verified live: the full home page renders with
styles, icons, and the live-DA **Featured Smart Collections** card, and clicking **Search**
navigates to `…/dispatcher/en/search?query=…` (see `FINDINGS.md` → "Path A"). The 1 MB /
no-streaming cap (limit #1) is **not** fixed — assets > ~1 MB still fail.

Browse it (dev-login first so subsequent requests carry the session cookie):
```
…/spark/dispatcher/auth/dev-login   then   …/spark/dispatcher/en/
```
Test the prefix faithfully **locally** by emulating the Stage action path:
```bash
LOCAL_BASE_PATH=/api/v1/web/spark/dispatcher node scripts/local.mjs
# then browse http://localhost:3000/api/v1/web/spark/dispatcher/en/
```

## Smoke test (deployed)
```bash
BASE=https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher
COOKIE=$(curl -s -i "$BASE/auth/dev-login" | awk 'tolower($1)=="set-cookie:"{print $2}' | cut -d';' -f1)
curl -s -H "cookie: $COOKIE" "$BASE/api/user"                # 200 user JSON
curl -s -H "cookie: $COOKIE" "$BASE/api/smart-collections"   # live D1 rows
curl -s -H "cookie: $COOKIE" "$BASE/api/kv-demo"             # aio-lib-state counter
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/audit/summary"   # 501 stub
node scripts/limit-test.mjs "$BASE"                          # 1 MB proxy boundary

# DM ContentAI search — real IMS S2S token + real Frescopa assets (JSON < 1 MB)
NOW=$(node -e 'console.log(new Date().toISOString())')
curl -s -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -X POST "$BASE/api/adobe/assets/contentai/search" \
  -d '{"query":[{"and":[{"and":[{"match":{"text":""}},{"or":[{"not":[{"exists":{"field":"assetMetadata.pur:expirationDate"}}]},{"range":{"assetMetadata.pur:expirationDate":{"gt":"'"$NOW"'"}}}]}]}]}],"limit":2}'

# DM asset delivery: small .png binary serves (200); .svg → 400 (limit #13); large/video → limit #1
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "cookie: $COOKIE" "$BASE/api/adobe/assets/urn:aaid:aem:13b0ca4c-efde-4038-8127-e8be366e0cfa/as/dripmachine.png"
```

## PoC-only caveats (remove before any shared/production use)
- `/auth/dev-login` mints a test session without SSO — **delete it**; wire real Entra by
  registering the `adobeioruntime.net` `redirect_uri` in the Entra app
  (step-by-step: [`docs/ENTRA_SETUP.md`](docs/ENTRA_SETUP.md)).
- `CF_D1_API_TOKEN` is a **personal** Cloudflare token — swap for an account-owned token.
- Secrets live in `.env` / action inputs (weaker isolation than a secret store).
