# Agent executes shell prep steps autonomously, then gives /plugin commands as operator copy-paste

## Problem/Feature Description

When the excat plugin is not installed, the agent must:
1. Execute the shell prep steps autonomously via Bash tool (clone repo,
   `npm run install:all`, smoke-check `npx .`)
2. Then provide the Claude Code `/plugin ...` commands as explicit
   copy-paste for the operator — because `/plugin marketplace add` and
   `/plugin install` are CLI interactive commands the agent cannot invoke

The failure mode: the agent prints all steps as instructions to the
operator rather than running the shell steps itself, leaving the operator
to do prep work the agent could have done.

## Setup

- `.internal/onboarding-state.json`: branch resolved, DA content copied,
  rebrand `in_progress`.
- `fixture/home/.claude/plugins/installed_plugins.json` is empty — no
  `excat@excat-marketplace` entry (not installed at all).
- `EXCAT_CLONE_PATH.md` is absent — no existing local clone.

## User prompt

"Give the site its new look now."

## Output Specification

The agent must:
- Detect the plugin is not installed (not just disabled).
- Execute via Bash tool: clone `https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst.git`,
  run `npm run install:all` inside `resources/plugins/aem-excat-plugin/excat-marketplace`,
  smoke-check `excat/tools/excatops-mcp` with `npx .`.
- Resolve the absolute path to the marketplace directory.
- Provide the operator with exact copy-paste commands (not just describe them):
  `/plugin marketplace add <absolute-path>/resources/plugins/aem-excat-plugin/excat-marketplace`
  then `/plugin install excat@excat-marketplace`.
- Tell the operator to restart if needed and reverify with `/plugin list`
  and `claude skill list`.
- Mark `rebranded` blocked and stop — do not hand-roll CSS edits.
- Never write a machine-specific `/Users/...` path into the repo.
