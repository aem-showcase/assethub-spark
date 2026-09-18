# rebrand-portal skill — fixes from the Pfizer demo (PR #14)

Source: live Pfizer demo session
(`assethub-spark-standalone/2026-09-03-032631-i-want-to-rebarnd-customer-portal-as-per-https.txt`)
plus the follow-up debugging session in this repo. Two real bugs were found live
on the published homepage and fixed by hand; this plan folds those fixes back
into the skill so the next demo doesn't reproduce them, plus a category-floor
rule clarified across three rounds of user pushback.

Status: **plan only, not yet implemented.** Everything below is a proposed
change to skill docs/scripts, pending your review.

---

## 1. Card images — stop using the `/api/adobe/assets/...` worker proxy

### What's broken

The skill currently mandates (`docs/step-5-assets.md` ~line 196-203,
`docs/asset-enrichment.md` ~line 193-197, `scripts/assets/representatives.js`
line 12-24, `scripts/assets/update-index-cards.js` line 14-20) that every
homepage card image use the shape:

```
/api/adobe/assets/<assetId>/as/<fileName>.jpg?width=<N>
```

This is documented as "the ONLY renderable form for a DAM asset in the
portal" and raw delivery URLs are explicitly forbidden as a substitute.

**Verified broken live on Pfizer's published homepage** — the cards rendered
alt-text instead of images. This is not an unauthenticated-visitor edge case:
the user hit this while signed in, which the skill's own reasoning didn't
anticipate (the proxy depends on the *visitor's* session cookie at render
time; a statically published DA doc has no visitor session context the same
way the live authenticated portal shell does).

### Why the proxy is being removed, not just patched

Grepped every call site of `/api/adobe/assets/` in the repo. The pattern is
correct and load-bearing everywhere else: `blocks/search-results/components/
picture.js`, `video-player.js`, `zip-media-handler.js`, `blocks/cards/
cards.js`, `blocks/report-asset-activity/`, `blocks/search-collection-
results/`, and the worker's own `cloudflare/src/origin/dm.js`. All of those
render *inside* the authenticated portal shell, where the visitor's session
cookie is genuinely present — different code path from a plain published DA
doc.

The **only** place in the codebase putting this proxy URL into content that
gets published as static HTML is the rebrand-portal skill's own card
generation (`representatives.js`, `update-index-cards.js`). That's the scope
of this fix — nothing in the running portal app itself changes.

### The fix that worked (verified live)

Instead of a proxy URL, upload the representative image for each category as
a normal DA page image (same mechanism the base template's own working
images already use — `content.da.live/<org>/<repo>/...`). Reference it with
ordinary `<picture>/<source srcset>/<img>` markup in the index doc. On
preview/publish, Helix automatically rewrites this into its own
`media_<hash>.<ext>` path — a real, public, non-auth-gated URL. Verified via
`curl` and in-page `fetch()` against the published Pfizer preview: proper
`media_<hash>.jpg` URLs, correct width/height attrs (proof Helix actually
processed the uploaded bytes).

