# AGENTS.md

> **Single Source of Truth.** This file governs all AI agents working in this repository.
> `CLAUDE.md` and `.github/copilot-instructions.md` point here — update this file first
> when conventions change, then sync the summaries in those files.
>
> **Tool-agnostic by design.** Any AGENTS.md-aware agent — Claude Code, GitHub Copilot
> Workspace, OpenAI Codex, Cursor, Gemini, Windsurf, Aider — works from this single file.

---

## What This Repo Is

**Assets Hub Spark** is a production enterprise DAM portal at **[frescopamedia.com](https://frescopamedia.com)**.

Users are employees, contractors, agencies, and partners who browse, search, download, and
request usage rights for branded assets. Key features: semantic asset search (Adobe ContentAI),
faceted filtering, shopping cart, collections, rights request workflow, admin reporting, RBAC,
and i18n (English + Japanese).

**Tech stack:**
- **Frontend:** Vanilla JS + AEM Edge Delivery Services (EDS/Helix) — no framework, no build step
- **Edge gateway:** Cloudflare Worker (itty-router v5) — all requests go through it
- **Asset backend:** Adobe Dynamic Media / ContentAI API
- **Auth:** Microsoft Entra ID (OIDC), session JWT in `Session` cookie (HS256, 6h)
- **Storage:** Cloudflare KV (saved searches, IMS tokens), D1 (user logins, audit, search events), Analytics Engine

---

## Architecture

Three layers — every request flows through all three:

- **Browser / EDS frontend** (`blocks/`, `scripts/`, `styles/`) — Vanilla JS + AEM Edge Delivery Services. No build step, no framework. Blocks are `<div class="{name}">` elements decorated by `blocks/{name}/{name}.js`.
- **Cloudflare Worker gateway** (`cloudflare/src/`) — itty-router v5. Auth (OIDC), AuthZ filter injection, API proxy, KV/D1/Analytics writes. Every request to `frescopamedia.com` passes through it.
- **Adobe backends** — Dynamic Media / ContentAI (asset search), IMS (OAuth tokens), AEM authoring environment (spreadsheets, content).

Full design, request lifecycle, storage bindings, and deployment: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Documentation

Read these before changing code in an area — directories are the stable addresses; specific
files are listed as hints in Notes.

| If your task touches… | Where to look | Notes |
|-----------------------|---------------|-------|
| **Any non-trivial change** — orient first | [ARCHITECTURE.md](ARCHITECTURE.md) | Complete system design, request lifecycle, all integrations |
| **Auth** — OIDC login/callback, session JWT | `cloudflare/src/` | `auth.js`, `user.js` — **protected, read only** |
| **Authorization** — role checks, brand/country filters | `cloudflare/src/origin/` | `dm.js` (`searchContentAIAuthorization`); `scripts/scripts.js` (`checkPageAccess`) |
| **Cloudflare Worker routing** — middleware, new routes | `cloudflare/src/` | `index.js` — middleware order is security-critical |
| **Asset search** — ContentAI query, facets, filters | `blocks/search-results/` · `cloudflare/src/origin/` | `clients/dynamicmedia-client.js`, `dm.js` |
| **EDS blocks** — new block, extending a block | `blocks/` | `{name}/{name}.js` — see Key Flows for the `decorate(block)` pattern |
| **Page load pipeline** — EAGER/LAZY/DELAYED | `scripts/` | `scripts.js` — changes here affect every page |
| **Cart** — cross-tab sync, localStorage | `scripts/` | `cart-state.js`, `utils/cart-service.js` |
| **Collections** — create, share, ACL | `scripts/collections/` · `cloudflare/src/origin/` | `collections.js` |
| **Notifications / rights requests** | `scripts/notifications/` · `cloudflare/src/origin/` | `notifications.js` |
| **Tests** — how to run, which type to add | [docs/testing/TESTING.md](docs/testing/TESTING.md) | |
| **Block/JS conventions** | [docs/coding-rules.md](docs/coding-rules.md) | |
| **Cloudflare Worker flows** deep dive | [docs/architecture/CLOUDFLARE-FLOW.md](docs/architecture/CLOUDFLARE-FLOW.md) | Auth, AuthZ, IMS caching |
| **Permission tiers + hard rules** | [`.agent-policy.yml`](.agent-policy.yml) · [INVARIANTS.md](INVARIANTS.md) | |

When you change behavior, **update the matching doc in the same PR** so it stays accurate.

---

## Key Flows

### EDS Block Decoration Pattern
Every block is a folder under `blocks/{name}/` with a `{name}.js` exporting `decorate(block)`:
```js
// blocks/my-block/my-block.js
export default async function decorate(block) {
  // block is the <div class="my-block"> element from the authored page
  // 1. Read block content (table rows become div children in EDS)
  // 2. Build state (custom pub/sub — no framework)
  // 3. Render DOM (document.createElement, no JSX)
  // 4. Attach listeners
}
```
Blocks share state via `window.*` globals or imports — never via the DOM.

### Page Load Pipeline (scripts/scripts.js)
```
EAGER  → loadUser() → checkPageAccess() → loadHeader() → loadFirstSection()
LAZY   → loadFooter() → loadSections() → initCart()
DELAYED (3s) → checkNotifications() → provisionAEMUser()
```

### Auth Flow (Cloudflare Worker)
```
GET /auth/login → generate nonce + state JWT → set State cookie → 302 to Entra
POST /auth/callback ← Entra sends id_token (form-encoded)
  → validate JWT signature (JWKS) + state param + expiry
  → resolve roles from Entra claims + EDS spreadsheets
  → create session JWT (HS256, COOKIE_SECRET) → set Session cookie (HttpOnly, Secure)
  → 302 → /
```

### ContentAI Search (includes AuthZ filter injection)
```
Browser → POST /api/adobe/assets/contentai/search
  → withAuthentication validates Session cookie
  → searchContentAIAuthorization() injects brand/country/customer filters
  → proxy to Adobe ContentAI API
  → fire-and-forget analytics (ctx.waitUntil)
  → return results
```

### IMS Token Caching
```
getIMSToken() → check KV AUTH_TOKENS:ims-token
  ├─ hit + expires > 5 min → return cached
  └─ miss/expiring → POST to Adobe IMS → cache in KV (24h TTL) → return
```

---

## Build & Test Commands

```bash
# Install (root + cloudflare/ via postinstall)
npm ci

# Unit + DOM tests (root)
npm test

# Lint (JS + CSS)
npm run lint

# Cloudflare Worker tests + lint
cd cloudflare && npm test && npm run lint-ci

# Integration tests (requires live session cookie in .env)
npm run test:integration:local

# AuthZ tests (13 user personas, requires SUDO cookie)
npm run test:authz

# Local dev (EDS proxy + Worker)
npm run dev
```

---

## What Agents May Do

- Add new EDS blocks in `blocks/` (new folder + JS + CSS, following decorate(block) pattern)
- Add or extend utilities in `scripts/` (except `scripts/scripts.js` — supervised)
- Add or extend tests in `tests/` and `scripts/__tests__/`
- Update `shared/` content transforms
- Update `styles/` CSS
- Update documentation in `docs/`
- Fix bugs in existing blocks and scripts

## Guardrails

Three governance files define the hard rules:

- [`INVARIANTS.md`](INVARIANTS.md) — non-negotiable rules (auth gates, endpoint paths, secrets, CI)
- [`.agent-policy.yml`](.agent-policy.yml) — permission tiers (Protected / Supervised / Autonomous)
- [`SECURITY.md`](SECURITY.md) — threat register for agent-assisted development

**Most important direction:** the frontend must remain **vanilla JS — no React, Vue, or any SPA framework** in EDS blocks. The EDS/Helix architecture depends on static HTML + progressive JS enhancement.

---

<!-- upskill:skills:start -->
## Skills

You have access to a set of skills in .claude/skills. Each skill consists of a SKILL.md file, and other files such as scripts and resources, which are referenced from there.

**YOU ARE REQUIRED TO USE THESE SKILLS TO ACCOMPLISH DEVELOPMENT TASKS. FAILING TO DO SO WILL RESULT IN WASTED TIME AND CYCLES.**

### How Skills Work

Each skill is a directory in `.claude/skills/` with the following structure:

```
.claude/skills/
  └── {skill-name}/
      ├── SKILL.md        # Main instructions (required)
      ├── scripts/        # Optional supporting scripts
      └── resources/      # Optional resources (examples, templates, etc.)
```

The SKILL.md file contains detailed instructions that you must follow exactly as written. Skills are designed to:
- Provide specialized workflows for common tasks
- Ensure consistency with project standards and best practices
- Reduce errors by codifying expert knowledge
- Chain together when tasks require multiple skill applications

### Skill Discovery and Execution Process

Always use the following process:

1. **Discovery**: When a new conversation starts, discover available skills by running `./.agents/discover-skills`. This script will show you all available skills with their names, paths, and descriptions without loading everything into context.

2. **Selection**: Use each skill based on its name and description when it feels appropriate to do so. Think carefully about all the skills available to you and choose the best ones to use. Note that some skills may reference other skills, so you may need to apply more than one skill to get things done.

3. **Execution**: When you need to use a skill:
   - Read the full SKILL.md file
   - Announce you are doing so by saying "Using Skill: {Skill Name}"
   - Follow the skill's instructions exactly as written
   - Read any referenced resources or scripts as needed
   - Complete all steps in the skill before moving to the next task

### Available Skills

Skills will be added to `.claude/skills/` as needed for this project. Check the `.claude/skills/` directory or run `./.agents/discover-skills` for the current list of available skills.

**For ALL development work involving blocks, core scripts, or functionality, you MUST start with the content-driven-development skill.** It will orchestrate other skills as needed throughout the development workflow.
<!-- upskill:skills:end -->
