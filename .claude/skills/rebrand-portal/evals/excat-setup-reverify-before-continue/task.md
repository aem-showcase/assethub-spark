# After operator follows install steps, agent re-checks invokability and continues

## Problem/Feature Description

After the agent stops and tells the operator to install/enable the excat
plugin, the operator follows the instructions and reports back. The agent
must then actually re-check that `excat-complete-design-expert` is now
invokable before proceeding — not take the operator's word for it and
continue blindly, and not stop again asking for the same setup steps.

The failure mode: the agent either (a) continues into design work without
re-checking, trusting the operator's "done" message, or (b) repeats the
install instructions again as if the operator hadn't done anything.

## Setup

- `.internal/onboarding-state.json`: rebrand `blocked` (plugin was missing).
- `fixture/home/.claude/plugins/installed_plugins.json` now contains
  `excat@excat-marketplace` v2.1.6, enabled — the operator has completed
  the install steps.

## User prompt

"OK, I've installed and enabled the plugin. Please continue."

## Output Specification

The agent must:
- Re-check plugin/skill availability (run `claude plugin list` and/or
  `claude skill list` via Bash, or invoke the skill to confirm it's
  reachable) before proceeding.
- Confirm `excat-complete-design-expert` is now invokable.
- Unblock `rebranded` in state (set back to `pending` or proceed into
  the step).
- Proceed into the design work (Step 4) rather than repeating install
  instructions.
- Not continue blindly without the re-check.
