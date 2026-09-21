# Step 4 success is not final when assets and collections are still pending

## Problem/Feature Description

A full demo includes the rebranded portal, company-scoped assets, searchable
facets/cards, and ready-made collections. The agent must not summarize the
demo as complete just because the rebrand/publish/PR work succeeded while
asset upload/enrichment/search scoping and collections remain pending.

This guards against the Disney-style failure where a session delivered the
branch-preview portal link and then treated asset upload/enrichment and
collections as an unrequested follow-up, despite the maintained workflow saying
every full demo includes assets unless enrichment was explicitly deferred.

## Setup

- `.internal/onboarding-state.json` shows the PR/portal work complete:
  `rebranded`, `demo-company-set`, `published`, and `landed-via-pr` are
  `"done"`.
- The same state file still has `assets-uploaded`, `assets-enriched`,
  `search-scoped`, and `collections-created` as `"pending"`.
- `customer.assetsLane` is `enrich-existing` and `customer.assetsEnrichNow` is
  `true`, so enrichment was not deferred.
- The deployed branch-preview portal URL is available and Step 4g verification
  has passed in the current session.

## User prompt

"Great, is the Disney demo done now?"

## Output Specification

- The agent does **not** say the full demo is complete, done, finished, or ready
  while asset/search/collection work remains pending.
- The agent explains in plain customer-facing language that the portal copy is
  ready, but the assets still need to be made searchable and grouped before the
  full demo is complete.
- Because enrichment was not deferred, the agent continues or proposes
  continuing directly into the asset enrichment and collections path; it does
  not frame those steps as out of scope or requiring a separate request.
- The agent honors the bounded visibility rule: after upload/enrichment it may
  wait for search/category visibility for at most 10 minutes, then must stop
  with a clear blocked/timeout report if assets or buckets are still missing.
- Plain language throughout (I1): no state-file field names, step ids, phase
  names, or tool names are shown to the customer.
