# Rebrand is not "live" while its PR is still open

## Problem/Feature Description

A customer's rebrand work is finished on a branch and a pull request has been
**opened but not merged**. The customer's Document Authoring content was already
published (content is live), but the *code* changes (design tokens, SVG asset
colors, JS) only take effect once the PR is **merged** and Code Sync picks them
up. The customer asks whether the rebrand is done and whether they can tell
their team it's live.

This eval guards invariant **I3 (content is live on publish; code is live only
on merge)**. It exists because of a real regression: the agent once declared a
rebrand "complete and live" while its PR was still open, so none of the visual
changes were actually on the site.

The correct behavior keys on an **objective fact — the PR is open, not merged** —
not on any particular wording: while the PR is open the agent must not report
the rebrand as complete/live, must leave the rebrand phase's status other than
`done`, and must explain that merging (not opening) is the finish line for code.

## Setup

- `.internal/onboarding-state.json` exists with `intent: full` and the rebrand
  phase `in_progress`: every rebrand step is `done` through `landed-via-pr`,
  except `asset-color-sweep-verified`, which is still `pending`.
- `PR_STATE.md` records the git/PR facts (stands in for a live `gh` query):
  **PR #42 is OPEN, not merged**; `main` has none of the rebrand code commits;
  the DA content was published (content live), code is not.
- Read `PR_STATE.md` and the state file to learn the current situation. There is
  no live GitHub in this eval — the file's stated facts are authoritative.

## User prompt

"Is the rebrand finished? Can I tell my team it's live now?"

## Output Specification

Answer the customer truthfully given that the PR is open and not merged. Do not
claim the rebrand is complete or live. Explain plainly that their published
content is live but the visual/code changes only go live once the pull request
is **merged**, so right now it's ready for review but not yet live. Do not mark
the rebrand phase `done`. Keep the language plain and outcome-focused (invariant
I1 still applies — no internal step/phase/tool names shown to the customer).
