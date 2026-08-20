# Conventions — assethub-spark

> Reference appendix. Critical rules are summarised in [`AGENTS.md § Code Conventions`](../AGENTS.md).
> Apply to new code. Boy-scout rule: fix violations in files you are already changing.

---

## EDS Block Pattern

Every block is a folder under `blocks/{name}/` with a `{name}.js` default-exporting `decorate(block)`.
`block` is the `<div class="{name}">` element from the authored page.

```js
// blocks/my-block/my-block.js
export default async function decorate(block) {
  block.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = block.querySelector('div > div').textContent;
  block.append(title);
  block.addEventListener('click', handleClick);
}
```

Block CSS at `blocks/{name}/{name}.css` — loaded automatically by EDS, no import needed.
JS, CSS, and block-specific sub-components all live in the same folder. Do not put
block-specific utilities in `scripts/`.

---

## State Management

No Redux, Zustand, or any state library. State is a plain object with a custom pub/sub:
`getState()`, `setState(updates)`, `subscribe(listener)`. State lives in the block's JS module.
Blocks that need to share state import from each other. Use `window.*` only for truly global
singletons (e.g., `window.user`). Canonical pattern: `blocks/search-results/search-results.js`.

---

## URL Routing

No SPA router. Shareable state lives in URL search params via `history.replaceState()`.
`localStorage` is for user preferences and cart contents only — never for deep-linkable state.

---

## Page Load Tiers (scripts/scripts.js)

| Tier | When | What belongs here |
|------|------|----------------|
| **EAGER** | Immediately | Auth check, above-fold content, header |
| **LAZY** | After above-fold renders | Footer, below-fold sections, cart panel |
| **DELAYED** | 3 seconds after load | Notifications, provisioning, non-critical analytics |

New code not user-visible on first render belongs in LAZY or DELAYED.

---

## Analytics (Cloudflare Worker)

`ctx.waitUntil()` for all analytics writes — `ctx` is the 3rd itty-router handler parameter.
Applies to: search events, login events, download events, audit events.

---

## Cart State

Cross-tab sync via `BroadcastChannel('cart-sync')`. Cart state in `localStorage` under
`cartAssetItems` and `cartTemplateItems`. No server-side cart. Do not change the channel
name or localStorage keys without updating all consumers in `scripts/cart-state.js`.

---

## Configuration

Role permissions live in EDS spreadsheets fetched at runtime by `cloudflare/src/user.js`.
Never hardcode role logic in the Worker — add rows to the spreadsheet and fetch via the
existing config loading pattern.

---

## i18n

Translations in `scripts/locales/en.json` and `scripts/locales/ja.json`.
Active locale from URL prefix (`/ja/` = Japanese, otherwise English).
Use `getAppLabel(key)` (async, from `scripts/locale-utils.js`) for all user-visible strings.
Add new keys to both locale files before using.

---

## XSS

Never set `innerHTML` with API-returned or user-supplied data — use `textContent` or
`createElement`. Static developer-authored HTML templates with no interpolated data are fine.
