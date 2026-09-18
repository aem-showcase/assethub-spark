# Rebrand-portal — Live-run fixes (Round 3, FINAL)

> **Status (branch `rebrand-improvements`): ALL ITEMS COMPLETE.** 212 skill tests
> pass, lint clean. Validated live against AEM `p203220-e2129061`.
>
> | Item | Type | Status |
> |---|---|---|
> | BUG 1 — no search-API recovery; 409→`jcr:uuid` | code+test | ✅ live-validated (bring-in ~11s, no wait) |
> | BUG 2 — multivalue self-heal | code+test | ✅ live-reproduced+fixed |
> | CHANGE 4 — parallel uploads | code+test | ✅ |
> | BEHAVIOR — controller-path + "No assets ready" clarifier | doc (`step-5-assets.md`) | ✅ |
> | FIX 5 — sign-in link `/auth/login` + 4g redirect gate | doc (`step-4`, `step-4g`) | ✅ (worker-routing confirmed: link-fix is correct) |
> | FIX 6 — card-image browser verify hard gate | doc (`step-5-assets.md`) | ✅ |
> | FIX 7 — proper-noun labels into collections | code+test | ✅ (`--category-labels`) |
> | FIX 8 — base-path facet hrefs | code+test | ✅ live-validated (`/<company>/en/search`) |
> | FIX 9 — publish REF=main convention | doc (`step-4`) | ✅ |
> | FIX 10 — daFolder/publish-guard note | doc (`step-3`) | ✅ |
>
> New tests: 409-recovery ×2, self-heal ×3, upload order, live bring-in no-scan,
> base-path href ×2, proper-noun label ×2.

