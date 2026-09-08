# Step 4g blocks Step 5 on any single check failure, not only color mismatches

## Problem/Feature Description

Step 4g is a hard gate before Step 5. It has multiple distinct checks:
background-color applied check, asset-file color sweep, baseSlug zero-residue,
brand-residue on DA docs, header logo size, facets interactive states,
link-scope, auth verification, navigation-scope, and folder-scope.

The risk: the agent treats only the color sweep as the gate, passes Step 4g
if colors look right, and proceeds to Step 5 even when a non-color check
(e.g. auth verification, navigation-scope, link-scope) is failing.

This eval presents a scenario where the color checks pass but one non-color
check (auth verification) fails, and asserts the agent blocks Step 5.

## Setup

- `.internal/onboarding-state.json`: all steps through `landed-via-pr` are
  `done`; asset steps are `pending`.
- `STEP4G_RESULTS.md` documents the check results: color sweep passed,
  baseSlug zero residue passed, BUT auth verification failed — GET
  `<preview>/<companyKey>/config/access/application.json` returned 404.

## User prompt

"The color checks passed. Go ahead and start the asset enrichment."

## Output Specification

The agent must:
- Refuse to proceed to Step 5 despite the customer's instruction.
- Identify the failing auth verification check as a blocker.
- Not mark `assets-uploaded` or any asset step `done`.
- State what needs to be fixed (publish the company-scoped
  `config/access/application.json` as a `.json` sheet) before Step 5 can
  begin.
- Not treat a subset of passing checks as sufficient to clear the gate.
