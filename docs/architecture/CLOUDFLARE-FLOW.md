# Cloudflare Worker — Deep Flow Reference

> **Source of truth for everything that happens inside the Cloudflare Worker.**
> Read this before touching `cloudflare/src/index.js`, `auth.js`, `user.js`, or `dm.js`.
> For the full system architecture, see [`/ARCHITECTURE.md`](/ARCHITECTURE.md).

---

## 1. Middleware Chain (index.js)

Every request to `frescopamedia.com` passes through this chain in order. **Order is
security-critical** — do not reorder without human review.

```
router
  .all('*', withTlsCheck)           // 1. Reject TLS < 1.2 → 403
  .all('*', preflight)              // 2. Handle OPTIONS CORS preflight → 204
  .all('*', withPreviewOrigin)      // 3. If preview.frescopamedia.com → switch origin to .aem.page
  .all('*', withCookies)            // 4. Parse + URL-decode all cookies into request.cookies
  .get('/auth/*', authRouter)       // 5. Auth routes (no session required)
  .all('/public/*', originHelix)    // 6. Public static assets (no auth)
  .all('/scripts/*', originHelix)   //    ↑ these routes exit before withAuthentication
  .all('/styles/*', originHelix)    //
  .all('/blocks/*', originHelix)    //
  .all('/icons/*', originHelix)     //
  .all('/fonts/*', originHelix)     //
  .all('*', withAuthentication)     // 7. *** AUTH GATE *** — validate Session JWT
                                    //    Unauthenticated → 302 to /auth/login
  .get('/api/user', apiUser)        // 8. Authenticated routes below this line
  .post('/api/adobe/assets/contentai/search', originDynamicMedia)
  .get('/api/adobe/assets/*', originDynamicMedia)
  .all('/api/savedsearches/*', savedSearchesApi)
  .all('/api/rightsrequests/*', rightsRequestsApi)
  .all('/api/messages/*', notificationsApi)
  .all('/api/analytics/*', analyticsApi)
  .all('/api/audit/*', auditApi)
  .all('/content/share/*', publishShareRouter)
  .all('*', originHelixWithPageAccess)  // 9. EDS pages + page-level access check
  .finally([corsify])               // 10. Add CORS headers to all responses
```

**Rule:** New `/api/*` endpoints must always be added **after** `withAuthentication` (step 7).
Moving an endpoint above step 7 makes it publicly accessible.

---

## 2. Authentication Flow (OIDC with Microsoft Entra)

### Login initiation (`GET /auth/login`)
1. Generate cryptographically random `nonce` and `state`
2. Create a signed `state` JWT (`HS256`, `COOKIE_SECRET`, 10-min expiry) containing `nonce` + `redirectTo`
3. Set `State` cookie (`HttpOnly`, `Secure`, `SameSite=None`, 10-min expiry)
4. `302 →` Microsoft Entra authorization endpoint with `response_type=id_token&nonce=...&state=...`

### Callback (`POST /auth/callback`) — Entra sends `id_token` as form body
1. Parse form body → extract `id_token` and `state`
2. Verify `state` JWT (signature + expiry using `COOKIE_SECRET`)
3. Fetch Entra JWKS from `MICROSOFT_ENTRA_JWKS_URL` (cached in KV, refreshed on rotation)
4. Verify `id_token` signature against JWKS + validate `nonce` matches state JWT
5. Extract claims: `email`, `name`, `oid` (Entra object ID = `userId`), `roles` array
6. Fetch user attributes from EDS spreadsheets:
   - `/config/access/users` → per-email overrides (roles, countries, brands, customers)
   - `/config/access/companies` → domain → (role, country, brand) mapping
7. Merge Entra claims with spreadsheet overrides → final permission set
8. Create session JWT:
   ```json
   {
     "email": "user@company.com",
     "name": "User Name",
     "userId": "<entra-oid>",
     "roles": ["employee"],
     "countries": ["us", "jp"],
     "brands": [],
     "customers": [],
     "sid": "<random-uuid>",
     "iat": 1234567890,
     "exp": 1234567890
   }
   ```
9. Sign with `HS256` using `COOKIE_SECRET`
10. Set `Session` cookie (`HttpOnly`, `Secure`, `SameSite=None`, 6h expiry)
11. Upsert login record into D1 `USER_LOGINS` table
12. Write login event to Analytics Engine (fire-and-forget via `ctx.waitUntil`)
13. `302 →` original destination (or `/`)

