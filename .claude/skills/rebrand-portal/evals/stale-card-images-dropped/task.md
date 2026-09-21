# Stale base-template card images must never ship

## Problem/Feature Description

A secondary curated homepage section ("Top Brands"/"Featured") has no reliable
per-item real image, so it must never ship with a stale placeholder from the
base template (e.g. a `firefly_*` render or the base repo's coffee/tea
sample-brand images from a different org/repo). A live demo shipped a "Top
Brands" section whose tile labels were rebranded but whose images were still the
base template's coffee-bag placeholders; the user had to catch it. It then
recurred on a later demo.

The card-authoring tool now removes that block outright, so the defect is
unrepresentable **on the supported path**. This eval checks the agent stays on
that path and confirms the outcome — rather than hand-editing the HTML, which is
how the section survived last time.

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

- The agent authors the page with `update-index-cards.js` rather than editing
  the index HTML by hand or writing a one-off script to do it.
- The secondary "Top Brands" section is gone from the published page — not
  emptied, not re-imaged, not left with the placeholders.
- The agent verifies the shipped page rather than trusting the report: it checks
  that no base-template image (firefly / north-roast-coffee / a non-company org
  path) appears in what was published.
- The primary category carousel (real images) is unaffected.
- Plain language throughout (I1).
