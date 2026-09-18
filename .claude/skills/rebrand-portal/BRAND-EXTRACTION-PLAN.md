# Plan: Trustworthy brand extraction and verification

**Status:** proposed — not implemented
**Scope:** `.claude/skills/rebrand-portal`
**Trigger:** three defects shipped on the Heineken demo portal, all of which
passed every automated check.

---

## 1. What we are trying to achieve

One outcome: **a rebrand's colours, fonts and content can be proven correct
before anyone looks at the page.**

Today none of that is provable. The three Heineken gaps were not caught by a
weak check — they were each reported **PASS**:

| # | Defect | Why it passed |
|---|---|---|
| 1 | Icon rendered as literal `:heineken-3-icon:` | `icon-render` is filesystem-only; the file existed, so it passed. The defect was in AEM's shortcode conversion. |
| 2 | Background stayed cream | `residue` correctly found no old hex. Nothing checked whether the *new* value took effect. |
| 3 | Stale "Top Brands" cards | Cards were retitled but still linked to copied-never-rewritten pages. No invariant requires rewriting what was copied. |

Three sub-goals follow:

- **G1 — Brand tokens are measured from the real source, every time**, or the
  run halts. Never recalled from memory, never web-searched.
- **G2 — Verification compares against an independent source of truth**, not
  against the artefact being verified.
- **G3 — Every check that exists is actually enforced**, and every page copied
  is rewritten or deleted.

---

## 2. Evidence this is the right problem

Verified during investigation (2026-09-17):

- **excat's extractor works on this repo.** `brand-extract.js` run against
  `hyundai.com/in/en` returned real tokens — `HyundaiRegular`/`HyundaiMedium`,
  favicon URLs, `navHeight: 71px`. It does **not** need `page-templates.json`;
  its own header documents a fallback, and `SKILL.md` Step 1.2.3 says to pass
  `[]` when no selectors exist.
- **Yet 13/13 past runs abandoned it**, each citing the missing
  `page-templates.json` from Step 1.1 — a precondition that has an explicit
  escape hatch two paragraphs later. The blocker was imagined.
- **Two silent invocation traps** make hand-rolled use fail quietly:
  `.replace()` patches the doc comment instead of the code
  (`ReferenceError`), and `evaluate(src)` on an arrow-function expression
  returns `undefined`. Both were hit during this investigation.
- **Heineken's source is age-gated.** Extraction "succeeds" on the AgeGateway
  page and returns plausible-but-wrong tokens (`text rgb(153,153,153)`,
  `link rgb(56,96,190)`) with no error raised.
- **The Step 4g gate is circular.** `step-4g-verification.md:137-146` says to
  build the expected-value map *"from excat's own edit"* because *"Excat
  already fetched the source site and already decided these values."* If excat
  never ran, expected == actual == the invented value. It passes forever.
- **`stale-card-images` is orphaned.** Added in PR #44 with an eval, but absent
  from `guard-step5-verify-gate.sh`'s REQUIRED list (6 checks) and from the 4g
  doc. The only doc mentioning it says *"Skip"*.
- **Gap 3 is a repeat.** The Workday run hit the identical stale-cards defect
  nine days earlier, with the same orphan pages and the same fix. It was never
  institutionalised.

**Keep excat orchestration.** Of the runs that loaded
`excat-complete-design-expert`, 5/5 went and measured the real source — even
the two with no browser, which fetched and parsed CSS instead. The one run
where the skill never loaded (Apple, spawn denied) used brand memory
(*"Apple India's design is well-known"*). The skill's framing is
behaviourally load-bearing; only its *mechanism* is unreliable.

---

## 3. Design

Three layers, no overlap:

| Layer | Owner | Guarantees |
|---|---|---|
| **Intent** | excat skill | the agent measures the real source |
| **Mechanism** | `extract-brand.mjs` | *how* is deterministic, not improvised |
| **Proof** | `brand.json` + `verify.mjs` | it happened, and it landed correctly |

Today only Intent exists.

### The seam with excat

| excat Step | Owner | Rationale |
|---|---|---|
| 1.1 Resolve URL | **our input** | this is the abandonment trigger — remove it from the agent |
| 1.2 Extract brand tokens | **our script** | deterministic; avoids both silent traps |
| 1.3 Font-delivery cascade | **excat** | real excat value, no importer dependency |
| 1.4 Write `brand.css` | **excat** | design judgement |
| 2.x Block migration | **skipped** | genuinely needs importer artefacts |
| 4b–4f apply, 4g verify | **rebrand-portal** | ours |

We invoke excat **with `brand.json` and the URL already supplied**, so the
agent enters at Step 1.3 — past the check that caused every abandonment. excat
keeps judgement (which measured token maps to which role) but loses the ability
to fabricate, because unprovenanced tokens fail verification.

### Dependency

The excat plugin must be installed — that is the distribution mechanism, and it
puts `brand-extract.js` and a bundled Playwright on disk. No clone, no
`npm install`, no self-heal. Verified present and working on this machine.

Extraction needs excat and a browser and runs once, locally. Verification reads
the committed `brand.json` and needs neither, so it works in hooks and CI.

---

## 4. Steps

### Phase 0 — The contract
| Step | Value |
|---|---|
| 0.1 Define `migration-work/brand.json`: excat's native shape plus provenance (`sourceUrl`, `finalUrl`, `extractedAt`, `gatePassed`, `warnings`) | Creates the independent source of truth that every later gate reads. Without it there is nothing to verify *against* — the core root cause. |
| 0.2 Add `tokenMap` (old hex → new hex → CSS variable) | The expected-value source that replaces the circular read from `styles.css`. |

