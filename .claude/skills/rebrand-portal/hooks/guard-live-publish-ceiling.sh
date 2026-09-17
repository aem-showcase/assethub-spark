#!/usr/bin/env bash
#
# PreToolUse guard for the rebrand-portal skill.
#
# Blocks promoting the demo's landing page to LIVE unless a fresh, passing
# `card-ceiling` result exists for this company.
#
# Why this guard exists, and why it gates `live` rather than `preview`:
#
# Every other ceiling barrier lives inside the packaged scripts, so each one
# is only as good as the agent's decision to call it. Live runs have
# repeatedly imported the skill's internals from a hand-written .mjs instead
# (`apply-index-cards.mjs` imported replaceBlockRows; `heineken-gated-enrich.mjs`
# imported enrichAssets) or driven the HTTP API with curl directly - 273
# requests on one run. Those routes are legitimate and are NOT blocked here.
#
# What they cannot avoid is publishing. A demo that is never promoted to live
# is not a demo, so the live publish is the one chokepoint every route shares.
# `card-ceiling` reads the PUBLISHED page rather than any report the run wrote
# about itself, which is the lesson from `stale-card-images` - a defect that
# passed a report-based check and shipped twice.
#
# The gate is on `live`/`publish` and never on `preview`, because the check
# needs a previewed page to read: author -> preview (allowed) -> verify -> live
# (gated). Gating preview would make the check impossible to satisfy.
#
# Defense-in-depth, NOT a sandbox: it is pattern-based over the tool input, so
# a publish performed inside a compiled program, or via an SDK that never puts
# the URL in the command string, is not visible here. It raises the cost of the
# bypass and removes the accidental one; it does not make the bypass impossible.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow.
# Exit 2 = block (message on stderr is shown to the model). Works for
# Claude Code, Codex and Copilot CLI PreToolUse hooks.

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
from datetime import datetime, timezone

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
# tool_name/tool_input, Copilot CLI sends toolName/toolArgs with lowercase tool names.
# Matching only one dialect makes the guard silently inert on the other host - which is
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


command = tool_input_of(event).get("command") or ""
if not command:
    sys.exit(0)

# Only a promotion to live is in scope. `preview` is deliberately excluded: the
# ceiling check reads the previewed page, so it cannot be a precondition for it.
live_targets = [
    m for m in re.finditer(
        r"admin\.hlx\.page/(live|publish)/[^/\s\"']+/[^/\s\"']+/[^/\s\"']+((?:/[^\s\"'?#]+)*)",
        command,
    )
]
if live_targets:
    # A read-only mention (grep/cat over a script that contains the URL) is not a publish.
    # Helix promotion is a POST; requiring the write verb keeps inspection commands free.
    if not re.search(r"(-X|--request)\s*(POST|PUT|DELETE)|--upload-file|(^|\s)-T\s", command, re.IGNORECASE):
        sys.exit(0)
    # Only the landing page carries the card blocks. Publishing other pages in the
    # company folder (search, detail pages) is not gated.
    INDEX_RE = re.compile(r"/(?:index)?$|/index\b")
    if not any(INDEX_RE.search(m.group(2) or "/") for m in live_targets):
        sys.exit(0)
else:
    # The packaged CLI builds the admin URL internally, so the literal above never
    # appears in the command string. Without this branch, adding publish-page.js would
    # have opened a hole straight through the gate it is meant to pass through.
    # A mention is not an invocation: the script path can appear inside a heredoc,
    # a grep, or an editor command. Anchor on invocation the way the copy-folder
    # rule in guard-da-publish.sh does, so inspection stays free.
    cli = re.search(
        r"(?:^|[;&|]|\bnode\s+|(?<=\s)\./)\s*"
        r"(?:[^\s\"';&|]*/)?scripts/assets/publish-page\.js\b",
        command,
    )
    if not cli:
        sys.exit(0)
    if not re.search(r"--publish(?:\s|=|$)", command):
        sys.exit(0)
    # --preview-only never reaches live, and preview is deliberately ungated: the
    # ceiling check reads the previewed page, so gating it would be unsatisfiable.
    if re.search(r"--preview-only(?:\s|=|$)", command):
        sys.exit(0)
    if re.search(r"--dry-run(?:\s|=|$)", command):
        sys.exit(0)
    pm = re.search(r"--path[=\s]+([^\s\"';&|]+)", command)
    path_arg = pm.group(1) if pm else ""
    if path_arg and not re.search(r"/index(?:\.html)?$|^index(?:\.html)?$", path_arg):
        sys.exit(0)


