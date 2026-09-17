# Publish guard hook (`guard-da-publish.sh`)

> **Sibling gate:** `guard-live-publish-ceiling.sh` also fires on publish, for a
> different reason — see [Live-publish ceiling gate](#live-publish-ceiling-gate)
> below. This one enforces *where* you may publish; that one enforces *what*.

A `PreToolUse` hook that blocks any Document Authoring / Helix **publish**
whose target path is not under the demo's company folder
(`customer.daFolder` in `.internal/onboarding-state.json`). It enforces
the folder-scoped publish rule from `SKILL.md` Step 4 mechanically.

**Fail-safe:** if no company folder is resolved yet (before Step 3 sets
`customer.daFolder`), every DA/Helix publish write is blocked.

**Scope / limitations (defense-in-depth, not a sandbox):**
- Pattern-based over the tool input — an unusual command shape, or a URL
  built from a variable inside a wrapper script, can slip past. This is
  why `SKILL.md` Step 4 mandates passing the explicit `/<company>/…`
  path list as args (keeps them visible to this hook).
- Sees each CLI-mediated tool call, not iteration inside a long-running
  script — it validates the argv/paths passed in, not paths a script
  generates internally.
- It intentionally does **not** touch AEM asset publishes (Phase C, which
  target `/content/dam/<company>` on a different host) — only site
  content publish/preview via `admin.hlx.page` / `admin.da.live`.

## Registration

This repo registers the hook for Claude Code in `.claude/settings.json`.
Verify it is loaded before a migration session. If another CLI runs the
session, register the same script there.

**Claude Code** — project registration:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/skills/rebrand-portal/hooks/guard-da-publish.sh"
          }
        ]
      }
    ]
  }
}
```

**Copilot CLI** — register the same script as a `PreToolUse` command hook
via the CLI's hooks configuration (see `/env` to confirm it loaded). The
script reads the event JSON on stdin and blocks with exit code 2, which
both CLIs honor.

## Verifying

```bash
# allow: publish under the company folder
echo '{"tool_input":{"command":"curl -X POST https://admin.hlx.page/preview/o/r/main/disney/x"}}' \
  | CLAUDE_PROJECT_DIR=/path/to/repo ./guard-da-publish.sh; echo "exit=$?"   # 0

# block: publish to a root path
echo '{"tool_input":{"command":"curl -X POST https://admin.hlx.page/live/o/r/main/en/index"}}' \
  | CLAUDE_PROJECT_DIR=/path/to/repo ./guard-da-publish.sh; echo "exit=$?"   # 2
```

Requires `python3` on PATH (used only for JSON parsing).

# Step 5 verify gate hook (`guard-step5-verify-gate.sh`)

A `PreToolUse` hook that blocks invoking Step 5's asset-enrichment script
(`scripts/assets/enrich-assets.js`) unless a fresh, passing `verify.mjs`
report exists for the worktree's current commit.

**Why this exists:** `docs/step-4g-verification.md` documents Step 4g as a
"hard gate before Step 5," and `verify.mjs`'s checks (`residue`,
`structural-residue`, `icon-reference-resolution`,
`welcome-header-home-link`, `header-logo`, `icon-render`) already catch the
defects that class of gate is meant to catch — but nothing ever enforced
it mechanically. `verify.mjs`'s exit code was never read by anything, so
an agent could run it, see a FAIL, and proceed to Step 5 anyway. This hook
makes that impossible: it reads `.internal/verify-report.json` (written by
`verify.mjs --write-report`) and blocks unless every mandatory check
passed against the current commit.

**Producing the report:**

```bash
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
  --preview <branch>.dev.frescopamedia.com --company <companyKey> \
  --write-report .internal/verify-report.json
