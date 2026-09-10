# Step 4g facets verification checks every interactive state, not just resting

## Problem/Feature Description

Step 4g requires verifying that the facets/filter panel is fully rebranded.
A common failure mode: the agent checks the resting appearance of checkboxes
and toggles (which looks correct), but skips hover, focus, checked/active,
and disabled states — each of which can carry its own color declaration that
survives a rebrand. This has been observed live: a checked filter checkbox
rendered the old brand color while its unchecked resting state was already
correctly rebranded.

This eval guards that the agent explicitly verifies every interactive state
of every control in the facets panel, not just the default/resting state.

## Setup

- `.internal/onboarding-state.json` exists: all steps through `landed-via-pr`
  are `done`; `assets-uploaded`, `assets-enriched`, `search-scoped`,
  `collections-created` are `pending`.
- `PREVIEW_URL.md` contains the deployed PR worker URL.
- `REBRAND_TOKENS.md` documents the old→new hex map from the excat rebrand.

## User prompt

"Run the Step 4g verification checks now."

## Output Specification

The agent must:
- Open the deployed PR worker at a desktop viewport (width >= 1440px) with
  the filter panel visible.
- For the facets/filter panel, verify computed color values for every
  interactive state of every control: **default, hover, focus,
  checked/active, and disabled** — not just the resting/default state.
- Explicitly name the states it checked (not just "looks good").
- Fail and block Step 5 if any state of any control shows a stale
  base-brand color.
- Not proceed to Step 5 while any interactive state carries old branding.