### Phase 1 — Deterministic extraction
| Step | Value |
|---|---|
| 1.1 `scripts/rebrand/extract-brand.mjs` — thin wrapper; reads excat's script from `$CLAUDE_PLUGIN_ROOT`, applies `replaceAll`, invokes as `` `(${src})()` ``, runs in the plugin's bundled Chromium | Removes the improvisation gap. The agent runs one command; both silent traps are fixed once rather than re-derived per run. Prototype verified: Hyundai exit 0. |
| 1.2 Gate/interstitial detector — halt on URL divergence, gate-like title, or degenerate yield (`navHeight` **and** `contentMaxWidth` empty) | Turns Heineken from a silent wrong-answer into a loud stop. Prototype verified: exit 5, all three signals fired independently. |
| 1.3 Preflight checks **outcome**, not availability — `brand.json` exists with `gatePassed: true` | Availability was always checked; extraction never was. This is the gap in one line. |

### Phase 2 — Truthful verification
| Step | Value |
|---|---|
| 2.1 Repoint `step-4g-verification.md:137-146` to `brand.json.tokenMap` | Kills the circularity. Highest-leverage single edit in the plan. |
| 2.2 `verify.mjs --only brand-fidelity` — served `styles.css` must match `brand.json` | Converts checks from residue-shaped ("old gone") to fidelity-shaped ("new correct"). Directly targets Gap 2. |
| 2.3 Real cascade gate via the plugin's Chromium against the unauthenticated AEM origin | The "browser-only" check in 4g was never implementable; it is now. Catches `search-hero category-tiles` being two classes on one element. |
| 2.4 Shorthand lint — `background:` shorthand on a `.section.*` rule that resets a layered background | Catches Gap 2's mechanism statically, with no browser. |
| 2.5 Fix `residue` doc/code drift (doc claims DA coverage; code walks four dirs) | Removes a false assurance. |

### Phase 3 — Enforcement
| Step | Value |
|---|---|
| 3.1 `hooks/guard-brand-extraction.sh` — block `styles.css` edits unless `brand.json` is present, fresh and passing | Documentation is advisory and was demonstrably ignored 13/13 times. Hooks are not. |
| 3.2 Add `brand-fidelity` + `stale-card-images` to the REQUIRED list | Closes the shipped-but-ungated hole. |
| 3.3 Meta-test: every check exported by `verify.mjs` appears in REQUIRED or a documented skip list | Fails today. Prevents the next orphaned check. |
| 3.4 Invariant I10 — no token without provenance | Makes fabrication a rule violation, not a judgement call. |

### Phase 4 — Content correctness
| Step | Value |
|---|---|
| 4.1 Separate branch suffix from `companyKey`; extend I6 to shortcode safety | Fixes Gap 1 at source: `heineken-3` broke AEM's `:name:` conversion. |
| 4.2 Invariant: every copied page is rewritten or deleted; no `/companies/<key>/` link resolves to un-rewritten content | Fixes Gap 3 and the Workday repeat. I7 mandates publishing what was copied but nothing mandates rewriting it. |
| 4.3 Move the 4g user check-in earlier | It currently fires after Step 5 has already run. |

### Phase 5 — Tests and evals
| Step | Value |
|---|---|
| 5.1 Red-first fixtures from the broken state (recoverable at `101f4db`) | Proves each fix; without a failing test first we cannot know the gate works. |
| 5.2 Fixtures: `hyundai` (clean → pass), `heineken` (gated → must halt) | Locks in both branches of the extraction gate. |
| 5.3 Repoint the 5 excat evals from *invokable* → *extracted* | They test the right subject, just not far enough. |
| 5.4 Wire `tests/da` and `tests/hooks` into `vitest.config.js` | Written but never executed today. |

### Phase 6 — Docs and orchestration
| Step | Value |
|---|---|
| 6.1 Keep invoking `excat-complete-design-expert`, pre-supplying URL + `brand.json`; scope to Phase 1 | Retains the behaviour that made 5/5 runs measure, while bypassing the abandonment trigger structurally. |
| 6.2 Treat any skill/tool denial as a halt | Apple's classifier denial was absorbed silently and the run continued on brand memory. |

---

## 5. Sequencing

```
P0 ──▶ P1 ──▶ P2 ──▶ P3
       └──────▶ P5.2
P4  (independent)
P6  (last — docs follow mechanism)
```

Order of leverage: **2.1** (circular gate) → **1.2** (Heineken halt) →
**3.2/3.3** (ungated checks) → **1.1** (driver) → **4.1/4.2** (Gaps 1 and 3).

---

## 6. Acceptance criteria

- `brand.json` is produced and committed for every rebrand.
- Re-running Heineken **halts** instead of shipping `#008200` / `#D4AF37`.
- Each of the three gaps has a test that failed before its fix.
- The set of checks in `verify.mjs` equals the enforced set, asserted by test.
- Identical behaviour in Claude and Copilot.
- Existing 29 unit tests stay green.

---

## 7. Out of scope

- Changes to excat itself (upstream, not ours to modify).
- Vendoring `brand-extract.js` — we read it from the installed plugin so excat
  keeps ownership and we inherit fixes.
- excat Phase 2 block migration — genuinely requires importer artefacts.
- Self-heal installation of excat — the plugin is a prerequisite.

---

## 8. Risks

- **Phase 2.3** depends on the AEM origin staying unauthenticated (verified
  today: `.plain.html` and `styles.css` both 200). If that changes, the cascade
  gate must degrade to 2.4's static lint and **fail loudly**, not pass silently.
- **excat version drift** — the installed directory reports `2.1.6` while its
  own `VERSION` file says `2.1.1`. Record both; do not trust `VERSION` alone.
- **Gate handling is best-effort.** Some sources (Heineken) cannot be passed
  programmatically. The correct outcome there is a halt and an operator
  decision, not a cleverer scraper.
