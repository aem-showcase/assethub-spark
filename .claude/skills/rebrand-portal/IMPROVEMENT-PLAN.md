# rebrand-portal skill — improvement plan

## 1. SKILL.md size / structure

**Problem:** ~442 lines, near the 500-line performance cliff. Invariants (I1–I6), operator setup, and the full step table eat most of the budget.

**Changes:**
- Extract invariants to `docs/invariants.md`, replace inline block with one line: `⚠️ Read docs/invariants.md before acting`
- `docs/excat-setup.md` already exists — stop duplicating its content inline in the Operator setup section; replace with a one-line reference
- SKILL.md becomes: frontmatter → one-para intro → entry flow → step list with one-line summaries → gate table

---

## 2. Trigger phrases in description

**Problem:** Frontmatter `description` says *what* but not *when* — skill discovery matches on user intent, so missing trigger phrases hurts routing.

**Changes:**
- Add trigger phrases to the `description` field (or a `trigger:` field if supported):
  - "create a demo portal for [company]"
  - "rebrand the portal for [company]"
  - "set up a demo for [company]"
  - "enrich [company]'s assets"
  - "build collections for [company]"
- Drop bare "enrich assets" / "build collections" — these are resume commands, not entry points; without a company name they have no context to act on
- **Missing required inputs gate:** if the user's prompt matches this skill but is missing company name or source URL, ask for both before doing anything else:
  - Company name → `companyKey`, needed for every step
  - Source site URL → needed for design matching (excat); ask even if `assetsLane` is `enrich-existing`, since the URL drives visual style extraction in Step 4
  - Ask both in one message if both are missing; ask only the missing one if one is already provided

---

## 3. Stale / time-sensitive text

**Problem:** "A dedicated real portal path is temporarily disabled" is inline in SKILL.md — will go stale and bloats context.

**Changes:**
- Move the disabled-path paragraph entirely into `NON-DEMO-DISABLED.md` (already exists)
- SKILL.md gets one line: `Dedicated portal path: disabled — see docs/NON-DEMO-DISABLED.md`

---

## 4. Eval coverage gaps

**Problem:** Several documented failure modes have no eval.

**New evals to add:**

| Eval name | What it tests |
|---|---|
| `step-4g-facets-interactive-states` | Agent checks hover/focus/checked/disabled facet states, not just resting |
| `step-4g-blocks-before-proceed` | Agent refuses Step 5 on any single 4g check failure, not just color mismatches |
| `excat-agent-runs-shell-steps` | Agent executes clone + `npm run install:all` via Bash tool, then hands `/plugin ...` as operator copy-paste — not just prints instructions |
| `excat-setup-reverify-before-continue` | After operator follows install steps, agent re-checks invokability and continues (not just stops-and-tells once) |

---

## Priority

1 → 2 → 3 → 4
