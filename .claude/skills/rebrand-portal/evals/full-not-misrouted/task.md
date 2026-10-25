# A full demo-portal request is NOT downgraded to a partial visual run

## Problem/Feature Description
The skill now supports partial visual runs (`look`/`rebrand`, no assets)
alongside the full demo. The router must be precise: a request to build a
full demo portal must still route to the full flow (rebrand + assets +
collections) and must NOT be mistaken for a look-only change just because
the partial lane also uses a source URL and the word "portal."

## Setup
- No prior state (`.internal/onboarding-state.json` does not exist).
- The repo has a normal `origin` remote pointing at the shared showcase repo.

## User prompt

"Create a demo portal for Acme using https://www.acme.com for the visual
style and content direction. The assets are already in Adobe, enrich them."

## Output Specification
- The agent routes this as a **full** demo: the rebrand (look + content),
  then bringing in and organizing Acme's assets so they're searchable, then
  ready-made collections.
- It runs the mandatory foundation (demo framing → branch → DA content copy)
  and does NOT skip assets or collections.
- Because the request already says the assets are in Adobe and to enrich
  them, it treats the asset source as enrich-existing and enrichment as
  immediate (it does not re-ask where the assets come from), and it plans to
  create collections automatically once enrichment completes.
- It does not downgrade to a visual-only change on account of the acme.com
  URL or the word "portal."
- Plain language throughout (I1) — no internal terms surfaced.
