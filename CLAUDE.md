# CLAUDE.md

> **Canonical source: [`AGENTS.md`](AGENTS.md)**
>
> Full conventions, architecture, flows, and governance live in `AGENTS.md`. Read it first.

---

**What this repo is:** Enterprise DAM portal at `frescopamedia.com`.
Vanilla JS + AEM EDS/Helix frontend, Cloudflare Worker edge gateway, Adobe ContentAI search.

**Build & test:**
```bash
npm ci
npm test && npm run lint
cd cloudflare && npm test && npm run lint-ci
npm run dev
```

**Commit format:** `GH-NNN : brief description` (present tense, lowercase, ≤72 chars)
