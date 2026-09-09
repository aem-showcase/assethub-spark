# Rebrand Portal — Quickstart

How to run the `rebrand-portal` skill to produce a branded demo of the Assets Hub portal for a company.

## Prerequisites

- [ ] Claude Code ≥ 2.0.15 installed
- [ ] Node ≥ 20
- [ ] GitHub access to push branches and open PRs on this repo
- [ ] `cloudflare/.secrets` file with the three required secrets (see [README](../README.md#local-development))
- [ ] `token.env` file in the repo root with a valid `DA_TOKEN`:
  ```
  DA_TOKEN="..."
  ```
  Get this from your DA (Document Authoring) account at [da.live](https://da.live) — profile → API token. The file is gitignored; never commit it.
- [ ] excat plugin — if not installed, the skill will pause and tell you exactly what to run

## Invoke

Open Claude Code in the repo root and type:

```
Create a demo portal for [company] using [source URL]
```

Both the company name and the source site URL are required. The source URL is used to extract the visual style — provide it even if the assets are already in AEM.

## What happens

The skill runs a sequence of steps, asks a few questions along the way (asset source, enrichment timing), and takes around 60 minutes end to end. At the end it delivers one open PR — the branch preview URL on that PR is the demo.

The skill may pause and ask for input at a couple of points:
- **Before assets**: whether to enrich assets that are already in AEM, or pull samples from the source site, and whether to enrich them now or later
- **Excat not installed**: if the design plugin isn't present, the skill stops and gives you the exact commands to run; say "continue" once done

Progress is saved in `.internal/onboarding-state.json` (gitignored). If the session stops for any reason, reopen Claude Code and use the same trigger phrase — the skill resumes from where it left off.

## Common first-run blockers

| Symptom | Fix |
|---|---|
| Skill stops and shows `/plugin marketplace add ...` commands | Run those commands in your terminal, restart Claude Code, say "continue" |
| DA token error | Regenerate at [da.live](https://da.live), update `token.env`, say "continue" |
| Branch name rejected | Use a shorter company slug (keep the demo branch name under 33 characters total including `demo/` prefix) |
