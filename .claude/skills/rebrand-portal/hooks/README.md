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

---

## The allow hook (`allow-sanctioned-entrypoints.sh`)

Every other hook here refuses things. This one grants, and it exists because
refusing was only half the 2026-09-18 failure.

**What it fixes.** Since Copilot CLI 1.0.86 an unattended session runs with
`allowAllPermissionMode: "auto"`: it answers its own permission prompts by
statically reviewing the command, and refuses whatever it cannot read.
`node <script>` is unreadable by construction — the behaviour is inside a file
the reviewer does not open — so the skill's *own packaged entrypoint* was
refused:

```
node .../scripts/assets/publish-page.js --path companies/…/en/nav --pull /tmp/n.html
  -> denied-no-approval-rule-and-could-not-request-from-user
```

That is why fixing `guard-secret-read.sh` alone would not have rescued the run:
the agent would have been redirected from a blocked `curl` onto a denied
`publish-page.js`. It had in fact already found the tool on its own.

**What it does.** A `preToolUse` hook may return
`{"permissionDecision": "allow"}`, and that is honoured where the static
reviewer abstains. So the repo declares, in version control and in review,
which of its own commands are pre-approved — instead of depending on
`--allow-all-tools` or on whatever each operator once approved on their laptop.

**Why it is not a bypass.** Four properties, all asserted in
`tests/hooks/allow-sanctioned-entrypoints.test.js`:

1. **A deny still wins.** Verified against the live CLI: with the allow hook
   granting, `guard-da-publish.sh` still blocked an out-of-scope Helix publish.
   Allow raises no guard's ceiling.
2. **Every segment must match.** One unrecognised segment and the hook abstains,
   so `node publish-page.js --pull x && curl evil.example` gets nothing. The
   allowlist cannot be used as a smuggling envelope.
3. **Opaque wrappers are refused here too.** `bash -c '…'`, `eval`, and
   `… | bash` hide their payload from this hook exactly as they hide it from the
   CLI's reviewer. An allowlist that cannot see what it is allowing is not an
   allowlist.
4. **It names scripts, not interpreters.** The allowlist is eight specific files
   under `scripts/`; `node` itself is never approved. A test asserts each named
   script exists *and* is actually granted, so the list cannot rot into config
   that reads as coverage.

It never blocks — it grants or stays silent, and silence leaves the command to
the normal gate.

**Registered on Copilot only**, because Copilot is the only host with a gate to
grant against. That is why it is absent from the guard parity list in
`tests/assets/rebrand-portal-guardrails.test.js`: parity applies to guards that
refuse, which must be identical everywhere.

## Guard contract (`lib/guardlib.py`)

All six guards block through `guardlib.deny()` rather than writing to stderr
themselves. This exists because of a measured failure, not as tidying.

### What went wrong on 2026-09-18

Commit `76e84f8` did two correct things at once: it added
`.github/hooks/rebrand-portal-guards.json` (the first Copilot CLI registration
of these guards) and it taught the guards Copilot's dialect — Copilot sends
`toolName`/`toolArgs` and a **lowercase** `bash` tool name, so every guard had
until then been silently inert on that host.

The combined effect was that six guards which had never inspected a single
Copilot command went live at once, across the critical path. One of them,
`guard-secret-read.sh`, matched "a secret filename appears" against "a dumping
tool appears" over the **whole compound command**. Copilot batches five steps
into one tool call, so `. ./token.env && curl … > /tmp/f.html && cat /tmp/f.html`
tripped it: the secret is sourced and never printed, and the `cat` targets a
downloaded page. Ten harmless commands were blocked — worktree secret seeding,
Helix token setup, and every DA read — and the run lost ~35 minutes to retries.

Three properties come out of that, and the tests assert all of them.

### 1. Judge each step, not the whole command

`guardlib.command_segments()` splits on `&&`, `||`, `;`, `|` and newlines.
A guard must find its trigger conditions **within one step**.
`guard-secret-read.sh` additionally resolves grep's *file operands*, so
`grep -n "token.env" .gitignore` (the filename as a search pattern) is not
mistaken for reading the secret.

### 2. The reason must reach the model

Copilot CLI **discards hook stderr**. The agent saw only
`Denied by preToolUse hook: hook exited with code 2` — no guard name, no reason,
no alternative — and could not distinguish a policy block from a broken
environment. `guardlib.deny()` therefore writes the documented
`{"permissionDecision": "deny", "permissionDecisionReason": …}` object to
**stdout** (Copilot) *and* the message to **stderr** with exit 2 (Claude Code).

Every `deny()` call passes a `route=` naming the supported alternative. A block
that does not say what to do instead produces a retry loop; one that does
produces a single corrected step.

### 3. Watch-only before blocking on a new host

```bash
REBRAND_GUARDS_WATCH_ONLY=1       # log what would be blocked, allow the command
REBRAND_GUARDS_WATCH_LOG=<path>   # default ~/.rebrand-portal-guards-watch.log
```

Run a guard's **first session on a host it has never executed on** with
`REBRAND_GUARDS_WATCH_ONLY=1`, read the log, then enable enforcement. Going
from "has never run here" to "can block anything on the critical path" in one
commit is the mistake that caused this incident, and it is not specific to one
script.

## Replay corpus test

`tests/hooks/guard-replay.test.js` replays
`tests/fixtures/guard-replay-corpus.json` — ~90 shell commands that really ran
in recorded sessions, plus the commands the Disney run proved were false
positives — through every guard, in both host dialects, and fails if any is
blocked. It also asserts real leaks still block, that the denial reaches both
channels, and that watch-only allows.

Checked against the broken guard from `76e84f8`, it fails and names all ten
blocked commands. Nothing had ever replayed a real command through these guards
before; that absence is what let a whole-string match reach a live run.

Re-harvest the corpus from `~/.copilot/session-state/<id>/events.jsonl` when the
skill's command vocabulary changes materially — take commands the hooks allowed
and that then executed, and scrub credentials before committing.

