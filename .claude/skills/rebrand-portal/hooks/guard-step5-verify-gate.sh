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
# Exit 2 = block. On block the reason goes to stderr (Claude Code) *and* to a
# permissionDecision object on stdout (Copilot CLI, which discards stderr) --
# see lib/guardlib.py and README.md. Works for Claude Code and Copilot CLI
# PreToolUse hooks.

set -uo pipefail

HOOK_INPUT="$(cat)"
export HOOK_INPUT

GUARD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
export GUARD_LIB_DIR

FALLBACK_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-$PWD}}"
export FALLBACK_PROJECT_DIR

python3 <<'PY'
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.environ.get("GUARD_LIB_DIR", ""))
import guardlib  # noqa: E402

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

# Host CLIs disagree on both the tool name and the argument key: Claude Code sends
# tool_name/tool_input, Copilot CLI sends toolName/toolArgs and lowercase tool names.
# Matching only one dialect makes the guard silently inert on the other host — which is
# exactly how a live Copilot session ran with none of these guards in effect.
BASH_TOOLS = {
    "bash", "terminal", "execute_command", "run_command", "shell", "run_in_terminal",
}
if tool_name.lower() not in BASH_TOOLS:
    sys.exit(0)


def tool_input_of(ev):
    for key in ("tool_input", "toolArgs", "tool_args", "arguments", "input"):
        value = ev.get(key)
        if isinstance(value, dict):
            return value
    nested = (ev.get("tool") or {}).get("input")
    return nested if isinstance(nested, dict) else {}


command = tool_input_of(event).get("command") or blob

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
    # Added after the Heineken run. `residue` proves the OLD brand is gone; only
    # brand-fidelity proves the NEW brand is the one that was actually measured
    # from the source site, and background-shorthand catches the specific cascade
    # reset that let a surface silently revert. stale-card-images shipped in PR #44
    # with a passing eval but was never added here, so it gated nothing — the same
    # stale-card defect then recurred on a later run. A check that is not in this
    # set does not exist; tests/rebrand/enforced-checks.test.js now asserts that
    # every check verify.mjs exports is either listed here or explicitly waived.
    "brand-fidelity",
    "background-shorthand",
    "stale-card-images",
}

# Checks deliberately NOT gated here, each with the reason it is safe to omit.
# Keeping this explicit is what makes the meta-test meaningful: a new check must
# be a conscious decision in one of the two sets, never an oversight.
WAIVED_CHECKS = {
    # Needs a live preview host; Step 5 can legitimately run before one exists.
    "nav-404-loop": "requires --preview; not always available at Step 5",
    # Subsumed by brand-fidelity, which checks the new values rather than only
    # the absence of the old ones.
    "applied-css": "superseded by brand-fidelity",
    # Needs the enrichment report, which Step 5 is what produces.
    "card-count": "requires the Step 5 enrichment report as input",
    "hero-quality": "requires the Step 5 enrichment report as input",
    # Asserts the ceiling against the PUBLISHED page, which does not exist until
    # Step 5 has authored and previewed it — so it cannot be a precondition for
    # Step 5. It is NOT unenforced: hooks/guard-live-publish-ceiling.sh requires a
    # fresh passing card-ceiling before the landing page is promoted to live.
    "card-ceiling": "requires the published index; gated at live publish, not here",
    # Needs a browser and a deployed origin; gated separately at Step 4g rather
    # than blocking asset enrichment.
    "cascade": "requires a browser and deployed AEM origin; gated at 4g sign-off",
}


def deny(reason):
    guardlib.deny(
        "Step 5 verify gate",
        reason,
        route=(
            "run the consolidated verify.mjs pass with --write-report before Step 5:\n"
            "  node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs "
            "--preview <branch>.dev.frescopamedia.com --company <companyKey> "
            "--report <enrichment-report.json> --write-report .internal/verify-report.json\n"
            "brand-fidelity needs migration-work/brand.json — produce it with:\n"
            "  node .claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs "
            "--url <sourceSiteUrl>"
        ),
    )


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
