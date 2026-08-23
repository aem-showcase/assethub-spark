# AGENTS.md

> **Single Source of Truth.** This file governs all AI agents working in this repository.
> `CLAUDE.md` and `.github/copilot-instructions.md` point here — update this file first
> when conventions change, then sync the summaries in those files.
>
> **Tool-agnostic by design.** Claude Code (`CLAUDE.md`) and GitHub Copilot
> (`.github/copilot-instructions.md`) read this today; any other AGENTS.md-aware agent
> works from this single file too.

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
| **Any non-trivial change** — orient first | [ARCHITECTURE.md](ARCHITECTURE.md) | |
| **Auth** — OIDC login/callback, session JWT | `cloudflare/src/` | `auth.js`, `user.js` — read only |
| **Authorization** — role checks, brand/country filters | `cloudflare/src/origin/` · `scripts/` | [ARCHITECTURE.md §6](ARCHITECTURE.md#6-authorization) — 8 AuthZ layers |
| **Cloudflare Worker routing** — middleware, new routes | `cloudflare/src/` | [ARCHITECTURE.md §4](ARCHITECTURE.md#4-cloudflare-worker--edge-gateway) — middleware order is security-critical |
| **Asset search** — ContentAI query, facets, filters | `blocks/search-results/` · `cloudflare/src/origin/` | |
| **EDS blocks** — new block, extending a block | `blocks/` | See Key Flows below for the `decorate(block)` pattern |
| **Page load pipeline** — EAGER/LAZY/DELAYED | `scripts/` | Affects every page |
| **Cart** — cross-tab sync, localStorage | `scripts/` | |
| **Collections** — create, share, ACL | `scripts/collections/` · `cloudflare/src/origin/` | |
| **Notifications / rights requests** | `scripts/notifications/` · `cloudflare/src/origin/` | |
| **Tests** — how to run, which type to add | [docs/testing/TESTING.md](docs/testing/TESTING.md) | |
| **Block/JS conventions** | [docs/conventions.md](docs/conventions.md) | |
| **Permission tiers + hard rules** | [`.agent-policy.yml`](.agent-policy.yml) · [AGENTS.md § Guardrails](#guardrails) | |

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

**Definition of done — verify before you stop.** Don't stop at "looks done": run `npm test && npm run lint`
(and `cd cloudflare && npm test && npm run lint-ci` if you touched the Worker), then fix any failures.
Show the command output as evidence. If you changed an API/auth path, also run the relevant
`npm run test:integration:local` / `npm run test:authz`.

---

## Code Conventions

- ALWAYS export `decorate(block)` as default from `blocks/{name}/{name}.js` — block folder name = CSS class in authored documents, never rename without a coordinated DA content update
- ALWAYS include `.js` extension in import paths — airbnb-base ESLint enforces it
- ALWAYS use `ctx.waitUntil()` for analytics writes in the Worker — never `await` on the response path
- NEVER set `innerHTML` with API-returned or user-supplied data — use `textContent` or `createElement`
- NEVER hardcode user-visible strings in block JS — use `getAppLabel(key)` from `scripts/locale-utils.js`
- NEVER hardcode role logic in the Worker — add rows to EDS spreadsheets under `/config/access/*`
- PREFER the custom pub/sub pattern (`getState/setState/subscribe`) over any state library — see `blocks/search-results/search-results.js`
- PREFER URL search params for shareable state; use `localStorage` only for preferences and cart

Full reference: [`docs/conventions.md`](docs/conventions.md)

---

## Guardrails

Two governance files define the enforcement mechanism:

- [`.agent-policy.yml`](.agent-policy.yml) — permission tiers (Protected / Supervised / Autonomous)
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability + threat register for agent-assisted development

### Invariants — non-negotiable

These apply to everyone, humans and agents alike. Enforced by `.gitignore`, CI
(`.github/workflows/build.yaml`), and CODEOWNERS. Never lower the bar; raise it.

1. **Never commit secrets.** `COOKIE_SECRET`, `DM_CLIENT_ID`, and `DM_CLIENT_SECRET` live only in Cloudflare Secrets Store — never in source, `wrangler.jsonc`, or any committed file. `secret.env`, `.env`, `.dev.vars`, `.secrets` stay gitignored. `COOKIE_SECRET` signs session JWTs; a leak lets any user's session be forged.
2. **Never bypass `withAuthentication`.** In `cloudflare/src/index.js` it must stay **after** the public routes (`/auth/*`, `/public/*`, `/scripts/*`, `/styles/*`, `/blocks/*`, `/icons/*`, `/fonts/*`) and **before** all `/api/*` handlers and the catch-all. No handler may skip it by moving above it or by adding a public-route pattern for an API endpoint.
3. **Never disable CI checks.** `npm test`, `npm run lint`, `cd cloudflare && npm test`, and `cd cloudflare && npm run lint-ci` must stay active and passing in `.github/workflows/build.yaml` — no commenting out, no `continue-on-error: true`, no skip `if:` conditions.
4. **Never remove AuthZ filters from `dm.js`.** `searchContentAIAuthorization()` injects brand, country, and customer filters into every ContentAI search — the primary guard against restricted assets leaking to unauthorized users. Don't weaken it even temporarily for debugging; use the SUDO impersonation mechanism in tests instead.

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