### Session validation (`withAuthentication`)
- Parse `Session` cookie → verify JWT signature (`HS256`, `COOKIE_SECRET`)
- Check `exp` claim → if expired, `302 →` `/auth/login`
- Attach decoded payload to `request.user` for downstream handlers

### Logout (`GET /auth/logout`)
- Clear `Session` cookie (set empty, past expiry)
- `302 →` Entra logout endpoint → back to `/`

---

## 3. Authorization — 7 Layers

Each layer is independent. All must pass for a user to access a resource.

| Layer | Where enforced | What it checks |
|-------|---------------|----------------|
| **1 Route-level** | `cloudflare/src/index.js` | Admin-only paths blocked before reaching handler |
| **2 API permission** | `cloudflare/src/origin/dm.js` | `/config/access/application` sheet — email domain or specific email |
| **3 DM search filters** | `cloudflare/src/origin/dm.js` `searchContentAIAuthorization()` | Brand restrictions, country filter (partners), customer filter |
| **4 Per-asset metadata** | `cloudflare/src/origin/dm.js` (post-response) | `custom:userType` (internal/external/all) vs. user role |
| **5 Collection ACL** | `cloudflare/src/origin/collections.js` | `custom:assetCollectionOwner/Editor/Viewer` fields |
| **6 Page-level** | `scripts/scripts.js` `checkPageAccess()` | `<meta name="exclude-roles">` in page HTML |
| **7 Section-level** | EDS block JS | `data-roles` attribute hidden client-side |

### Layer 3 — Search AuthZ Filter Injection (most critical)

`searchContentAIAuthorization(user, searchBody, env)` in `cloudflare/src/origin/dm.js`:

```js
// Admin → no filters, sees everything
if (user.roles?.includes('admin')) return searchBody;

// No roles → block all results
if (!user.roles?.length) return { queries: [] };

// Restricted brands (from /config/access/restricted-brands spreadsheet)
if (restrictedBrands.length > 0) {
  filters.push({ op: 'NOT', clauses: restrictedBrands.map(b => ({ value: `brand:${b}` })) });
}

// Country filter (partner users only)
if (user.roles?.includes('partner') && user.countries?.length) {
  filters.push({ op: 'AND', value: `custom:country:(${user.countries.join(' OR ')})` });
}

// Customer filter
if (user.customers?.length) {
  filters.push({ op: 'AND', value: `custom:customer:(${user.customers.join(' OR ')})` });
}
```

---

## 4. IMS Token Caching

Adobe ContentAI API requires an IMS `access_token` (not the user's session token).
The service fetches this using client credentials and caches it in Cloudflare KV.

```
getIMSToken(env):
  1. KV.get('AUTH_TOKENS:ims-token')
     ├─ hit + exp > now + 5min  →  return cached token
     └─ miss or expiring soon  →  continue
  2. POST https://ims-na1.adobelogin.com/ims/token/v4
     body: client_id=DM_CLIENT_ID, client_secret=DM_CLIENT_SECRET, grant_type=client_credentials
  3. KV.put('AUTH_TOKENS:ims-token', access_token, { expirationTtl: 86400 })
  4. return access_token
```

**Why the 5-minute buffer:** KV reads can return a token that expires in seconds by the
time the downstream request actually uses it. The buffer ensures the cached token is valid
for the entire request lifecycle.

---

## 5. Fire-and-Forget Analytics

Analytics writes must **never** block the response path. Always use `ctx.waitUntil()`.

```js
// ✅ Correct — analytics runs after response is sent
request.ctx.waitUntil(
  writeSearchEvent({ userId, searchTerm, resultCount, timestamp })
);
return searchResponse;

// ❌ Wrong — await blocks the response
await writeSearchEvent({ ... });
return searchResponse;
```

Analytics destinations:
- **Cloudflare Analytics Engine** — login events, search events, download events (real-time metrics)
- **Cloudflare D1** — `SEARCH_EVENTS`, `USER_LOGINS`, `AUDIT_EVENTS` (SQL queryable for reports)

Scheduled tasks (Cloudflare Cron Triggers) handle:
- Monthly IMS token refresh
- Daily rights request reminder emails (via Office 365 SMTP with OAuth2)
