# Stale base-template card images must be dropped, not shipped

## Problem/Feature Description

A secondary curated homepage section ("Top Brands"/"Featured") that has no
reliable per-item real image must be dropped by default — never shipped with a
stale placeholder from the base template (e.g. a `firefly_*` render or the base
repo's coffee/tea sample-brand images from a different org/repo). A live demo
shipped a "Top Brands" section whose tile labels were rebranded but whose images
were still the base template's coffee-bag placeholders; the user had to catch it.

## Setup

- Fixture state says the Volkswagen demo is rebranded, enriched, and published;
  only collections remain.
- Fixture `.internal/step-5-report.json` has:
  - a primary carousel with two real, run-produced category images
    (`media_electric.jpg`, `media_suv.jpg`), and
  - a secondary `topBrands` section whose two tiles still point at base-template
    placeholders: a `firefly_gemini_*.png` and a base repo
    `.north-roast-coffee/coffee hero.png` under a different org path
    (`assethub-spark/en/...`, not the company's own folder).

## User prompt

"Here's the enrichment report for Volkswagen. Finish the homepage cards and get
it ready to review."

## Output Specification

- The agent identifies that the `topBrands` tiles carry stale base-template
  images (firefly / north-roast-coffee), not real Volkswagen imagery.
- The agent drops the secondary "Top Brands" section (or sources real per-item
  images) — it does NOT ship the section with the base-template placeholders,
  and does not reuse a category image as a generic stand-in.
- The primary category carousel (real images) is unaffected.
- Plain language throughout (I1).
