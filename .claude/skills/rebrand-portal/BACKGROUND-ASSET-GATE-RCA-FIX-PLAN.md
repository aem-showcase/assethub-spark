# Rebrand Portal Background Fidelity — Gap / RCA / Fix Plan

## Scope

This is a **targeted plan**, not a broad redesign of the rebrand workflow.

Important correction:

- `excat-complete-design-expert` is the skill/orchestrator the rebrand workflow should keep using.
- `resources/plugins/aem-excat-plugin/excat-marketplace/excat/sub-agents/excat-block-design-expert` is the underlying excat sub-agent implementation path.
- `migration-work/brand.json` is the required measured source of truth for colors/design provenance.
- The missing piece is that the measured brand record is not currently tied to the decorative background asset (`styles/backgrounds/big.svg`), so token rebrands can pass while the old background image remains.

## Evidence

The affected demos have different copy, logos, tokens, and cards, but the same home-page abstract beige/pink background.

Artifact evidence from existing worktrees:

```text
calm   rect_fill=#FFFFFF png_sha256=cb35be89a43146c3
disney rect_fill=#f8f9fa png_sha256=cb35be89a43146c3
zappos rect_fill=#FFECD4 png_sha256=cb35be89a43146c3
```

Meaning:

- The outer SVG fill changed.
- The embedded raster inside `styles/backgrounds/big.svg` stayed byte-identical.
- The visible stale background is the embedded raster, not the CSS token layer.

The landing CSS references this asset:

```css
main .section.search-hero {
  background: var(--light-color) url('backgrounds/big.svg') no-repeat center top / cover;
}
```

## Gap 1 — `brand.json` validates tokens, not the background asset

### RCA

Step 4 correctly says the full rebrand includes decorative brand backgrounds such as `styles/backgrounds/big.svg`.

But verification currently centers on:

- `brand-fidelity`: CSS variables match `migration-work/brand.json`.
- `background-shorthand`: no shorthand clobbering of layered backgrounds.
- `residue`: old slug/hex literals are gone.
- `cascade`: computed background colors are not old base colors.

None of those checks proves the **background image payload** was replaced or retinted from the measured brand. As a result, the agent can:

1. Extract measured brand tokens into `migration-work/brand.json`.
2. Update CSS variables.
3. Change the `<rect fill>` in `big.svg`.
4. Leave the embedded raster unchanged.
5. Still pass the current checks.

### Fix

Extend the existing `migration-work/brand.json` contract with a small `assetMap` entry for decorative backgrounds.

Proposed shape:

```json
{
  "assetMap": [
    {
      "path": "styles/backgrounds/big.svg",
      "role": "landing decorative background",
      "source": "derived",
      "derivedFrom": ["#291a3c", "#555be4"],
      "oldEmbeddedImageSha256": "<captured-old-sha>",
      "newEmbeddedImageSha256": "<current-new-sha>",
      "notes": "Retinted/rebuilt from measured Calm accents in tokens.accents[]"
    }
  ]
}
```

Rules:

- `derivedFrom` must reference colors already present in `tokens.colors` or `tokens.accents[]`.
- If the background is directly generated from measured colors, use `source: "derived"`.
- Do not fabricate an unrelated image or palette.
- Do not require a separate design source outside `migration-work/brand.json`.

### Acceptance

- `migration-work/brand.json` remains the single measured design record.
- `tokenMap` continues to validate CSS variables.
- `assetMap` validates decorative background provenance.
- A rebrand that changes only CSS variables but leaves `big.svg` image payload unchanged fails.

## Gap 2 — The old background hash is not captured

### RCA

The workflow captures base brand tokens and old hexes, but not the decorative background asset identity.

Without a captured old hash, verification cannot tell whether the current `big.svg` is new or merely recolored around the edges.

### Fix

Minimally extend `capture-base.mjs` to record background asset hashes for files already referenced by landing CSS.

Record only what is needed:

```json
{
  "baseBrand": {
    "backgroundAssets": {
      "styles/backgrounds/big.svg": {
        "fileSha256": "<full-svg-sha>",
        "embeddedImageSha256": "<base64-payload-sha-or-null>"
      }
    }
  }
}
```

Implementation details:

1. Read `styles/styles.css`.
2. Find `url('backgrounds/big.svg')` / `url("backgrounds/big.svg")`.
3. Read `styles/backgrounds/big.svg`.
4. Hash the full SVG file.
5. If it contains a base64 embedded image, hash only that payload too.

No broad asset inventory is needed for this fix.

### Acceptance

- Running `capture-base.mjs` before Step 4 stores `baseBrand.backgroundAssets["styles/backgrounds/big.svg"]`.
- Existing demos with unchanged embedded raster can be detected.

## Gap 3 — Verification does not compare background asset identity

### RCA

The current `verify.mjs` checks text CSS and computed colors, but it does not inspect `styles/backgrounds/big.svg` as a brand artifact.

The visible repeated background is therefore outside the enforced contract.

### Fix

Add one focused check to `verify.mjs`:

`background-asset-fidelity`

Behavior:

