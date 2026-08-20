# Coding Rules — assethub-spark

> Curated recurring conventions. These are the patterns that appear everywhere in this
> codebase. Apply them to new code. When you find a violation in code you're already
> changing, fix it as part of that change (boy-scout rule).
>
> **Scope:** new code only. Never refactor existing code to align with these rules unless
> you are already changing that file for another reason.

---

## R1 — EDS Block Decoration Pattern

Every block is a folder under `blocks/{name}/` with a `{name}.js` that default-exports
a `decorate(block)` function. `block` is the `<div class="{name}">` element as it arrives
from the EDS page HTML.

```js
// blocks/my-block/my-block.js
export default async function decorate(block) {
  // 1. Read block content (authored table rows become <div> children)
  // 2. Clear block innerHTML if you're replacing it entirely
  block.innerHTML = '';
  // 3. Build DOM using document.createElement — no innerHTML with user data
  const title = document.createElement('h2');
  title.textContent = block.querySelector('div > div').textContent;
  block.append(title);
  // 4. Attach event listeners
  block.addEventListener('click', handleClick);
}
```

**Block CSS:** lives at `blocks/{name}/{name}.css`. It is loaded automatically by EDS — no
import needed in JS.

**Block co-location:** JS, CSS, and any block-specific sub-components live in the same folder.
Do not put block-specific utilities in `scripts/`.

**Never rename a `blocks/` folder** without a coordinated DA content update — the folder name is the CSS class applied to the block element in authored documents. A rename silently breaks every page using that block.

**Import paths must include the `.js` extension** — airbnb-base ESLint (`import/extensions`) enforces this. `import { foo } from './utils.js'` not `'./utils'`.

---

## R2 — Vanilla JS State Management (Pub/Sub)

No Redux, Zustand, Recoil, or any state library. State is a plain object with a custom
pub/sub mechanism: `getState()`, `setState(updates)`, `subscribe(listener)`.

State lives **in the block's JS module**. Blocks that need to share state import from each
other (e.g., `asset-details` imports from `search-results`). Only use `window.*` for
truly global singletons (e.g., `window.user`).

See canonical pattern in `blocks/search-results/search-results.js`.

---

## R3 — URL-Based Routing

No SPA router. State that should survive page refresh or be shareable lives in URL search
params via `history.replaceState()`. Use `localStorage` only for user preferences (e.g.,
sort order) and cart contents — never for deep-linkable state.

---

## R4 — 3-Tier Page Load (EAGER / LAZY / DELAYED)

`scripts/scripts.js` loads content in three tiers. Understand this before adding to the
page load pipeline.

| Tier | When | What goes here |
|------|------|----------------|
| **EAGER** | Immediately, blocks main thread | Auth check, above-fold content, header |
| **LAZY** | After above-fold renders | Footer, below-fold sections, cart panel |
| **DELAYED** | 3 seconds after load | Notifications, template provisioning, non-critical analytics |

New code that's not user-visible on first render belongs in **LAZY** or **DELAYED**.
Nothing goes in EAGER unless it must be visible or complete before the user can interact.

---

## R5 — Fire-and-Forget Analytics in the Worker

Analytics writes must never block the response. Always use `ctx.waitUntil()` where `ctx`
is the third parameter passed to itty-router handlers — it is **not** `request.ctx`.

```js
// ✅ Correct — ctx is the 3rd handler param
export async function handleSearch(request, env, ctx) {
  ctx.waitUntil(writeAnalyticsEvent({ ... }));
  return response;
}
```

This applies to: search events, login events, download events, audit events.

---

## R6 — Cross-Tab Cart Sync via BroadcastChannel

The cart is synced across tabs using `BroadcastChannel('cart-sync')`. Cart state lives in
`localStorage` under keys `cartAssetItems` and `cartTemplateItems`. On every `setState()`,
the new state is broadcast to other tabs. There is no server-side cart — it is entirely
client-side.

Do not introduce a server-side cart without coordinating this architecture change. Do not
change the channel name or localStorage keys without updating all consumers in `scripts/cart-state.js`.

---

## R7 — Configuration Lives in EDS Spreadsheets

Role permissions, brand restrictions, and company-to-role mappings live in EDS spreadsheets
fetched at runtime by the Cloudflare Worker (`cloudflare/src/user.js`):

| Spreadsheet | Path | Contents |
|---|---|---|
| Application permissions | `/config/access/application` | Email domain or specific email → API access |
| Company roles | `/config/access/companies` | Email domain → role, country, brand |
| User overrides | `/config/access/users` | Per-email role/country/brand overrides |
| Restricted brands | `/config/access/restricted-brands` | Brands hidden from certain roles |

NEVER hardcode role logic in the worker. Add a new column/row to the spreadsheet and fetch
it via the existing config loading pattern in `cloudflare/src/user.js`.

---

## R8 — i18n via JSON Locale Files + URL Prefix

Translations live in `scripts/locales/en.json` and `scripts/locales/ja.json`.
The active locale is determined by the URL path prefix (`/ja/` = Japanese, otherwise English).
Use `getAppLabel(key)` (async, from `scripts/locale-utils.js`) for all user-visible strings.

NEVER hardcode English strings in block JS — this breaks Japanese users. When adding a
new user-visible string: add the key to both locale files, then use `getAppLabel(key)` in the block.

---

## R9 — No innerHTML with Dynamic Data

NEVER set `innerHTML` with user-supplied or API-returned strings — use `textContent` for
text and `document.createElement` for structure. Static, developer-authored HTML strings
with no interpolated data are acceptable (and widely used in this codebase for templates).
