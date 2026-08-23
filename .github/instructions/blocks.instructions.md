---
applyTo: "blocks/**"
---

# EDS Blocks — path-specific instructions

Canonical guidance: [`AGENTS.md`](../../AGENTS.md) · [`docs/conventions.md`](../../docs/conventions.md).

- Each block is a folder `blocks/{name}/` with `{name}.js` default-exporting `decorate(block)` and an optional
  `{name}.css` (loaded automatically by EDS — no import needed). `block` is the `<div class="{name}">` from the
  authored page.
- **Never rename a block folder** — the folder name is the CSS class in authored DA content; renaming breaks live pages.
- Build DOM with `document.createElement` — **no JSX, no framework** (no React/Vue/Redux/Zustand). State uses the
  custom pub/sub pattern (`getState`/`setState`/`subscribe`); canonical example: `blocks/search-results/search-results.js`.
- **Never set `innerHTML` with API-returned or user-supplied data** — use `textContent` / `createElement`.
- **Never hardcode user-visible strings** — use `getAppLabel(key)` from `scripts/locale-utils.js`; add keys to both
  `scripts/locales/en.json` and `ja.json`.
- Always include the `.js` extension in imports (airbnb-base ESLint enforces it).
- Tests: DOM behavior → `blocks/{name}/__tests__/{name}.dom.test.js`. Run `npm test && npm run lint`.
