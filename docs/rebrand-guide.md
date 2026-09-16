# Rebrand Portal — Quickstart

How to run the `rebrand-portal` skill to produce a branded demo of the Assets Hub portal for a company.

## Overview

- Creates a company-specific demo portal from the existing AEM Edge Delivery site.
- Copies the existing authored content under the company's folder.
- Matches the company's look and content direction from its source site.
- Loads the company's assets so search, filters, and collections work.
- Shares the result as a portal link.
- Does not change the shared original site.
- Does not require a production merge for the demo.
- Requires the operator machine to have the design-matching tool ready before visual matching starts.

## Prerequisites

- [ ] Claude Code ≥ 2.0.15 installed
- [ ] Node ≥ 20
- [ ] GitHub access to push branches and open PRs on this repo
- [ ] `cloudflare/.secrets` file with the three required secrets (see [README](../README.md#local-development))
- [ ] `token.env` file in the repo root with a valid `DA_TOKEN`:
  ```
  DA_TOKEN="..."
  ```
  See [Token setup](#token-setup) below for how to get this.
- [ ] excat plugin installed and enabled — see [excat setup](../.claude/skills/rebrand-portal/docs/excat-setup.md) if it's not; the skill will also pause and tell you exactly what to run if it's missing

The agent will ask you to confirm this checklist is done before it starts building a demo.

## Architecture

Open the [architecture view](../.claude/skills/rebrand-portal/docs/customer-migration-architecture.html) (local HTML file — open it in a browser).

## What you provide

- Company name.
- Source site to match visually and use for content direction.
- One DA token.
- Asset source:
  - assets already in Adobe under the company's folder
  - or a source page to pull sample images from

Both the company name and the source site URL are required. The source URL is used to extract the visual style — provide it even if the assets are already in AEM.

## Invoke

Open Claude Code in the repo root and type:

```
Create a demo portal for [company] using [source URL]
```

**Fewer interruptions.** By default the CLI pauses for tool-permission
approval as the skill works. If you'd rather it run with the minimum number
of prompts, start it with an auto-approve flag instead of the default
interactive mode:

```
copilot --autopilot --allow-all-tools
claude --permission-mode auto
```

This only changes tool-permission prompting — it does not skip the skill's
own customer-facing questions (setup confirmation, asset source/timing).

### Example prompts

- Demo with assets already in Adobe, enriched right away:

```text
Create a demo portal for Acme using https://www.acme.com for the visual style and content direction. The assets are already in Adobe, enrich them.
```

- Demo by pulling sample assets:

```text
Create a demo portal for Acme using https://www.acme.com for the visual style and content direction. Pull sample assets from https://www.acme.com/products.
```

- Rebrand now, enrich later:

```text
Create Acme's demo portal using https://www.acme.com for the visual style and content direction, but leave enrichment for a later step.
```

- Enrichment later, resumed:

```text
Now load Acme's assets from Adobe and create the collections.
```

- Vague prompt:

```text
Rebrand this for Acme.
```

- Expected response:

```text
I need Acme's source site so I can match the look and content direction.
```

## What happens

The skill runs a sequence of steps, asks a few questions along the way (asset source, enrichment timing), and takes around 60 minutes end to end. At the end it delivers one open PR — the branch preview URL on that PR is the demo.

The skill may pause and ask for input at a couple of points:
- **Before assets**: whether to enrich assets that are already in AEM, or pull samples from the source site, and whether to enrich them now or later
- **Excat not installed**: if the design plugin isn't present, the skill stops and gives you the exact commands to run (also in [excat setup](../.claude/skills/rebrand-portal/docs/excat-setup.md)); say "continue" once done

Progress is saved in `.internal/onboarding-state.json` (gitignored). If the session stops for any reason, reopen Claude Code and use the same trigger phrase — the skill resumes from where it left off.

### What the agent does

- Validates DA access.
- Creates or reuses the publish token.
- Copies authored content into the company folder.
- Updates the copied content and site styling.
- Publishes only the company folder.
- Opens a pull request for the portal build.
- Loads and labels company assets.
- Replaces copied placeholder card visuals with real company assets.
- Creates company-scoped collections after assets are searchable.

## Assets

- If assets are already in Adobe, the workflow labels them so they appear in search and filters.
- If assets are not in Adobe, provide a source page with real product or campaign images.
- Good source page example:

```text
https://example.com/products
```

- The workflow does not invent asset categories. Category links and asset labels are kept aligned.

## Collections

- Collections are created automatically after assets are searchable.
- The workflow creates one collection per category.
- Collections contain only the company's assets.
- The user does not need to ask for this as a separate step.

## Token setup

- Create `token.env` in the project root:

```env
DA_TOKEN=<token copied from da.live>
```

- Get the token:
  - Open:

```text
https://da.live/#/{org}/{site}
```

  - Example:

```text
https://da.live/#/mohitar1/assethub-spark-standalone
```

  - Sign in.
  - Open DevTools -> Network.
  - Trigger any DA request, such as:

```text
https://admin.da.live/config/{org}/...
```

  - Copy the request header:

```text
Authorization: Bearer eyJ...
```

  - Paste only the token value:

```env
DA_TOKEN=eyJ...
```

- Do not paste tokens in chat.
- Do not add `HLX_ADMIN_TOKEN` yourself.
- The workflow validates the DA token, reuses an existing publish token if valid, or creates a new one automatically.

## Portal link

- The portal link is the demo deliverable.
- It includes the company folder, login, search, filters, and collections.
- The raw AEM content origin is not the portal link.
- A production merge is optional and not required for the demo.

## How to verify it worked

- Portal link opens.
- Copied pages load under the company folder.
- Login page loads under the company folder.
- Search shows only this company's assets.
- Filters show non-zero counts.
- Category cards return matching assets.
- Collections open with company assets.
- The original shared site is unchanged.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Skill stops and shows `/plugin marketplace add ...` commands | Run those commands (see [excat setup](../.claude/skills/rebrand-portal/docs/excat-setup.md) for the full walkthrough), restart Claude Code, say "continue" |
| DA token error | Regenerate at [da.live](https://da.live), update `token.env`, say "continue" |
| Branch name rejected | Use a shorter company slug (keep the demo branch name under 33 characters total including `demo/` prefix) |
| DA token expired | DA token belongs to a user without access to the site — regenerate for the right account |
| DA token works for content but cannot create the publish token | Check the account has publish access on the site, then say "continue" |
| Source site was not provided | Give the agent a source site URL — it's required even if assets are already in Adobe |
| Assets are missing or the source page has too few usable images | Provide a source page with more real product/campaign images |
| Category card links and asset labels do not match | Flag it — the workflow does not invent categories, so this points to a labeling mismatch upstream |
| Collections were skipped after assets became searchable | Ask the agent to create collections now — it runs automatically once enrichment completes, but can be re-triggered |