Derived from the Apple India demo run (`demo/apple-2`, PR #36, 2026-09-07) **and a
fresh live validation run** against AEM `p203220-e2129061` using
`/content/dam/mohitar-test-1` (10 apple.com assets). Every claim is traced to
`file:line` or to a reproduced live result. **Plan only — nothing implemented.**

---

## 0. Live validation — what the fresh run proved

Ran the real controller end-to-end (not the transcript): upload 10 → enrich →
idempotency re-run → corrupt-and-recover. Ground truth read back from AEM:

```
dam:assetState   = "processed"     (immediately consistent, from jcr:content.json)
company          = "mohitar-test-1"
dam:status       = "approved"
productCategory  = "iphone"
allowedCountries = ["global"]   isArray: TRUE   ← proper JCR String[]
```

- **No post-upload lag exists.** `enumerateFolder` found all 10 assets immediately,
  ~2 min after upload. The Apple run's 15-min wait was a **misdiagnosis**, not lag.
- **The controller's write path is correct and deterministic** — `allowedCountries`
  lands as a real `String[]` every time. The Apple corruption came *only* from the
  agent's hand-rolled raw Sling POST, never from the controller.
- **Corruption reproduced live:** writing the scalar `"[\"global\"]"` (the agent's
  mistake) makes `buildSlingMetadataUpdate` return `conflicts:[…]`, `entries:[]` →
  the asset FAILs, deterministically, forever. Exactly the 144-asset Apple jam.
- **Self-heal validated:** the proposed `parseScalarTokens` converts
  `"[\"global\"]"`, `"global"`, `["global","us"]`, `"GLOBAL"` all back to clean
  token arrays.

---

## 1. Timing analysis — why the Apple run took ~91 min

Wall-clock from the transcript's `✻ … done H:MM PM` markers (4:08 → 5:39 PM):

| Block | Time | What it did |
|---|---|---|
| Branch resolve | 19s | trivial |
| Rebrand (Step 4) | 15m 25s | design, CSS/tokens, DA docs, publish, PR — **legit** |
| Assets upload + wait | **22m 23s** | 3 sequential uploads **+ futile wait** |
| Poll check | 2m 12s | more futile waiting |
| Approve write | 2m 3s | bulk Sling write |
| Enrich recovery + cards + collections | **30m 55s** | **allowedCountries fix-script thrash** + cards + collections |
| Sign-in fix | 1m 58s | auth base-path fix |

**~30-40 min was pure waste**, all from BUG 1 (futile wait ~17 min) and BUG 2
(fix-script thrash ~10-15 min). Fixing BUG 1 + BUG 2 + parallel uploads plausibly
cuts a comparable run to ~50-55 min, the remainder being genuine work.

---

## 2. Root-cause chain (one bug cascaded into the whole failure)

```
enrich-assets.js:274  bring-in re-enumerates via the Author search API to
        │             "recover" assetIds it ALREADY has in uploaded[]
        ▼
that search index lags right after upload → 0 hits under the folder
        │
        ▼
discoverTargetAssets returns [] → controller prints "No assets ready" and
        │             exits (enrich-assets.js:344-346) — NEVER reaches the real
        │             processed-check (waitForAssetProcessed)
        ▼
agent misreads the 0-result as a dam:assetState "processing lag" (a check that
        │             isn't even in the enumerate path) → waits ~17 min futilely
        ▼
agent writes metadata by hand via a raw Sling POST to "get past the lag"
        │             allowedCountries = ["global"]  (scalar string, no @TypeHint)
        ▼
controller re-run: buildSlingMetadataUpdate → conflict ×144, entries:[] (jam)
        │             ~10-15 min of fix-script thrash to recover
        ▼
portal shipped with dead sign-in + unverified card images + mis-cased labels
```

Fix the top box (BUG 1) and the controller never looks stuck → the hand-write is
never triggered. Add self-heal (BUG 2) and even a stray hand-write is survivable.

---

## 3. The three network surfaces (context — keep distinct)

| Surface | Host | Path | After-upload consistency | Callers |
|---|---|---|---|---|
| **JCR node read/write** | `author-<env>` | `…/jcr:content.json`, `…/jcr:content/metadata` | **Immediate** | `waitForAssetProcessed`, `writeSlingAssetMetadata`, `getSlingAssetMetadata` |
| **Author search** | `author-<env>/adobe` | `POST /assets/search` (match-all + client filter) | **Lags** | `enumerateFolder` |
| **Delivery / Content Hub** | `delivery-<env>` | `/adobe/assets/search`, `/collections` | Lags + approved-only | `DmCollectionsClient`, the worker/portal |

The Author search API is legitimately required for **enrich-existing** (AEM Author
has no folder-listing API — `enumerate.js:1-14`). It is **not** required for
bring-in, where the uploaded assets already carry their identifiers.

---

## BUG 1 — [P0] Bring-in must not depend on the Author search API for freshly-uploaded assets

**File:** `scripts/assets/enrich-assets.js`, `discoverTargetAssets`, lines 273-292.

### Verified

- `uploadAsset` returns `{ assetId, repoPath, repoName }`; `assetId` = the `asset-id`
  **response header** on `;api=create` (`upload-strategy.js:114`), available
  pre-index.
- `uploadImages` pushes `{ ...evidence, fileName, contentType, assetId, repoPath,
  repoName }` per asset (`:237-245`) — the complete downstream shape.
- Downstream reads only: `assetId` (rendition, `:179`, tolerates null),
  `repoPath` (all JCR calls), `repoName`/`fileName`, scrape evidence — all in
  `uploaded[]`.
- The **dry-run branch already returns without enumerate** (`:242-257`) and works.
- The recovery merge `{ ...asset, ...match }` (`:281`) **overwrites** the valid
  uploaded `assetId`; when the index lags, `match` is undefined → `unresolved` →
  FAILED (`:284-289`), discarding good data.

### The hole (verified — not a naive delete)

`createAsset` **throws on any non-2xx, including 409** (`upload-strategy.js:110-113`;
no 409 special-case). On a **re-run**, an already-present asset 409s → `failures[]`,
never enters `uploaded[]`. Today the enumerate hop is what re-discovers those. A
naive delete would regress re-runs.

### Fix (409-aware, two parts)

- **1a.** In `createAsset`, treat **409 as success**: read the existing node's
  `repo:id` from `jcr:content.json` (JCR node read — immediately consistent; same
  field `enumerate.js:59` maps to `assetId`) and return it like a normal create, so
  the asset flows into `uploaded[]`.
- **1b.** In the bring-in live branch, **return `uploaded` directly** — drop the
  search-API recovery hop (`:273-289`); keep the failures/min-target warning.
- **Degradation guard:** if an `assetId` is still empty, that one asset can't fetch
  a rendition (falls back to weaker evidence); approval still works off `repoPath`.
  Record a per-asset note, never fail the batch.
- **Keep** enrich-existing's `enumerateFolder` at `:297` — its only legitimate use.

### Outcome

- **Bring-in never waits.** Freshly-uploaded assets flow straight to the real
  processed-check (`waitForAssetProcessed`, which reads the immediately-consistent
  `dam:assetState`) and the metadata write. The ~17-min futile wait is **structurally
  impossible**.
- **Re-runs work** — already-present (409) assets resolve their id via the JCR node
  read and enrich normally.
- **The controller never prints "No assets ready" for assets it just uploaded**, so
  the agent is never given a false "stuck" signal — removing the #1 trigger that
  pushed it to hand-roll (see §Behavior).

---

## BUG 2 — [P0] Make the multivalue write self-healing (deterministic recovery)

**File:** `scripts/assets/sling-metadata.js`, `addArrayIfMissingOrAppend`, lines 122-127.

### Verified (live-reproduced)

- The controller **always** emits `@TypeHint=String[]` for multivalue fields
  (`:114-116`, `:135`) — its own writes are correct.
- But it **cannot recover** a corrupt/scalar value: when `current` is not an array
  (scalar `"global"` or corrupt `"[\"global\"]"`), `:122-127` records a **conflict
  and writes nothing** — reproduced live as `conflicts:[…]`, `entries:[]`, jamming
  every subsequent run.
- This is a **false conflict**: `allowedCountries` is a controller-stamped visibility
  gate, not user data; a scalar `"global"` already satisfies "contains global".
- Same branch governs `dc:subject` (`:159`).

### Fix (deterministic self-heal)

Replace the `!Array.isArray(current)` branch so it **coerces a scalar/corrupt value
into a proper `String[]`** (union of any real token it carried + `requiredValues` +
`desired`) instead of conflicting, emitting `@TypeHint=String[]`. Add
`parseScalarTokens` (handles plain scalar and the bracketed-JSON-string form —
validated live on all forms). Idempotent: a second pass sees a proper array → no-op.

### Outcome

- **A folder corrupted by any prior mis-write fixes itself on the next normal
  `enrich-assets.js` run** — no fix-script, no `--force`, no manual Sling POST.
- The Apple run's ~10-15 min fix-script thrash **cannot recur**: a corrupt
  `allowedCountries` becomes self-correcting instead of a hard jam across 144 assets.
- `dc:subject` gains the same resilience.

---

## BEHAVIOR — [P0] Keep the metadata write on the controller path

Not a prohibition. The transcript shows the agent used the packaged scripts
**everywhere they worked** and bypassed **only** the metadata write — and only
because BUG 1 made the controller look stuck ("No assets ready") while your
"Assets are not approved?" narrowed the goal to "stamp four fields," for which a raw
Sling POST looked most direct.

### Fix (positive doc guidance only)

- **`docs/step-5-assets.md`:** state, positively — *"The asset metadata write goes
  through the controller (`enrich-assets.js` / `writeSlingAssetMetadata`); it stamps
  `company`, `dam:status=approved`, and `allowedCountries` with the correct
  multivalue types."*
- Add the **diagnostic clarifier** so the misread can't recur — *"If the controller
  reports 'No assets ready', that is a discovery result (check the enumerate output),
  not a signal that assets are unprocessed. `dam:assetState=processed` is read
  directly from `jcr:content.json` and is immediately consistent."*
- Do **not** add a "never hand-roll" prohibition (per direction).

### Outcome

- The agent has a clear, positive default (route the write through the controller)
  and an accurate reading of the one message ("No assets ready") that previously
  triggered the detour — so the bypass loses both its pull (BUG 1 fixed) and its
  rationale (diagnostic clarifier), without a hard rule.

---

## CHANGE 4 — [P1] Parallelize bring-in uploads (speed)

**File:** `scripts/assets/upload-strategy.js`, `uploadImages` (216-250); caller
`enrich-assets.js:262`.

### Verified

- Uploads are **sequential** (`for...of` + `await`, `:226/:231`).
- `uploadAsset` has **no mutable instance state** (`:61-63` set once, read-only) →
  N-parallel safe.
- `mapWithConcurrency` (`concurrency.js`) exists, is tested, **preserves input
  order**; `--concurrency` flag exists, default 4 (`config.js:120`).

### Fix

Replace the loop with `mapWithConcurrency(capped, concurrency, …)`, collect
`{ok, record|failure}` per item, partition after. Thread `options.concurrency` from
the caller. Keep the `BRING_IN_MAX_IMAGES=50` cap.

### Outcome

- **~4× faster upload phase** at the default (≈6-9 min saved on a 150-asset run),
  with identical results and preserved ordering.
- **Caveat:** AEM Author concurrent-`create` rate limit unverified; default 4 is
  conservative (matches enrichment). Raising to 8-10 needs a live test first.

---

## FIX 5 — [P0] Verify sign-in before declaring the portal ready

Worst Apple outcome: "fully ready" with a dead login (transcript 1924 vs 1941).
Welcome doc links `/<company>/auth/login`; worker auth routes are hardcoded `/auth/*`
(`AUTH_PREFIX='/auth'`, not base-path-scoped) → fall-through → redirect loop.

### Fix

- **5a.** Author the Sign-in `href` as `/auth/login` (from the auth prefix), not
  hand-authored with the `/<company>` prefix. Confirm the author site in
  `docs/step-4-rebrand.md`. *(Alternative: base-path-scope `AUTH_PREFIX` in the
  worker — larger blast radius, unverified; prefer the link fix.)*
- **5b.** Add a **mandatory Step 4g gate** in `docs/step-4g-verification.md`: drive
  the deployed PR worker, click Sign in, assert redirect to the IdP host (not back to
  welcome). A loop back to welcome is a FAIL.

### Outcome

- **Sign-in works on every delivered portal**, verified by an actual browser
  interaction before the "ready" report — the redirect-loop class cannot ship
  undetected.

---

## FIX 6 — [P1] Card images visually verified, not rationalized

Step 5 verify item 4 (`docs/step-5-assets.md:306-314`) already requires the rendered
`<img>` src be a Helix `media_<hash>` path; the Apple run skipped it and rationalized
a `content.da.live` 404 (1830). Repeat of the `card-image-dam-proxy-gap` memory.

### Fix (doc-only)

Tighten the Step 5 completion gate: not `done` until the **published** index is
loaded in a browser and every tile shows a real image whose `<img>` src is a Helix
`media_<hash>.<ext>` path. A surviving `content.da.live/…` or `/api/adobe/assets/…`
src, or a broken tile, is a FAIL. Do not infer rendering from an upload/admin 200.

### Outcome

- **Landing cards always render real, published imagery** — no broken/placeholder
  tiles reach the shared portal, verified visually rather than assumed from HTTP 200s.

---

## FIX 7 — [P1] Proper-noun category labels (iPhone / iPad / AirPods)

`humanizeCategorySlug` (`category-plan.js:34`) + collections `humanize`
(`collections-plan.js:67`) title-case → "Iphone"/"Ipad"/"Airpods". Shipped mis-cased
in collections on the Apple run (1933).

### Fix

Thread the contract `{slug,label}` (already `[{slug,label}]`, `enrich-assets.js:53`)
into `create-collections.js` (new `--category-labels` or read the Step-5 report
`cards[].{slug,label}`); `collections-plan.js` prefers the supplied label over
`humanize`. Confirm the facet UI uses the same label.

### Outcome

- **One display vocabulary across cards, collections, and facets** — proper-noun
  brands (iPhone, iPad, AirPods) render correctly everywhere, no per-run hand-patching.

---

## FIX 8 — [P1] Base-path-aware facet hrefs

`categorySearchUrl(slug)` defaults `basePath='/en'` (`category-plan.js:43`) →
`/en/search?…`; foldered demos need `/<company>/en/search?…`. Apple run patched by
hand.

### Fix

`buildCardRows` (`enrich-assets.js:83`) passes the demo base path (the same
`/<companyKey>` used for `DEMO_BASE_PATH`, from `options`) into `categorySearchUrl`.
Confirm `update-index-cards.js` doesn't re-derive the href.

### Outcome

- **Category cards link correctly under `/<company>`** on the foldered portal — no
  post-hoc href editing, no dead/404 tiles.

---

## FIX 9 — [P2] Publish-guard base-path/ref convention (doc-only)

Guard regex extracts `<company>` as the *ref* and strips it from the path → blocked
variable-path loops and `main/apple/…` vs `demo/apple-2/…` confusion (1770-1810).

### Fix (doc)

State in `docs/step-3-da-copy.md` / `step-4-rebrand.md`: DA-managed content
publishes with **`REF=main`** and the full DA path `/<company>/en/<doc>` — never the
demo branch as ref; use explicit per-path publish calls (the guard blocks
shell-variable paths by design).

### Outcome

- **Publish is a documented, first-try step** — no painful re-derivation of the
  ref/path convention mid-run.

---

## FIX 10 — [P2] `daFolder: null` vs publish-guard chicken-and-egg (doc-only)

DA copy triggered the guard because `daFolder` wasn't set (1105); agent set it
mid-flight.

### Fix (doc)

`docs/step-3-da-copy.md`: set `customer.daFolder = "/<companyKey>"` in state
**before** invoking `copy-folder.sh` (destination is known; verification still gates
marking the step `done`).

### Outcome

- **No spurious guard block on the DA copy step** — the folder is scoped in state up
  front, and the copy runs without a null-folder false-block.

---

## Script-usage audit (evidence for BUG 1 / BEHAVIOR)

| Step | Packaged tool | Transcript | Verdict |
|---|---|---|---|
| DA copy | `copy-folder.sh` | "running the DA copy script" (101) | ✅ used |
| Publish | *(none exists)* | "No packaged publish script" (756) | ➖ missing tool |
| Upload + enrich | `enrich-assets.js` | dry-run (1189) then live ×3 (1228) | ✅ used |
| **Metadata write** | `writeSlingAssetMetadata` | **raw Sling POST by hand** (1386-1394) | ❌ bypassed |
| **allowedCountries fix** | *(controller re-run)* | **hand-rolled fix script**, 7 iters (1531-1576) | ❌ bypassed |
| Card images | `da-card-images.js` | via controller | ✅ used |
| Index cards | `update-index-cards.js` | library fn (1682) | ✅ used |
| Collections | `create-collections.js` | dry-run then live (1875) | ✅ used |

The agent bypassed **only** the metadata write, **only** because BUG 1 made the
controller appear stuck. Everything else used the scripts.

---

## Not changing (verified correct)

- `waitForAssetProcessed` reads `dam:assetState` from `jcr:content.json`
  (`sling-metadata.js:236-256`) — immediately consistent. Live-confirmed `"processed"`.
- Author search API for enrich-existing (`enrich-assets.js:297`) — the only folder
  listing AEM Author offers. Keep.
- Delivery approved-only search for collections/portal — correct by design; approval
  (JCR write) gates it. Works once BUG 1 lets discovery succeed.
- 50-asset cap per-invocation — left as-is per direction (multi-URL-per-run deferred).

---

## Implementation order (when approved — not yet)

1. **BUG 1** (409-aware) + tests — removes the trigger; biggest time + behavior win.
2. **BUG 2** (self-heal) + test — kills the fix-script thrash class.
3. **FIX 5 / FIX 6** — ship-quality gates.
4. **CHANGE 4** (parallel uploads) — speed.
5. **FIX 7 / FIX 8** — enrichment-output correctness.
6. **BEHAVIOR + FIX 9 / FIX 10** — doc guidance/conventions.

## Overall outcome after all fixes

- **No futile waits** — bring-in flows upload → processed-check → write with no
  discovery stall (BUG 1). A comparable run drops from ~91 min toward ~50-55 min.
- **Self-correcting metadata** — a corrupt `allowedCountries`/`dc:subject` heals on
  the next run; no manual fix scripts (BUG 2).
- **No broken deliverables shipped** — sign-in and card images are verified before
  "ready" (FIX 5, FIX 6).
- **Correct, consistent output** — proper-noun labels and base-path hrefs across
  cards/collections/facets (FIX 7, FIX 8).
- **Scripts are the path of least resistance** — the controller no longer looks
  stuck, and the docs point at it positively with an accurate "No assets ready"
  reading, so hand-rolling loses both its trigger and its rationale (BEHAVIOR).
- **Faster uploads** — ~4× on the upload phase (CHANGE 4).

## Open items to resolve before coding (flagged, not assumed)

- **FIX 5 alternative** (base-path-scope `AUTH_PREFIX` in the worker) unverified —
  read the worker auth routing before choosing.
- **BUG 1/1a** — confirm the identifier field on the 409 response vs. `jcr:content.json`
  `repo:id`; pick whichever avoids an extra round-trip.
- **CHANGE 4** — AEM concurrent-`create` rate limit unverified; default 4 only.

## Live test residue

- `/content/dam/mohitar-test-1` — 10 enriched test assets remain in AEM
  `p203220-e2129061` (correctly enriched; `allowedCountries` restored to `String[]`
  after the corruption test). Delete on request.
- `cloudflare/src/config.js` — reverted to `frescopa`/`''` (git-clean).
