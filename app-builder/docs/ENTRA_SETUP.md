# Configure the Entra app for real SSO (Azure Portal)

## Why this exists (purpose)

This PoC ports the portal's Cloudflare Worker onto Adobe App Builder. Auth has **two
paths**:

- **`/auth/dev-login`** — a PoC bypass that mints a session *without* Microsoft. It exists
  only so the app is browsable before Entra is wired up. It fakes `roles:['admin']`, and
  must be deleted before any shared/production use.
- **Real Microsoft Entra SSO** (`/auth/login` → Microsoft → `/auth/callback`) — the actual
  ported flow. The code is active: an unauthenticated page hit already 302s to
  `login.microsoftonline.com`. It just can't *complete* yet, because the App Builder
  callback URL is not registered on the Entra app, so Microsoft returns:

  > `AADSTS50011: The redirect URI '…/auth/callback' specified in the request does not
  > match the redirect URIs configured for the application…`

**The whole purpose of this configuration** is to register that one App Builder callback URL
(and enable ID tokens) on the existing Entra app so the *real* SSO flow completes. After
this, sign-in uses genuine Microsoft identity + your true entitlements — no dev-login,
no faked admin role. It's the last step to make the PoC's auth production-realistic instead
of a bypass.

## What the ported code sends (drives the required settings)

From `actions/dispatcher/index.js` (`startLogin`) and `actions/lib/session.js`:

| Parameter | Value | Consequence for Entra config |
|---|---|---|
| `client_id` | `93e6431f-2f57-4612-96c8-1464640b4280` | the app registration to edit |
| tenant | `983cbc50-8ad1-4dde-b705-7c80477a4186` | single-tenant; issuer/`tid` validated |
| `response_type` | `id_token` | **must enable "ID tokens"** (implicit) |
| `response_mode` | `form_post` | callback receives a POST → **Web** platform |
| `scope` | `openid profile` | delegated, default perms (usually pre-consented) |
| `redirect_uri` | `${origin}${BASE_PATH}/auth/callback` | **must be registered** (see below) |
| validation | issuer `…/{tenant}/v2.0`, audience = client_id, `tid`, `nonce` | tenant/app must match exactly |

## Steps

### 1. Open the app registration
- **portal.azure.com** → **Microsoft Entra ID** → **App registrations** → **All applications**.
- Search client ID **`93e6431f-2f57-4612-96c8-1464640b4280`** and open it.
- ⚠️ This is the existing (shared/production) portal app. You are only **adding** a redirect
  URI — do **not** remove existing URIs.

### 2. Add the redirect URI(s) — left nav → **Authentication**
- Under **Platform configurations**: if there is no **Web** platform, click
  **Add a platform → Web**. If Web already exists, click **Add URI** under it.
- Add the Stage callback (exact — `https`, no trailing slash):
  ```
  https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/auth/callback
  ```
- Optional, for local real-SSO testing (Azure allows `http` only for loopback):
  ```
  http://localhost:3000/auth/callback
  ```

### 3. Enable ID tokens — same **Authentication** page
- Scroll to **Implicit grant and hybrid flows** → check ☑ **ID tokens (used for implicit
  and hybrid flows)**.
- Required because the app requests `response_type=id_token` via `form_post`. Without it
  Microsoft returns `AADSTS700054: response_type 'id_token' is not enabled…`.

### 4. Save
- Click **Save** at the top of the Authentication page. Changes propagate within seconds
  to a minute.

### 5. (Usually already fine) API permissions
- The flow needs only delegated **`openid`** + **`profile`** (Microsoft Graph) — default and
  normally admin-consented for an existing app. If sign-in later prompts for consent, an
  admin clicks **Grant admin consent** under **API permissions**.

## CLI alternative (Azure CLI)

If you prefer not to use the portal (requires rights on the app):

```bash
az ad app update --id 93e6431f-2f57-4612-96c8-1464640b4280 \
  --web-redirect-uris \
    "https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/auth/callback" \
    "http://localhost:3000/auth/callback"

# enable ID token issuance (implicit)
az ad app update --id 93e6431f-2f57-4612-96c8-1464640b4280 \
  --enable-id-token-issuance true
```
> Note: `--web-redirect-uris` **replaces** the Web redirect list. Include any existing URIs
> you want to keep. Use the portal if you're unsure what's already registered.

## Test the real flow (after saving)

Use a **fresh/incognito** browser (no dev-login cookie) and hit **`/auth/login`** (not
dev-login):
```
https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/auth/login
```
Expected: real Microsoft sign-in → after authenticating (e.g. `tphan@adobe.com`), Entra
POSTs the id_token to `…/dispatcher/auth/callback`, the action verifies it, sets the real
session, and redirects. Then open:
```
https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/en/
https://245266-sparkappbuilderpoc-stage.adobeioruntime.net/api/v1/web/spark/dispatcher/api/user
```
`/api/user` now reflects your **real** token claims (not the faked dev-login admin identity).

## Gotchas

- Redirect URIs must match **character-for-character** (scheme, host, and the full
  `/api/v1/web/spark/dispatcher/auth/callback` path). Path A builds exactly this
  `redirect_uri` from `BASE_PATH`.
- If you change the action name, package, or namespace, the callback path changes → register
  the new URI.
- Real tokens carry the roles/groups Entra actually assigns you; the ported callback maps
  those. The `admin` bypass applies **only** to `/auth/dev-login`.
