Experience Catalyst state for this eval:

- `excat@excat-marketplace` is installed and enabled.
- `excat-complete-design-expert` is invokable in this session.
- The agent does not need to install, enable, or route to another design tool.

Brand extraction state:

- `scripts/rebrand/extract-brand.mjs` was already run against
  `https://www.heineken.com/in/en/` and exited **5 (HALT)**.
- It wrote `migration-work/brand.rejected.json`. There is **no**
  `migration-work/brand.json`.
- Re-running the extractor against the same URL produces the same halt — the
  gate is server-side and cannot be cleared programmatically (its antiforgery
  tokens defeat a scripted date-of-birth submission).
