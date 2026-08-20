# CLAUDE.md

> **Canonical source: [`AGENTS.md`](AGENTS.md)**
>
> This file is a Claude Code entry point. Full conventions, architecture, agent boundaries,
> and git workflow live in `AGENTS.md`. Read it first. The quick-reference below covers
> only the most critical facts for when `AGENTS.md` is not in context.

---

## Quick Reference

**What this repo is:** Enterprise DAM portal at `frescopamedia.com`.
Vanilla JS + AEM EDS/Helix frontend, Cloudflare Worker edge gateway, Adobe ContentAI search.

**Build & test:**
```bash
npm ci                              # install (root + cloudflare/ via postinstall)
npm test && npm run lint            # unit + DOM tests + lint
cd cloudflare && npm test           # worker tests
npm run test:integration:local      # integration tests (requires session cookie in .env)
```

**Commit format:** `GH-NNN : brief description` (present tense, lowercase, ≤72 chars)

**Must-not-touch (protected — ask a human):**
- `cloudflare/src/auth.js` — OIDC implementation; mistake = silent auth bypass
- `cloudflare/src/user.js` — role resolution; mistake = wrong permissions for all users
- `secret.env`, `.env`, `.dev.vars`, `.secrets` — never read, never modify, never commit

**Where config lives:**
- Worker secrets → Cloudflare Secrets Store (never in code)
- Worker static config (tenant IDs, env) → `cloudflare/src/config.js`
- Worker routes and bindings → `cloudflare/wrangler.jsonc`
- Auth permissions (who can access what) → EDS spreadsheets at `/config/access/*` (fetched at runtime)

**Key pattern — EDS blocks:**
Every block exports `decorate(block)`. Vanilla JS only. No JSX, no framework.
Block folder name = CSS class in authored content — never rename without coordinating content.
