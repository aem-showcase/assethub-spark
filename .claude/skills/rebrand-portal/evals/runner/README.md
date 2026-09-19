# rebrand-portal eval runner

A small local runner for the `rebrand-portal` skill evals. No Tessl, no
plugin packaging — it drives a local agent CLI (`claude` or `copilot`), which
already sees `rebrand-portal` as a project skill when run from anywhere inside
this repo.

## Requirements

- node ≥ 20.
- `git` on PATH (the runner seeds a throwaway git repo per run).
- Whichever engine you pass to `--engine`:
  - `claude` CLI ≥ 2.1, or
  - `copilot` CLI (GitHub Copilot CLI), logged in.

The runner seeds each run into an **isolated temp dir outside this repo** and
copies the `rebrand-portal` skill into a local `.claude/skills/` there
(verified on both CLIs: `claude -p` and `copilot -p` each resolve it). This
isolation is deliberate — running the skill inside the real checkout makes the
model see the real git remotes/branch and refuse to role-play a scripted
customer.

## Choosing the engine

`--engine <claude|copilot>` is **required** and has no default. Which CLI ran
an eval changes what its score means, so it is always a stated choice: the
runner never picks one for you, never prompts, and never falls back to the
other engine if the chosen one errors. One engine per invocation — there is no
"run both" mode.

To compare engines, run it twice. Results are stored per engine
(`results/<label>/<engine>/…`), so the same `--label` on different engines
can't overwrite anything:

```bash
node run.mjs --engine claude  --eval demo-branch-not-fork --label baseline
node run.mjs --engine copilot --eval demo-branch-not-fork --label baseline
```

## Usage

```bash
cd .claude/skills/rebrand-portal/evals/runner

# one run of one eval
node run.mjs --engine claude --eval entry-language-plain-not-internal-terms --label baseline

# repeat N times (scores are averaged)
node run.mjs --engine copilot --eval pr-preview-is-deliverable-no-merge --n 3 --label baseline

# keep the seeded workspace for inspection
node run.mjs --engine claude --eval resume-verifies-not-assumes --keep

# run every eval in the suite once
node run.mjs --engine claude --all --label baseline

# run every eval 3x each and print a combined summary
node run.mjs --engine claude --all --n 3 --label baseline
```

Flags:

- `--engine <claude|copilot>` — **required.** Which CLI runs the skill. See
  "Choosing the engine" above.
- `--eval <name>` — eval directory name under `evals/`. Required unless `--all`.
- `--all` — discover and run every eval directory under `evals/` (anything
  with both a `task.md` and a `criteria.json`; `runner/` itself and any
  mid-authored directory missing one of those two files are skipped). Runs
  each eval's `n` reps in turn, prints each eval's normal detail block, then a
  final `=== summary (all evals) ===` table with one average-% line per eval
  plus an overall average. A CLI error in one rep doesn't abort the
  rest — it's logged as `run-i: ERROR` and excluded from that eval's average;
  an eval with zero successful reps shows `ERR` in the summary and is
  excluded from the overall average.
- `--label <label>` — results land under `runner/results/<label>/<engine>/`
  (default `baseline`).
- `--n <N>` — repetitions per eval (default 1).
- `--model <model>` — model for the skill run (default: CLI default). Short
  Claude aliases are mapped for Copilot (`sonnet` → `claude-sonnet-5`).
- `--judge-engine <claude|copilot>` — engine for the judge. Defaults to
  `--engine`, so a Copilot run is Copilot end to end. Override it to pin
  grading to one engine while varying the engine under test.
- `--judge-model <model>` — model for the judge (default `sonnet`).
- `--keep-mcp` — don't disable the operator's MCP servers for Copilot runs
  (see "Engine differences" below).
- `--keep` — don't delete the seeded temp workspace.

`--all` takes a while — every eval takes on the order of a minute or two
(two headless CLI calls each), so `--all --n 3` over the full suite is a
multi-minute run. Consider `run_in_background`-style invocation or just
patience.

## Engine differences

The seeding, snapshot, deterministic checks and scoring are engine-agnostic.
Only three things differ, and the runner absorbs all three:

| | `claude` | `copilot` |
|---|---|---|
| Output | one JSON object | JSONL, one event per line |
| Permissions | `--permission-mode acceptEdits`/`dontAsk` | `--allow-all-tools` (no per-mode equivalent) |
| Judge shape | `--json-schema` enforces it | schema stated in the prompt, object extracted from the reply |

Two consequences worth knowing when reading scores:

- **Transcripts aren't identical in scope.** `claude -p --output-format json`
  returns only the final assistant message; Copilot exposes every assistant
  turn, and the runner keeps them all. The Copilot judge therefore sees
  strictly more evidence — relevant for criteria about questions the skill
  posed along the way, not just how it signed off.
