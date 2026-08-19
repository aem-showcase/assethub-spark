# CONSTITUTION.md

> **Development direction and permission tiers for assethub-spark.**
> Authoritative source for what agents and contributors may do autonomously vs. what requires
> human oversight. Machine mirror: [`.agent-policy.yml`](.agent-policy.yml).
> Hard rules: [`INVARIANTS.md`](INVARIANTS.md).

---

## Development Direction

**New feature work targets:**
- `blocks/` — new EDS blocks or extending existing ones
- `cloudflare/src/origin/` — new API integrations and proxy handlers
- `scripts/` utilities (not `scripts/scripts.js` — see Supervised below)
- `tests/` — new test coverage for any of the above
- `docs/` — documentation updates

**Architectural rule — vanilla JS only:**
EDS blocks must use vanilla JavaScript. No React, Vue, Svelte, or any component framework.
The EDS/Helix architecture depends on static HTML + progressive JS enhancement via the
`decorate(block)` pattern. Introducing a framework would require a build step, break the
EDS content model, and conflict with how pages are authored in DA.

---

## Permission Tiers

### Protected — Human Only

An agent must never write these files. If a task requires changing them, stop and ask a human.

| File/Pattern | Why protected |
|---|---|
| `cloudflare/src/auth.js` | OIDC implementation — a mistake silently breaks auth for all users |
| `cloudflare/src/user.js` | Role resolution — a mistake assigns wrong permissions to all users |
| `secret.env`, `.env`, `.dev.vars`, `.secrets` | Credentials — never in source |
| `INVARIANTS.md`, `CONSTITUTION.md`, `SECURITY.md` | Guardrails — must not be weakened by an agent |
| `.agent-policy.yml` | Permission tiers — an agent must not relax its own controls |

### Supervised — Agent May Propose, Human Must Approve

An agent may edit these files and open a PR, but a human must review and approve before merge.

| File/Pattern | Why supervised |
|---|---|
| `cloudflare/src/index.js` | Middleware chain order is security-critical (auth gate position) |
| `cloudflare/src/origin/dm.js` | Contains authZ filter injection — removal leaks restricted assets |
| `cloudflare/src/config.js` | Tenant IDs (Entra, AEM, IMS) — wrong value breaks all auth |
| `cloudflare/wrangler.jsonc` | Worker routing, KV/D1/Analytics bindings, Secrets Store references |
| `cloudflare/package.json` | Worker dependencies |
| `scripts/scripts.js` | Page load pipeline affecting every page — EAGER/LAZY/DELAYED tiers, auth gate |
| `.github/workflows/**` | CI/CD pipelines — changes here affect all branch deployments |
| `.github/CODEOWNERS` | PR review routing |
| `package.json` | Root dependencies (postinstall also installs cloudflare/) |

### Autonomous — Agent Works Independently

Everything not listed above. This includes:

- `blocks/**` — new blocks, extending existing blocks, block CSS
- `scripts/**` (except `scripts/scripts.js`) — utilities, cart, collections, notifications
- `shared/**` — content transforms
- `tests/**` — unit, DOM, integration, authZ tests
- `styles/**` — global CSS
- `docs/**` — documentation
- `*.html`, `*.css` at root
- `head.html`, `404.html`
