# INVARIANTS.md

> **Non-negotiable rules for assethub-spark.**
> These invariants apply to everyone — humans and agents alike. They are enforced by
> `.gitignore`, GitHub Actions CI, and CODEOWNERS. Never lower the bar; raise it.

---

## I1 — Never Commit Secrets

`COOKIE_SECRET`, `DM_CLIENT_ID`, and `DM_CLIENT_SECRET` live in **Cloudflare Secrets Store**.
They are never in source code, never in `wrangler.jsonc`, never in any committed file.

The following files are gitignored and must stay that way:
```
secret.env   .env   .dev.vars   .secrets
```

**Why it matters:** `COOKIE_SECRET` signs session JWTs. If it leaks, every user's session
can be forged. `DM_CLIENT_ID`/`DM_CLIENT_SECRET` grant access to the full Adobe IMS token
endpoint — a leak gives unlimited asset API access.

---

## I2 — Never Bypass `withAuthentication`

The `withAuthentication` middleware in `cloudflare/src/index.js` must remain in place and
must appear **after** public routes (`/auth/*`, `/public/*`, `/scripts/*`, `/styles/*`,
`/blocks/*`, `/icons/*`, `/fonts/*`) and **before** all `/api/*` handlers and the catch-all.

No route handler may skip authentication by moving above this middleware or by adding a new
public-route pattern for an API endpoint.

**Why it matters:** Every authenticated feature — search, cart, collections, reports —
depends on this single gate. Bypassing it exposes user data and internal APIs publicly.

---

## I3 — Never Change `/api/*` Endpoint Paths

The following paths are public contracts consumed by EDS pages without versioning:
- `/api/user`
- `/api/adobe/assets/contentai/search`
- `/api/adobe/assets/*`
- `/api/savedsearches/*`
- `/api/rightsrequests/*`
- `/api/messages/*`
- `/api/analytics/*`
- `/api/audit/*`

Renaming or restructuring these paths breaks live production silently — EDS pages fetch
them by hardcoded path. Any change requires a coordinated update across the worker **and**
all blocks that call the endpoint, tested end-to-end before merge.

---

## I4 — Never Rename a `blocks/` Folder Without a Content Change

The folder name under `blocks/` is the CSS class name applied to the block element in
authored DA documents. Renaming `blocks/search-results/` to anything else breaks every
page that has a Search Results block — the block will not be found and will not load.

Renames require:
1. Updating the DA document (or all pages using the block)
2. A coordinated deploy of both the code rename and the content update

---

## I5 — Never Disable CI Checks

`npm test`, `npm run lint`, `cd cloudflare && npm test`, and `cd cloudflare && npm run lint-ci`
must remain active and passing in `.github/workflows/build.yaml`. Do not comment them out,
add `continue-on-error: true`, or skip them via `if:` conditions.

**Why it matters:** These are the only automated gate between a code change and a branch
deployment to `*.dev.frescopamedia.com`.

---

## I6 — Never Remove AuthZ Filters from `dm.js`

`searchContentAIAuthorization()` in `cloudflare/src/origin/dm.js` injects brand, country,
and customer filters into every ContentAI search request. These filters are the primary
mechanism that prevents restricted assets from appearing in search results for unauthorized users.

Removing or weakening any filter — even temporarily for debugging — must never be merged
to `main`. Use the SUDO impersonation mechanism in tests instead.
