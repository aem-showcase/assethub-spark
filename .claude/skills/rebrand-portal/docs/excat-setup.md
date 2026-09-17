# Experience Catalyst Setup

## Purpose

- Install and verify the Experience Catalyst plugin used for design matching.
- This is operator/agent-host setup, not customer setup.
- Do not put machine-specific paths, Bedrock tokens, or generated settings into
  the project repo.

## Check First

- Inside Claude Code:

```text
/plugin list
```

- From a shell where Claude Code is installed:

```bash
claude plugin list
claude skill list
```

- Continue only when `excat@excat-marketplace` is installed/enabled and
  `excat-complete-design-expert` is invokable in the current session.

## What "set up" actually has to mean

**"The skill is invokable" is not the success criterion, and treating it as one
is what let every observed failure through.** In 13 consecutive live runs the
skill loaded correctly and its extraction step was then abandoned anyway. The
check was green every time and no colour was ever measured.

The criterion that matters is that **the extractor and its browser are present
on disk**, because that is what `scripts/rebrand/extract-brand.mjs` consumes:

```bash
node -e 'import("./.claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs").then(m=>console.log(m.resolveExcatRoot()||"NOT FOUND"))'
```

A path means you are ready. Confirm the two artifacts under it:

```bash
EX=<the path printed above>
ls "$EX/sub-agents/excat-block-design-expert/brand-extract.js"
ls "$EX/hooks/import-validator/node_modules/playwright/index.mjs"
```

**Installing the plugin is the whole dependency.** It ships both the extractor
and a bundled Playwright/Chromium. **At run time there is no `git clone` and no
`npm install`** — if you find yourself reaching for either to make extraction
work, stop: the plugin is either not installed or not enabled, and that is the
thing to fix.

The clone below is a **one-time marketplace bootstrap**, needed only because
this plugin is distributed as a local directory marketplace rather than a
remote one. It is how the marketplace gets registered the first time; it is not
part of any demo run, and a machine that already has the plugin never needs it.

## Agent-First Install (one-time marketplace bootstrap)

- Use an existing local clone if present.
- If no clone exists, clone the Experience Catalyst repo to an operator-owned
  local path.
- Example:

```bash
EXCAT_REPO="${EXCAT_REPO:-$HOME/src/aem-experience-catalyst}"
test -d "$EXCAT_REPO/.git" || git clone https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst.git "$EXCAT_REPO"
cd "$EXCAT_REPO/resources/plugins/aem-excat-plugin/excat-marketplace"
npm run install:all
cd excat/tools/excatops-mcp
npx .
```

- Stop `npx .` after it starts successfully.
- Resolve the absolute marketplace path:

```bash
cd "$EXCAT_REPO"
pwd
```

- The marketplace path is:

```text
<absolute-path-to-aem-experience-catalyst>/resources/plugins/aem-excat-plugin/excat-marketplace
```

## Claude Code Install

- In Claude Code:

```text
/plugin marketplace add <absolute-path-to-aem-experience-catalyst>/resources/plugins/aem-excat-plugin/excat-marketplace
/plugin install excat@excat-marketplace
/plugin list
```

- If the plugin is installed but not enabled:

```text
/plugin enable excat@excat-marketplace
```

- Restart Claude Code if the skill list does not update immediately.
- Recheck:

```text
/plugin list
```

```bash
claude skill list
```

## Claude Code Prereqs

- Node 20 or newer.
- Claude Code 2.0.15 or newer.
- If the environment uses AWS Bedrock, configure credentials only in the
  operator's user-home Claude settings. Do not add Bedrock tokens to this repo.

## Hard Rule

- A source website URL is enough input for design matching.
- **Measure the source site before editing the theme.** Run
  `scripts/rebrand/extract-brand.mjs --url <sourceUrl>` and produce
  `migration-work/brand.json` with `gatePassed: true`. A loaded skill is not a
  measured brand (invariant I10). `hooks/guard-brand-extraction.sh` enforces
  this.
- **A missing `page-templates.json` is not a blocker.** excat's own `SKILL.md`
  says to pass `[]`, and the extractor defaults to it. This was cited as the
  reason for abandoning extraction in every run where it was abandoned.
- **Never `git clone` or `npm install` excat to make a demo work.** The
  installed plugin already carries the extractor and the browser.
- Do not ask the user for colors or palette while Catalyst is available.
- Do not treat a generic WebFetch failure as a blocker.
- Do not route this work to DesignSync.
- **Treat a denial, failure, or unavailability of the skill as a halt.** One
  observed run had its skill spawn denied by a classifier, absorbed the denial
  silently, and continued from recalled brand knowledge.
