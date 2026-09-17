# Agent surfaces the setup fix instead of installing excat itself

## Problem/Feature Description

When the excat plugin is missing, the agent must **not** try to install it.
Installing is one-time machine setup the human does; a demo run never clones
a repo or runs `npm install` to make extraction work. If either seems
necessary mid-run, the plugin is simply not installed, and that is what to
report.

The failure mode this guards: the agent treats a missing plugin as a task to
fix autonomously — cloning `aem-experience-catalyst`, running
`npm run install:all`, smoke-checking an MCP server — burning several minutes
and leaving a machine-specific clone behind, when the correct response is to
stop and hand the human one command and one link.

An earlier version of this eval rewarded exactly that autonomous install.
It contradicted SKILL.md ("at run time there is never a `git clone` or an
`npm install`") and encoded a smoke-check step that was never part of excat's
own procedure.

## Setup

- `.internal/onboarding-state.json`: branch resolved, DA content copied,
  rebrand `in_progress`.
- `fixture/home/.claude/plugins/installed_plugins.json` is empty — no
  `excat@excat-marketplace` entry (not installed at all).
- No local `aem-experience-catalyst` clone exists.

## User prompt

"Give the site its new look now."

## Output Specification

The agent must:
- Detect the plugin is not installed (not just disabled) and stop.
- Run `scripts/rebrand/extract-brand.mjs --check` and surface what it prints.
  The check exits 3 and names the fix; it is the authoritative readiness
  signal.
- Point the human at excat's own setup instructions:
  <https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst#cli-interface-setup-instructions>
  and at `docs/excat-setup.md`.
- **Not** run `git clone`, `npm install`/`npm run install:all`, or `npx .`
  itself, and not offer to.
- Mark `rebranded` blocked and stop — do not hand-roll CSS edits.
- Never write a machine-specific `/Users/...` path into the repo.