- **Judge variance differs.** The Claude judge is schema-enforced; the Copilot
  judge is prompt-enforced. If you want grading held constant while comparing
  engines, pin `--judge-engine claude`.

Copilot runs disable the operator's MCP servers (`excatops`, `playwright`,
`github-mcp-server`) by default: they would otherwise load into every seeded
sandbox, which is both slow and a hole in the suite's hermeticity rule. Pass
`--keep-mcp` if an eval genuinely needs them.

## What one run does

1. **Seed** — a fresh isolated temp dir gets: the `rebrand-portal` skill
   (into `.claude/skills/`), a minimal fork skeleton (`skeleton/`), a throwaway
   `git init` with the scenario's origin remote + an initial commit, then
   `evals/<name>/fixture/` laid on top (if present).
2. **Run** — the chosen engine runs the prompt headless (`claude -p` with a
   permission mode chosen per eval — read-only `plan` for decision-only evals,
   `acceptEdits` for evals with a fixture that must be mutated, overridable
   with `<!-- permission: ... -->` in `task.md`; or `copilot -p
   --allow-all-tools`, which has no per-mode equivalent).
3. **Snapshot** — records the resulting workspace's files + contents (both as
   a flattened text block for the judge prompt, and as a `path -> contents`
   map deterministic checks look up directly).
4. **Deterministic checks** — any checklist item with a `check` field (see
   below) is graded here, in JS, against the workspace map / transcript —
   no model call, no variance. Only items WITHOUT a `check` field go to the
   judge.
5. **Judge** — a second headless call on `--judge-engine` scores the remaining
   checklist
   items binary pass/fail (structured via `--json-schema`); the runner
   computes the weighted score from `max_score` across both deterministic and
   judged verdicts together.
6. **Report** — prints per-item ✅/❌ + weighted % (deterministic evidence is
   prefixed `[deterministic]` so it's visually distinct from judge prose) and
   writes `results/<label>/<engine>/<name>/run-<i>/{transcript.txt,run.json,workspace.txt,score.json}`.

## Deterministic checks (`check` field in `criteria.json`)

Add a `check` to any checklist item whose truth is a plain fact about the
workspace or transcript — a JSON key's value, or whether a literal string
appears somewhere — rather than something needing reading comprehension. This
is the suite's own "assert on objective end-state wherever possible" design
rule, applied to *how grading happens*, not just to how criteria are worded:
a criterion with a `check` never varies run-to-run for a fixed end-state,
where the same criterion left to the judge occasionally does (see the
"Known limitation" section in the top-level `../README.md`).

Supported check types:

```json
{ "type": "jsonPath", "file": ".internal/onboarding-state.json", "path": "customer.authBypassActive", "equals": true }
{ "type": "jsonPath", "file": ".internal/onboarding-state.json", "path": "phases.rebrand.status", "notEquals": "done" }
{ "type": "fileContains", "file": "cloudflare/.secrets", "value": "some-literal-string" }
{ "type": "fileNotContains", "file": null, "value": "some-literal-string" }
{ "type": "transcriptContains", "value": "some-literal-string" }
{ "type": "transcriptNotContains", "value": "some-literal-string" }
```

- `file: null` (or the field omitted) on `fileContains`/`fileNotContains`
  scans every file in the workspace snapshot, not just one.
- `path` on `jsonPath` is a dot-path (`a.b.c`) looked up in the parsed JSON at
  `file`; use `equals` or `notEquals` (mutually exclusive).
- Use `"ref": "some.path"` instead of `"value": "..."` to pull the literal
  from the eval's `scenario.json` (dot-path lookup) instead of duplicating it
  in `criteria.json` — useful when the value must stay in sync with what
  `task.md`'s prompt actually pastes (e.g. a secret string).

**Only add a `check` when the criterion is a pure fact with no legitimate
alternative way to satisfy it.** Some criteria intentionally accept two
different signals (e.g. "sets `status: blocked` in the file, OR clearly
states in prose that it's blocking") — those must stay judge-graded, because
a single `jsonPath` check can't express "either of these," and forcing one
would silently narrow what counts as passing. When in doubt, leave the
criterion on the judge; a missed deterministic opportunity costs a little
variance, but a wrongly-added one costs a false negative on a previously
valid behavior.

## Headless Q&A

Neither CLI has an interactive question picker in headless mode (`claude -p` /
`copilot -p`). If an eval ships a
`persona.md`, the runner appends a test-harness block telling the session to
**show the question it would ask** (so language can be checked) and then proceed
using the persona's answers without waiting.

## Notes

- `runner/results/` and the repo-root `.eval-work-*/` dirs are gitignored.
- These evals are hermetic: none makes a live network/Cloudflare/Content-Hub
  call. Where a real call would sit downstream, the eval states the input in its
  `task.md ## Setup` so the *decision* is what's judged.
