# GitHub Copilot Instructions

> **Canonical source: [`AGENTS.md`](../AGENTS.md)**
>
> Full conventions live in `AGENTS.md`. This file is a quick-reference for Copilot IDE
> suggestions. When in doubt, read `AGENTS.md`.

---

## Quick Reference

**Repo:** Assets Hub Spark — enterprise DAM portal at `frescopamedia.com`.

**Stack:** Vanilla JS, no framework. AEM EDS/Helix (frontend). Cloudflare Worker (all requests
go through it — browser never calls backends directly). Adobe ContentAI (asset search).

**EDS block pattern — every block follows this:**
```js
// blocks/my-block/my-block.js
export default async function decorate(block) {
  // block = <div class="my-block"> from authored page
  // Use document.createElement — no JSX, no template literals for HTML
  // State: custom pub/sub (state object + Set<listener> + setState() + subscribe())
}
```

**State management:** Custom pub/sub only. No React, Redux, Zustand, or any framework.

**Commit format:** `GH-NNN : brief description`

**Never:**
- Call backend APIs directly from browser — route through `/api/*` (Cloudflare Worker handles auth)
- Modify `cloudflare/src/auth.js` or `cloudflare/src/user.js`
- Commit secrets or `.env` files
- Rename a `blocks/` folder (breaks authored content)
- Change `/api/*` endpoint paths (no versioning, breaks live site)
