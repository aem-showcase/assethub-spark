#!/usr/bin/env bash
#
# PreToolUse guard for the rebrand-portal skill.
#
# Step 4g's verify.mjs checks (residue, structural-residue,
# icon-reference-resolution, welcome-header-home-link, header-logo,
# icon-render) are documented as a "hard gate before Step 5" — but nothing
# has ever mechanically enforced that. verify.mjs's exit code is never read
# by anything, and enrich-assets.js has no field it checks before running.
# On a live demo run, checkResidue already covered the exact defect that
# shipped (a base-brand string surviving in blocks/header/header.js) and
# would have failed if run to completion — the miss was that the check's
# FAIL was never surfaced or acted on before the agent proceeded to Step 5.
#
# This hook closes that gap: it blocks invoking Step 5's asset-enrichment
# script unless a FRESH, PASSING verify.mjs report exists for this exact
# worktree's current commit.
#
# Defense-in-depth, NOT a sandbox: pattern-based over the tool input and a
# report-file check, so unusual command shapes can slip past.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow.
# Exit 2 = block (message on stderr is shown to the model). Works for
# Claude Code and Copilot CLI PreToolUse hooks.

set -uo pipefail

HOOK_INPUT="$(cat)"
export HOOK_INPUT

FALLBACK_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-$PWD}}"
export FALLBACK_PROJECT_DIR

python3 <<'PY'
import json
import os
import re
import subprocess
import sys

blob = os.environ.get("HOOK_INPUT", "") or ""
fallback_project_dir = os.environ.get("FALLBACK_PROJECT_DIR", "")

try:
    event = json.loads(blob) if blob.strip().startswith("{") else {}
except ValueError:
    event = {}
tool_name = (
    event.get("tool_name")
    or (event.get("tool") or {}).get("name")
    or event.get("toolName")
    or ""
)

if tool_name not in {"Bash", "Terminal", "execute_command", "run_command"}:
    sys.exit(0)

command = (
    event.get("tool_input", {}).get("command")
    if isinstance(event.get("tool_input"), dict)
    else None
) or blob

# Only a real invocation of enrich-assets.js (start of command, or after
# &&/;/|/bash/sh/./) is in scope — a grep/cat/rg of the script's path as an
# argument to another program is not an invocation.
invoked = re.search(
    r"(?:^|[;&|]|\bbash\s+|\bsh\s+|(?<=\s)\./|\bnode\s+)"
    r"(?:[^\s\"';&|]*/)?scripts/assets/enrich-assets\.js\b",
    command,
)
if not invoked:
    sys.exit(0)


def resolve_worktree(cmd):
    """Find the worktree the command runs in, the same way guard-da-publish.sh
    does: a leading `cd <path>` or an absolute path to a script under this
    skill directory. Falls back to the main checkout when neither is found."""
    candidate_dirs = []
    m = re.search(r"(?:^|[;&|]|\bcd\s)\s*cd\s+([^\s;&|]+)", cmd)
    if not m:
        m = re.search(r"(?:^|\s)cd\s+([^\s;&|]+)", cmd)
    if m:
        candidate_dirs.append(m.group(1).strip().strip("'\""))
    for pm in re.finditer(r"(/[^\s;&|'\"]+/\.claude/skills/rebrand-portal/[^\s;&|'\"]+)", cmd):
        candidate_dirs.append(os.path.dirname(pm.group(1)))

    for d in candidate_dirs:
        try:
            root = subprocess.run(
                ["git", "-C", d, "rev-parse", "--show-toplevel"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            root = ""
        if root:
            return root
    return fallback_project_dir


def current_commit(repo_root):
    try:
        return subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


MANDATORY_CHECKS = {
    "residue",
    "structural-residue",
    "icon-reference-resolution",
    "welcome-header-home-link",
    "header-logo",
    "icon-render",
}


def deny(reason):
    sys.stderr.write(
        "Blocked by rebrand-portal Step 5 verify gate: " + reason + "\n"
        "Run the consolidated verify.mjs pass with --write-report before Step 5:\n"
        "  node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs "
        "--preview <branch>.dev.frescopamedia.com --company <companyKey> "
        "--write-report .internal/verify-report.json\n"
    )
    sys.exit(2)


repo_root = resolve_worktree(command)
report_path = os.path.join(repo_root, ".internal", "verify-report.json")

if not os.path.isfile(report_path):
    deny("no verify.mjs report found at .internal/verify-report.json — Step 4g has not been run.")

try:
    with open(report_path, "r", encoding="utf-8") as fh:
        report = json.load(fh)
except (OSError, ValueError) as e:
    deny(f"verify-report.json is unreadable ({e}) — re-run verify.mjs --write-report.")

checked_commit = report.get("checkedCommit")
head_commit = current_commit(repo_root)
if not checked_commit or not head_commit or checked_commit != head_commit:
    deny(
        f"verify-report.json is stale (checked commit {checked_commit!r}, "
        f"current HEAD {head_commit!r}) — re-run verify.mjs --write-report after your latest changes."
    )

results = report.get("results", {})
missing = [name for name in MANDATORY_CHECKS if name not in results]
if missing:
    deny(f"verify-report.json is missing mandatory check(s): {', '.join(sorted(missing))} — re-run the consolidated verify.mjs pass.")

failing = [name for name in MANDATORY_CHECKS if not results.get(name, {}).get("pass")]
if failing:
    reasons = "; ".join(f"{name}: {results[name].get('reason', '(no reason)')}" for name in sorted(failing))
    deny(f"mandatory check(s) FAILED: {reasons}")

sys.exit(0)
PY
