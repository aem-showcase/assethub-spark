# Cloudflare Worker Reference

> Read this before touching `cloudflare/src/index.js`, `auth.js`, `user.js`, or `dm.js`.
> For the full system architecture see [`/ARCHITECTURE.md`](/ARCHITECTURE.md).

---

## 1. Middleware Chain Order

Every request to `frescopamedia.com` passes through itty-router in this order.
**Order is security-critical — do not reorder without human review.**

| Step | Middleware | Purpose |
|------|-----------|---------|
| 1 | `withTlsCheck` | Reject TLS < 1.2 |
| 2 | `preflight` | Handle OPTIONS CORS preflight |
| 3 | `withPreviewOrigin` | Switch origin for preview.frescopamedia.com |
| 4 | `withCookies` | Parse and URL-decode all cookies |
| 5 | `/auth/*` routes | Login / callback / logout — no session required |
| 6 | Public static routes | `/public/`, `/scripts/`, `/styles/`, `/blocks/`, `/icons/`, `/fonts/` — exit before auth |
| **7** | **`withAuthentication`** | **Auth gate — validate Session JWT. Unauthenticated → 302 /auth/login** |
| 8 | `/api/*` handlers | All authenticated API routes |
| 9 | `originHelixWithPageAccess` | EDS pages + page-level access check |
| 10 | `corsify` (finally) | Add CORS headers to all responses |

**Rule:** New `/api/*` endpoints must be added after step 7. An endpoint above step 7 is publicly accessible.

---

## 2. OIDC Authentication (Microsoft Entra)

**Login (`GET /auth/login`):** Generate nonce + state JWT → set `State` cookie → `302 →` Entra.

**Callback (`POST /auth/callback`):** Entra posts `id_token` as form body.
1. Verify `state` JWT + `id_token` signature against Entra JWKS
2. Extract claims (email, name, Entra OID, roles)
3. Merge with EDS spreadsheet overrides (`/config/access/users`, `/config/access/companies`)
4. Create session JWT (HS256, `COOKIE_SECRET`, 6h) → set `Session` cookie (HttpOnly, Secure)
5. Write login event to D1 + Analytics Engine (fire-and-forget), then `302 →` original destination

**Session validation (`withAuthentication`):** Verify `Session` JWT signature + expiry. Attaches decoded payload to `request.user`.

See `cloudflare/src/auth.js` for full implementation detail.

---

## 3. Authorization — 7 Layers

All 7 layers must pass. They are independent — weakening one does not degrade the others.

| Layer | Where enforced | What it checks |
|-------|---------------|----------------|
| **1 Route-level** | `cloudflare/src/index.js` | Admin-only paths blocked before reaching handler |
| **2 API permission** | `cloudflare/src/origin/dm.js` | `/config/access/application` sheet — email domain or specific email |
| **3 DM search filters** | `cloudflare/src/origin/dm.js` (`searchContentAIAuthorization`) | Brand restrictions, country filter (partners), customer filter |
| **4 Per-asset metadata** | `cloudflare/src/origin/dm.js` (post-response) | `custom:userType` (internal/external/all) vs. user role |
| **5 Collection ACL** | `cloudflare/src/origin/collections.js` | `custom:assetCollectionOwner/Editor/Viewer` fields |
| **6 Page-level** | `scripts/scripts.js` (`checkPageAccess`) | `<meta name="exclude-roles">` in page HTML |
| **7 Section-level** | EDS block JS | `data-roles` attribute hidden client-side |

Layer 3 is the most critical — removing or weakening its brand/country/customer filter injection causes restricted assets to leak. See `INVARIANTS.md I4` and `cloudflare/src/origin/dm.js`.

---

## 4. IMS Token Caching

Adobe ContentAI requires a service-level IMS access token (not the user's session token).
The worker caches it in Cloudflare KV (`AUTH_TOKENS:ims-token`, 24h TTL) and refreshes proactively
when less than 5 minutes remain — ensuring the token is valid for the full request lifecycle.
Implementation: `cloudflare/src/origin/dm.js` → `getIMSToken(env)`.
