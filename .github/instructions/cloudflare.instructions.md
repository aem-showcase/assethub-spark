---
applyTo: "cloudflare/**"
---

# Cloudflare Worker — path-specific instructions

Canonical guidance: [`AGENTS.md`](../../AGENTS.md) · [`SECURITY.md`](../../SECURITY.md).

- This is the **itty-router v5** edge gateway. Every request to `frescopamedia.com` flows through it.
- **Middleware order is security-critical.** In `src/index.js`, public routes (`/auth/*`, `/public/*`,
  `/scripts/*`, `/styles/*`, `/blocks/*`, `/icons/*`, `/fonts/*`) come **before** `.all('*', withAuthentication)`,
  which comes **before** all `/api/*` handlers. Never register an `/api/*` route above `withAuthentication`.
- **Never edit `src/auth.js` or `src/user.js`** (protected). Session JWTs are HS256; `COOKIE_SECRET` lives only
  in Cloudflare Secrets Store. Don't change the algorithm or extend `SESSION_COOKIE_EXPIRATION` (currently `6h`).
- **Never remove/weaken the authZ filters** in `src/origin/dm.js` (`searchContentAIAuthorization`) — they inject
  brand/country/customer restrictions into every ContentAI search.
- Use `ctx.waitUntil()` for analytics/audit writes — never `await` them on the response path.
- Tests: `cd cloudflare && npm test && npm run lint-ci`. AuthZ behavior is validated in `tests/authz/`.