1. Load `.internal/onboarding-state.json`.
2. Read `baseBrand.backgroundAssets["styles/backgrounds/big.svg"].embeddedImageSha256`.
3. Read current `styles/backgrounds/big.svg`.
4. Extract current embedded image hash.
5. Load `migration-work/brand.json`.
6. Find `assetMap[]` entry for `styles/backgrounds/big.svg`.
7. Fail if:
   - no old background hash was captured,
   - current embedded hash equals old embedded hash,
   - `assetMap` has no entry for `styles/backgrounds/big.svg`,
   - `assetMap.derivedFrom[]` does not reference measured colors from `tokens.colors` or `tokens.accents[]`.

Pass if:

- the embedded image hash changed, and
- the change is recorded in `brand.json.assetMap[]`, and
- its derivation points back to measured brand colors.

### Failure message

Use a direct actionable message:

```text
[FAIL] background-asset-fidelity:
styles/backgrounds/big.svg still contains the captured base embedded image.
Retint or replace the decorative background using measured colors from migration-work/brand.json,
then record the mapping in brand.json assetMap[].
```

### Acceptance

- Current Calm/Disney/Zappos affected worktrees fail.
- A corrected demo with a retinted/rebuilt embedded background and `brand.json.assetMap[]` passes.

## Gap 4 — Step 4 instruction is prose-only for backgrounds

### RCA

The skill text asks the design step to rebrand decorative backgrounds, but the agent can miss this because the token checks still pass.

This is a procedural gap: the instruction exists, but no measurable deliverable is required from the design handoff.

### Fix

Make a small doc update, not a workflow rewrite:

In Step 4 delegation instructions, add:

```text
When rebranding decorative backgrounds such as styles/backgrounds/big.svg,
use migration-work/brand.json as the source of measured colors. Record the
background mapping in migration-work/brand.json assetMap[] with the old and
new embedded image hashes and the measured colors used to derive it.
```

Keep `excat-complete-design-expert` wording as the skill/orchestrator.

Clarify implementation detail only where relevant:

```text
The measured extractor and CSS generation live under
resources/plugins/aem-excat-plugin/excat-marketplace/excat/sub-agents/excat-block-design-expert.
Do not treat that sub-agent path as a replacement for the excat-complete-design-expert skill.
```

### Acceptance

- The skill still routes through `excat-complete-design-expert`.
- The background asset deliverable is explicit.
- The deliverable is tied to `migration-work/brand.json`.

## Minimal Implementation Plan

### 1. Capture the base background hash

File:

- `.claude/skills/rebrand-portal/scripts/rebrand/capture-base.mjs`

Add:

- `baseBrand.backgroundAssets["styles/backgrounds/big.svg"].fileSha256`
- `baseBrand.backgroundAssets["styles/backgrounds/big.svg"].embeddedImageSha256`

Validation:

```sh
node .claude/skills/rebrand-portal/scripts/rebrand/capture-base.mjs
node -e "console.log(require('./.internal/onboarding-state.json').baseBrand.backgroundAssets)"
```

### 2. Add `assetMap` validation to `verify.mjs`

File:

- `.claude/skills/rebrand-portal/scripts/rebrand/verify.mjs`

Add check:

```sh
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
  --only background-asset-fidelity \
  --company <companyKey>
```

Validation behavior:

- fail when embedded image hash is unchanged,
- fail when `brand.json.assetMap[]` is missing,
- pass when image hash changed and `assetMap.derivedFrom[]` references measured colors.

### 3. Add check to Step 4g mandatory set

Files:

- `.claude/skills/rebrand-portal/docs/step-4g-verification.md`
- `.claude/skills/rebrand-portal/hooks/guard-step5-verify-gate.sh`

Add `background-asset-fidelity` alongside existing mandatory checks.

Do not change the rest of the Step 5 flow.

### 4. Update Step 4 docs narrowly

File:

- `.claude/skills/rebrand-portal/docs/step-4-rebrand.md`

Add only:

- `big.svg` background must be derived from `migration-work/brand.json`.
- background derivation must be recorded in `assetMap[]`.
- keep `excat-complete-design-expert` as the skill.
- mention `excat-block-design-expert` only as the plugin sub-agent path for extractor/generation internals.

### 5. Add one focused regression test/eval

Add a fixture where:

- `tokenMap` is valid,
- CSS variables are rebranded,
- `styles/backgrounds/big.svg` wrapper fill changed,
- embedded image hash is unchanged,
- `assetMap` is absent or stale.

Expected:

- `background-asset-fidelity` fails.

## Done Criteria

This fix is done when:

1. `migration-work/brand.json` remains the source of truth for measured tokens.
2. `brand.json.assetMap[]` records the background derivation.
3. `capture-base.mjs` records the old `big.svg` embedded image hash.
4. `verify.mjs --only background-asset-fidelity` fails on unchanged embedded backgrounds.
5. Step 4g blocks progression when `background-asset-fidelity` fails.
6. The docs still preserve `excat-complete-design-expert` as the skill and describe `excat-block-design-expert` only as the underlying sub-agent path.