```

**Scope / limitations (defense-in-depth, not a sandbox):**
- Pattern-based over the tool input, same caveats as `guard-da-publish.sh`.
- A stale report (checked commit ≠ current HEAD) is treated as no report
  at all — any edit after the last verify.mjs run re-blocks Step 5 until
  it's re-run.
- Only guards `enrich-assets.js` — other Step 5/6 scripts are not in scope
  for this hook.

## Registration

This repo registers the hook for Claude Code in `.claude/settings.json`,
alongside the other three rebrand-portal hooks.

## Verifying

```bash
# block: no report present
echo '{"tool_input":{"command":"node scripts/assets/enrich-assets.js --dry-run"}}' \
  | CLAUDE_PROJECT_DIR=/path/to/repo ./guard-step5-verify-gate.sh; echo "exit=$?"   # 2

# allow: fresh report, all mandatory checks passing
# (write .internal/verify-report.json with checkedCommit == `git rev-parse HEAD`
#  and every mandatory check's pass:true, then re-run the command above)   # 0
```

Requires `python3` on PATH (used only for JSON parsing).

---

## Live-publish ceiling gate

### `guard-live-publish-ceiling.sh`

A `PreToolUse` hook that blocks promoting the demo's landing page to **live**
unless a fresh, passing `card-ceiling` result exists for that company.

**Why it exists.** Every other barrier against an oversized demo lives inside
the packaged scripts, so each is only as good as the agent's decision to call
them. Live runs have repeatedly bypassed that — not maliciously, but because
the supported path was missing a capability:

- `apply-index-cards.mjs` imported `replaceBlockRows` directly rather than
  calling `updateIndexCards`;
- `heineken-gated-enrich.mjs` imported `enrichAssets` and built its own options;
- one run issued **273 hand-rolled `curl` requests** against the authoring API.

Those routes are legitimate and are **not** blocked. What none of them can skip
is publishing: a demo that never goes live is not a demo. That makes the live
publish the one chokepoint every route shares, which is why the last check sits
here rather than inside a script.

**Why `live` and not `preview`.** `card-ceiling` reads the *published* page —
the artifact, not the report the run wrote about itself (the lesson from
`stale-card-images`, which passed a report-based check and shipped twice). That
requires a previewed page to exist, so the sequence is: author → preview
(allowed) → verify → live (gated). Gating preview would make the check
impossible to satisfy.

**What it checks**, in the worktree the command targets:

1. `.internal/verify-report.json` exists and contains a `card-ceiling` result;
2. that result passed;
3. it records the same company this publish targets;
4. it is newer than 30 minutes — the page is not a git artifact, so commit
   freshness proves nothing; an older result says nothing about a page that may
   have been re-authored since.

Only the landing page is gated — `search` and detail pages carry no card blocks.

**Two invocation forms are matched**, because the gate must not be narrower
than the supported path:

- a raw `curl`-style POST to `admin.hlx.page/{live,publish}/…/index`; and
- `scripts/assets/publish-page.js … --publish`, whose URLs are built inside the
  script and so never appear in the command string. `--preview-only`,
  `--dry-run`, `--pull` and a non-index `--path` are all allowed through.

Shipping the packaged publish CLI without the second form would have handed the
agent a *supported* route straight past this gate — the failure mode this hook
exists to prevent. The same applies to `guard-da-publish.sh`, which matches the
CLI's `--path` for folder scope.

**Scope / limitations (defense-in-depth, not a sandbox):** pattern-based over
the tool input, like its siblings. A publish issued from inside a compiled
program, or through an SDK that never puts the URL in the command string, is
invisible here. It removes the accidental bypass and raises the cost of the
deliberate one; it does not make the bypass impossible.

### Registration

Registered in all three host configs alongside the other guards —
`.claude/settings.json`, `.codex/hooks.json`, and
`.github/hooks/rebrand-portal-guards.json`. Parity is asserted by
`tests/assets/rebrand-portal-guardrails.test.js`, because a guard registered on
only one host is inert on the others — which is exactly how a live Copilot
session ran with none of these hooks in effect.

### Verifying

```bash
bash .claude/skills/rebrand-portal/tests/hooks/guard-live-publish-ceiling.test.sh
```

Requires `python3` on PATH (used only for JSON parsing).
