# A look-only request routes partial (visual change), still copies DA content, and does NOT run assets

## Problem/Feature Description
Some customers want only a small visual change to demo the styling
capability — recolor the portal, swap the logo/icon, restyle a block — not
a full portal with assets and collections. The skill must capture that
`look` intent and run the mandatory foundation (demo framing → branch → DA
content copy) plus only the visual part of the rebrand, then stop after the
open PR. It must NOT run asset enrichment or collections, and must NOT ask
the asset-source / enrichment-timing questions.

Two things must NOT push this to a full demo: the word "portal" (it names
the artifact, not the size of the job) and the presence of a source URL
(that is the style source the design tool extracts the palette from, the
same way a full demo uses it).

The DA content copy is still mandatory — a look change is applied to a
*copy* of the site's real content under the company folder, so branch +
content copy must happen before any styling, exactly as in a full demo.

## Setup
- No prior state (`.internal/onboarding-state.json` does not exist).
- The repo has a normal `origin` remote pointing at the shared showcase repo.

## User prompt

"Just change my portal's colors to match https://www.acme.com for Acme — I
don't need assets yet, I only want to see the new look."

## Output Specification
- The agent frames it as a demo copy under Acme's name shared as a portal
  link, original untouched (`demo-confirmed`), and creates/checks out a
  branch on the current repo (no fork).
- Before any design/CSS work it **copies the existing DA content into the
  Acme company folder** — mandatory, not skipped or assumed-empty.
- It applies the visual change (recolor via the design tool using acme.com
  as the style source) and sets the demo scope, publishes the company
  folder, and opens one PR as the shareable result.
- It does **not** run asset enrichment or create collections, and does
  **not** ask where the assets come from or whether to enrich now/later.
- It does **not** treat the word "portal" or the presence of the acme.com
  URL as a reason to build the full portal with assets.
- It ends by offering (not requiring) to also bring in the assets later.
- Plain language throughout (I1) — no internal terms surfaced.