Upload mechanism (improvised this session, to be made repeatable):
mint an IMS token server-side via the existing `ImsTokenProvider`
(`scripts/assets/ims-auth.js` — already used elsewhere in this tool, no new
auth path), fetch the real asset bytes from the AEM delivery API
(`delivery-<aemEnvId>.adobeaemcloud.com/adobe/assets/<assetId>/as/<file>` —
note: no `/api` prefix, and this is *our own* server-side credential, not the
visitor's session), then upload to DA as a page image.

### Changes

- **`scripts/assets/representatives.js`** — delete `cardImageUrl()` (lines
  12-24) and its doc comment claiming the proxy is "the ONLY renderable
  form." `representativeFor()` stops assigning `cardImageUrl` itself; that
  becomes a separate materialization step (below).
- **New module `scripts/assets/da-card-images.js`** — for each contract
  category's representative asset: mint IMS token → fetch real bytes from
  the delivery API → upload to DA under `/<companyKey>/en/media_
  <categorySlug>.<ext>`. Returns `{ slug, daSourceUrl }` per category.
  (Need to confirm DA's actual binary-upload endpoint shape before
  implementing — `scripts/da/copy-folder.sh` only copies docs, not binary
  media, so this is new, not a reuse of an existing script.)
- **`scripts/assets/enrich-assets.js`** — after building representatives,
  call the new module once per category (dry-run: report what *would* be
  fetched/uploaded, without writing) and set `report.cards[i].cardImageUrl`
  / `representatives.items[slug].cardImageUrl` to the DA source URL.
- **`scripts/assets/update-index-cards.js`** — update doc comment (drop the
  "never a raw delivery URL" framing entirely); `cardRowHtml()` emits
  `<picture><source srcset>...<img></picture>` matching the base template's
  working image shape, not a bare `<img src>`.
- **`docs/step-5-assets.md`** (~line 196-203) — replace the proxy-URL rule
  with: card images are DA-hosted page images, uploaded once per category
  during enrichment, referenced as normal DA/EDS image markup; Helix bakes
  them into `media_<hash>` URLs at publish. State plainly: the proxy is
  broken for statically published content — verified live, not just an
  unauthenticated-visitor gap — and is never used for card images again.
- **`docs/step-5-assets.md`** verification checklist item 4 ("Card visuals
  are real customer assets") — add: the rendered `<img>` src on the
  published page must be a Helix `media_<hash>.<ext>` path. A literal
  `content.da.live` or `/api/adobe/assets/` src surviving in the *published*
  page is a fail (means publish didn't run, or the old pattern crept back
  in).
- **`docs/asset-enrichment.md`** (~line 193-197, example JSON ~line 220-234)
  — update `representatives.items`/`cards` example to show the DA source
  URL instead of the proxy path.
- **Tests** (flagged, not part of this plan's scope to rewrite yet) —
  `.claude/skills/rebrand-portal/tests/assets/representatives.test.js` and
  `update-index-cards.test.js` currently assert the proxy-URL shape; will
  need rewriting once implementation lands.

---

## 2. Card blurb text — never truncated `autogen:description`

### What's broken

Verified live: Pfizer's published cards showed garbled fragments — `"2"`,
`"adding con"`, `"Subtle wi"` — mid-sentence cuts of AEM's AI-generated pixel
description (`autogen:description`), which the report had stored
pre-truncated at ~200 chars.

`autogen:description` is evidence for **classification only** (per
`docs/asset-enrichment.md` "How Titles, Descriptions, and Keywords Are
Generated") — it describes pixels in an image, not what a category is
about. It was never meant to be sliced into customer-facing card copy.

### Fix that worked (verified live)

Replaced with short, hand-authored-style sentences matching the existing
template convention (e.g. "Cancer therapy product and campaign imagery.").

### Change

- **`docs/step-5-assets.md`**, near the `report.cards` generation section —
  add explicit rule: card blurbs (`report.cards[].blurb`) are short,
  independently-generated sentences in the template's existing style —
  never a raw or truncated slice of `autogen:description` or any other
  per-asset generated field. If the blurb-generation code currently slices
  `autogen:description`, that's the bug to fix at the source (flagged here;
  exact call site not yet located — needs a repo check before
  implementation).

---

## 3. Secondary curated sections with no real per-item image mapping — drop by default

### What happened

Pfizer's homepage had a "Top Brands" section (Comirnaty, Eliquis) whose
images pointed at a leftover placeholder file from an *unrelated* demo site
(`content.da.live/aem-showcase/assethub-spark/...` — a different org/repo
than this Pfizer branch). No real per-brand product image was available.
User confirmed (via AskUserQuestion): **drop the section**, don't reuse
mismatched category images as a stand-in.

### Change

- **`docs/step-5-assets.md`**, card-authoring section — add as the stated
  default: a secondary/curated section (e.g. "Top Brands," "Featured") with
  no reliable 1:1 source image per named item is **dropped**, not filled
  with a mismatched or generic stand-in image, and not left pointing at a
  stale placeholder from an unrelated base-template repo. State this as
  default behavior with a "recommended" framing when asking the user — this
  was asked as an open question this session; the answer should be treated
  as the default going forward, not re-derived from scratch each time.

---

## 4. Category floor — minimum 5 real categories, at both derivation and enrichment

### What happened (grounded in the actual transcript, not the summary)

Step 4 (category-contract derivation, before any scraping) proposed **6**
categories for Pfizer: Oncology, Vaccines, Rare Disease, Internal Medicine,
Inflammation & Immunology, Hospital.

Step 5 (asset enrichment) ran the dry-run card gate, which failed: 3 of 6
categories (vaccines, rare-disease, hospital) had zero assets from the
initial homepage-only scrape. The agent then **widened source discovery**
across 5 separate real pfizer.com URLs (science/focus-areas pages,
disease-and-conditions pages, a product-detail page, general search) —
recovering real assets for Vaccines and Rare Disease, but finding **zero**
real assets anywhere on the public site for Hospital (Pfizer's Hospital
business line is B2B/formulary-facing sterile injectables — genuinely no
consumer-facing image gallery exists for it).

The agent asked the user three separate times whether to drop Hospital or
use a placeholder/generated image, correctly resisting: (a) forcing a
mismatched asset into the category just to avoid a blank card, and (b)
re-running the metadata-based classifier again on the same 35 already-
scraped assets (which the user suggested twice — correctly identified as
not able to manufacture coverage where no real asset exists to reassign).
User said "Drop hospital now" only after that full exchange — landing at 5
categories, which happened to sit exactly at the then-current `MIN_CARDS`
floor of... actually 4 (see below) — comfortably above it either way.

**The floor itself:** `scripts/assets/constants.js` line 151 currently sets
`MIN_CARDS = 4`. Per your explicit instruction: **raise this to 5** — it
can't be lower than 5, period.

**The drop-vs-placeholder priority** (per your correction): widening
discovery is first priority; a clearly-flagged placeholder/dummy category is
last resort, used only after real discovery is genuinely exhausted — not
forbidden outright.

**The floor applies at two points**, not one:

1. **Step 4 — initial contract derivation.** The source-derived contract
   handed to Step 5 must propose **at least 5** candidate categories up
   front (from source-site nav, product/category sections, URL paths,
   headings). If genuine derivation yields fewer than 5 real candidates, say
   so plainly and widen derivation (check more site sections) before
   handing off — don't hand Step 5 a sub-5 contract and expect it to
   backfill the gap. This is a *candidate* floor, not a guarantee — Step 5
   may still find a candidate has zero real assets after scraping.
2. **Step 5 — post-enrichment card gate.** After scraping/classification,
   the *surviving* real-category count must still be ≥5. Before dropping any
   zero-asset category:
   - **First** — do not drop it. Widen source discovery across multiple
     real candidate URLs (as actually happened for Hospital — 5 distinct
     attempts across different site sections) to find real assets for it,
     or find an additional real category to add in its place.
   - **If dropping would take the total below 5** — the drop is not allowed
     until a replacement real category is found, i.e. discovery must
     continue.
   - **Only if discovery is genuinely exhausted** (multiple real attempts
     already made, not skipped) **and** the floor still can't be reached
     with real categories — a clearly-flagged placeholder/dummy category is
     the last-resort fallback to reach 5. It must be visibly marked as a
     placeholder (in the report / internal notes) so it's never later
     mistaken for a real, source-derived category.
   - **Always ask the user** before dropping a category vs. using a
     placeholder — don't auto-decide either way. This matches what actually
     happened (three rounds of user confirmation before "drop Hospital"
     was approved).

### Changes

- **`scripts/assets/constants.js`** line 151 — `MIN_CARDS = 4` → `MIN_CARDS
  = 5`.
- **`scripts/assets/enrich-assets.js`** lines 113-114 (card-gate failure
  message) — update wording to reflect the 5-floor and the "widen
  discovery / ask user, don't auto-drop, placeholder is last resort" chain.
- **`docs/step-4-rebrand.md`** category-contract derivation section (~line
  238-256) — add the initial-derivation floor: propose ≥5 real candidate
  categories from the source site before handing off to Step 5; widen
  derivation if the honest count is lower, rather than handing off a sparse
  contract.
- **`docs/step-5-assets.md`** card-gate section (~line 187-191) — replace
  "Count is whatever the contract yields... no fixed 5/2 target" (this is
  now wrong — there is a hard floor) with the full drop-priority chain
  above: widen discovery first → ask user → placeholder only as genuinely-
  exhausted last resort → never silently, never presented as source-derived.
- **`docs/asset-enrichment.md`** (~line 198-202, card-gate description) —
  same floor correction (4 → 5) and the same priority-chain summary.
- **Tests** (flagged) — `.claude/skills/rebrand-portal/tests/assets/
  enrich-assets.test.js` line 465 ("fails below the minimum card count")
  asserts against the old floor; needs updating to 5 once implemented.

---

## Open item before implementation

DA's actual binary/image-upload endpoint shape (needed for the new
`da-card-images.js` module in fix #1) hasn't been confirmed yet — only
`scripts/da/copy-folder.sh` (doc copy) and `scripts/da/ensure-eds-tokens.sh`
(token minting) exist today; neither uploads binary media. This needs a
short investigation (DA docs or HAR capture, same method used to originally
reverse-engineer the AEM repository upload flow) before implementation
starts.
