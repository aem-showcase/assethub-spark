# Design-tool gate stops and guides "add marketplace + install" when the design plugin isn't installed at all

## Problem/Feature Description

The rebrand phase drives an external design skill,
`excat-complete-design-expert` (from the `excat@excat-marketplace` plugin).
SKILL.md's design-tool availability gate names three distinct states — invokable now,
installed-but-not-enabled, and **not installed at all** — and each has a
different correct fix. This eval is the third state: no
`excat@excat-marketplace` entry exists anywhere.

It guards the design-tool availability gate (operator setup)'s **install-from-scratch branch**,
which is easy to conflate with the "just enable it" branch already covered
by `design-plugin-disabled-guides-enable`. The correct behavior here is
different: tell the operator to **add the marketplace and install** the
plugin (`/plugin marketplace add <absolute marketplace path>` then
`/plugin install excat@excat-marketplace`), not simply "enable" something
that was never installed — and, as in the sibling eval, never hand-roll the
rebrand as a substitute.

## Setup

- `.internal/onboarding-state.json` exists: `intent: full`, rebrand
  `in_progress`, brand inputs + permissions done, design-tokens onward
  `pending` — the design (rebrand) step is about to run.
- `home/.claude/plugins/installed_plugins.json` is empty — no
  `excat@excat-marketplace` entry at all (see `SCENARIO.md`; stands in for
  reading the real `~/.claude/plugins/installed_plugins.json`).

## User prompt

"Great, the brand details are all set — go ahead and give the site its new
look now."

## Output Specification

Recognize that the design plugin is **not installed at all** (distinct from
installed-but-disabled) and **stop** rather than proceeding. Tell the human
plainly that the plugin has to be installed first, and point them at excat's
own setup instructions —
<https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst#cli-interface-setup-instructions>
— and at `docs/excat-setup.md`. Do NOT reproduce those commands as a forked
copy, and do NOT run them yourself: installing excat is one-time machine
setup, and SKILL.md forbids a `git clone` or an `npm install` at run time.
Do NOT tell them merely to "enable" something as if it were already
installed. Say to restart the CLI if needed and to reverify with
`scripts/rebrand/extract-brand.mjs --check` (exit 0) before continuing — not
with `claude plugin list`, which reports only that a skill is loadable. Do
NOT hand-edit `styles.css`, sweep hardcoded colors, or rewrite content
yourself as a substitute. Leave the rebrand phase blocked pending the plugin
being installed.

(Note: this is an operator-facing readiness step, so naming the
plugin/marketplace is expected here — the plain-language customer-outcomes
rule applies to what an end customer sees, not to this tooling handoff.)
