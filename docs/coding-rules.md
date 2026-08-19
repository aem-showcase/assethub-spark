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

---

## R2 — Vanilla JS State Management (Pub/Sub)

No Redux, Zustand, Recoil, or any state library. State is a plain object with a custom
pub/sub mechanism.

```js
// Canonical pattern (see blocks/search-results/search-results.js)
const state = {
  query: '',
  results: null,
  loading: false,
};

const listeners = new Set();

export function getState() {
  return { ...state }; // return a copy
}

export function setState(updates) {
  Object.assign(state, updates);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener); // returns unsubscribe fn
}
```

State lives **in the block's JS module**. Blocks that need to share state import from each
other (e.g., `asset-details` imports from `search-results`). Never use `window.*` for
state — only for truly global singletons (e.g., `window.user`).

---

## R3 — URL-Based Routing

There is no SPA router. State that should survive page refresh or be shareable is stored
in URL search params via `history.replaceState()`.

```js
// ✅ Store state in URL
const params = new URLSearchParams(window.location.search);
params.set('query', searchTerm);
params.set('assetId', selectedId);
window.history.replaceState({}, '', `?${params.toString()}`);

// ✅ Read state from URL on init
const query = new URLSearchParams(window.location.search).get('query') ?? '';
```

Never use `localStorage` or `sessionStorage` for state that should be deep-linkable.
Use `localStorage` only for user preferences (e.g., sort order) and cart contents.

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

Analytics writes must never block the response. Always use `ctx.waitUntil()`.

```js
// ✅ Correct
request.ctx.waitUntil(writeAnalyticsEvent({ ... }));
return response;

// ❌ Wrong — blocks response
await writeAnalyticsEvent({ ... });
return response;
```

This applies to: search events, login events, download events, audit events.

---

## R6 — Cross-Tab Cart Sync via BroadcastChannel

The cart is synced across tabs using `BroadcastChannel`. This means:
- Cart state lives in `localStorage` (`spark-cart` key)
- On every `setState()`, the new state is broadcast to other tabs
- There is no server-side cart — it is entirely client-side

```js
const broadcast = new BroadcastChannel('spark-cart');
broadcast.onmessage = ({ data }) => {
  if (data.type === 'cart-sync') syncLocalState(data.cart);
};
```

Do not introduce a server-side cart without coordinating this architecture change.

---

## R7 — Configuration Lives in EDS Spreadsheets

Role permissions, brand restrictions, and company-to-role mappings live in EDS spreadsheets
fetched at runtime by the Cloudflare Worker:

| Spreadsheet | Path | Contents |
|---|---|---|
| Application permissions | `/config/access/application` | Email domain or specific email → API access |
| Company roles | `/config/access/companies` | Email domain → role, country, brand |
| User overrides | `/config/access/users` | Per-email role/country/brand overrides |
| Restricted brands | `/config/access/restricted-brands` | Brands hidden from certain roles |

**Do not hardcode role logic in the worker.** Add a new column/row to the spreadsheet
and fetch it via the existing config loading pattern in `cloudflare/src/user.js`.

---

## R8 — i18n via JSON Locale Files + URL Prefix

Translations live in `scripts/locales/en.json` and `scripts/locales/ja.json`.
The active locale is determined by the URL path prefix (`/ja/` = Japanese, otherwise English).

```js
// ✅ Get a localized label
import { getLocaleLabel } from '../scripts/locale-utils.js';
const label = getLocaleLabel('search.placeholder'); // → "Search assets" or "アセットを検索"

// ❌ Never hardcode English strings in block JS
button.textContent = 'Download'; // breaks Japanese users
```

When adding a new user-visible string:
1. Add the key to `scripts/locales/en.json`
2. Add the translated value to `scripts/locales/ja.json`
3. Use `getLocaleLabel()` in the block

---

## R9 — No innerHTML with Dynamic Data

Never set `innerHTML` with user-supplied or API-returned strings — use `textContent` for
text and `document.createElement` for structure.

```js
// ✅ Safe
const title = document.createElement('h2');
title.textContent = asset.title; // textContent escapes HTML

// ❌ XSS risk
card.innerHTML = `<h2>${asset.title}</h2>`;
```

Exception: static, developer-authored HTML strings with no interpolated data are acceptable.