def resolve_worktree(cmd):
    """Find the worktree the command runs in - same approach as the sibling guards.

    Each demo runs in its own git worktree with its own .internal/, and the harness
    pins CLAUDE_PROJECT_DIR to the main checkout for the whole session, so neither
    that nor the event `cwd` identifies the demo actually being published.
    """
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
        if root and os.path.isdir(os.path.join(root, ".internal")):
            return root
    return fallback_project_dir


repo_root = resolve_worktree(command)

# The company being published, from the demo's own state file.
company_key = None
try:
    with open(os.path.join(repo_root, ".internal", "onboarding-state.json"), "r", encoding="utf-8") as fh:
        state = json.load(fh)
    customer = state.get("customer") or {}
    company_key = customer.get("key") or (customer.get("daFolder") or "").strip("/").split("/")[-1]
except (OSError, ValueError):
    company_key = None

# Only the landing page carries the card blocks; that filter is applied above, per
# invocation form, because the URL form and the CLI form carry the path differently.

report_path = os.path.join(repo_root, ".internal", "verify-report.json")

# How recent a card-ceiling result must be. The page is not a git artifact, so commit
# freshness (which the Step 5 gate uses) proves nothing here: the check has to have been
# run against the page as it stands now. 30 minutes is long enough for an ordinary
# author-verify-publish sequence and short enough that a re-authored page forces a re-check.
MAX_AGE_MINUTES = 30


def deny(reason):
    sys.stderr.write(
        "Blocked by rebrand-portal live-publish ceiling gate: " + reason + "\n"
        "The landing page is about to go live without a current check that it carries\n"
        "the demo's card count. Preview it first, then run:\n"
        "  node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs "
        "--preview <branch>.dev.frescopamedia.com --company <companyKey> "
        "--only card-ceiling --write-report .internal/verify-report.json\n"
        "If it FAILs, re-author the page with:\n"
        "  node .claude/skills/rebrand-portal/scripts/assets/update-index-cards.js "
        "--index-file <index.html> --report-file <enrichment-report.json> --out <index.html>\n"
        "Do not hand-edit the page to satisfy this gate.\n"
    )
    sys.exit(2)


if not os.path.isfile(report_path):
    deny("no verify report at .internal/verify-report.json - card-ceiling has never run.")

try:
    with open(report_path, "r", encoding="utf-8") as fh:
        report = json.load(fh)
except (OSError, ValueError) as e:
    deny(f"verify-report.json is unreadable ({e}) - re-run verify.mjs --write-report.")

result = (report.get("results") or {}).get("card-ceiling")
if not isinstance(result, dict):
    deny(
        "verify-report.json has no card-ceiling result - it was written by a run that "
        "skipped the check (it needs --preview and --company)."
    )

if not result.get("pass"):
    deny(f"card-ceiling FAILED: {result.get('reason', '(no reason)')}")

# A report from a different demo says nothing about this one.
reported_company = report.get("company")
if company_key and reported_company and reported_company != company_key:
    deny(
        f"verify-report.json is for company {reported_company!r}, but this publish targets "
        f"{company_key!r} - re-run verify.mjs --company {company_key}."
    )
if company_key and not reported_company:
    deny(
        "verify-report.json does not record which company it checked - re-run verify.mjs "
        f"--company {company_key} --only card-ceiling --write-report .internal/verify-report.json."
    )

checked_at = report.get("checkedAt")
try:
    when = datetime.fromisoformat(str(checked_at).replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    age_minutes = (datetime.now(timezone.utc) - when).total_seconds() / 60.0
except (TypeError, ValueError):
    deny(f"verify-report.json has an unreadable checkedAt ({checked_at!r}) - re-run verify.mjs.")

if age_minutes > MAX_AGE_MINUTES:
    deny(
        f"card-ceiling was last checked {int(age_minutes)} minutes ago, which is older than "
        f"the {MAX_AGE_MINUTES}-minute window. The page may have been re-authored since - "
        "re-run the check against the current preview."
    )

sys.exit(0)
PY
