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

**Commits:** Reference the issue ID (e.g. `#123`); PRs squash-merge with an imperative subject + `(#PR)`. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
