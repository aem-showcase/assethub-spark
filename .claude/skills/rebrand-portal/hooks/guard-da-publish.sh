#!/usr/bin/env bash
#
# PreToolUse guard for the rebrand-portal skill.
#
# Blocks any Document Authoring / Helix publish whose target path is not
# under the demo's company folder (`customer.daFolder` in
# .internal/onboarding-state.json). Fail-safe: if no company folder is
# resolved yet, all DA/Helix publish writes are blocked.
#
# Defense-in-depth, NOT a sandbox: it is pattern-based over the tool
# input, so unusual command shapes or paths constructed inside a wrapper
# can slip past. The skill still passes explicit /<company>/... paths as
# args (SKILL.md Step 4) to keep them visible here.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow.
# Exit 2 = block (message on stderr is shown to the model). Works for
# Claude Code and Copilot CLI PreToolUse hooks.

set -uo pipefail

HOOK_INPUT="$(cat)"
export HOOK_INPUT

# Fallback state file only — the real resolution happens in Python below,
# scoped to the worktree the command actually targets. This env value is
# the last resort when no worktree can be parsed from the command.
FALLBACK_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-$PWD}}"
export FALLBACK_STATE_FILE="${FALLBACK_PROJECT_DIR}/.internal/onboarding-state.json"

python3 <<'PY'
import json
import os
import re
import subprocess
import sys

blob = os.environ.get("HOOK_INPUT", "") or ""
fallback_state_file = os.environ.get("FALLBACK_STATE_FILE", "")

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
if tool_name in {"Write", "Edit", "MultiEdit", "NotebookEdit", "str_replace_editor"}:
    sys.exit(0)

tool_input = (
    event.get("tool_input")
    or (event.get("tool") or {}).get("input")
    or {}
)
command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""


def resolve_state_file():
    """Pick the onboarding-state.json to enforce against.

    The harness fixes CLAUDE_PROJECT_DIR (and the event `cwd`) to the main
    checkout for the whole session, so neither tells us which worktree a
    command actually targets. Each demo runs in its own git worktree with
    its own .internal/onboarding-state.json (SKILL.md Step 2), so we derive
    the worktree from a `cd <path>` or an absolute script/path token in the
    command string, and read that worktree's state. Falls back to the main
    checkout's file only when no worktree path can be parsed.
    """
    candidate_dirs = []

    # A leading `cd <path> && ...` names the worktree the command runs in.
    m = re.search(r"(?:^|[;&|]|\bcd\s)\s*cd\s+([^\s;&|]+)", command)
    if not m:
        m = re.search(r"(?:^|\s)cd\s+([^\s;&|]+)", command)
    if m:
        candidate_dirs.append(m.group(1).strip().strip("'\""))

    # An absolute path to a repo file/script also identifies the worktree
    # (e.g. /…/assethub-spark.worktrees/demo-acme/.claude/skills/…/copy-folder.sh).
    for pm in re.finditer(r"(/[^\s;&|'\"]+/\.claude/skills/rebrand-portal/[^\s;&|'\"]+)", command):
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
            sf = os.path.join(root, ".internal", "onboarding-state.json")
            if os.path.isfile(sf):
                return sf

    return fallback_state_file


state_file = resolve_state_file()

# Resolve the allowed company folder from the onboarding state file.
da_folder = None
try:
    with open(state_file, "r", encoding="utf-8") as fh:
        state = json.load(fh)
    da_folder = (state.get("customer") or {}).get("daFolder")
except (OSError, ValueError):
    da_folder = None

if isinstance(da_folder, str):
    da_folder = da_folder.strip().rstrip("/")
    if da_folder and not da_folder.startswith("/"):
        da_folder = "/" + da_folder
else:
    da_folder = None


def under_folder(path):
    """True if `path` is inside (or equal to) the company folder."""
    if not da_folder:
        return False
    p = "/" + path.strip().lstrip("/")
    p = re.split(r"[?#]", p)[0].rstrip("/")
    return p == da_folder or p.startswith(da_folder + "/")


def deny(reason):
    sys.stderr.write(
        "Blocked by rebrand-portal publish guard: " + reason + "\n"
        "Demo publishes are scoped to the company folder "
        f"({da_folder or '<unset>'}). "
        "Only publish paths under that folder.\n"
    )
    sys.exit(2)


# Only an executed shell command can publish/copy. Scan the Bash command
# string, not the whole event JSON — this alone stops false positives from
# tools that merely *contain* a path in their input (e.g. an
# AskUserQuestion preview, or a `grep` whose argument happens to be a DA
# URL / the copy-folder.sh path). If there is no command, there is nothing
# to guard.
scan = command or ""

# A read-only inspection of the command text (grep/rg/cat/… over a script
# or a heredoc that merely *mentions* these URLs) is not an invocation.
# Require the DA-copy-helper match to sit in command/execution position,
# not as an argument to another program.
violations = []

if scan:
    # 1) Helix Admin publish/preview/live: .../<verb>/{org}/{repo}/{ref}/<path>
    #    These are always writes to the hosted site -> enforce the path.
    for m in re.finditer(
        r"admin\.hlx\.page/(?:preview|live|publish)/[^/\s\"']+/[^/\s\"']+/[^/\s\"']+((?:/[^\s\"'?#]+)*)",
        scan,
    ):
        path = m.group(1) or "/"
        if not under_folder(path):
            violations.append("Helix publish -> " + path)

    # 2) DA source write (PUT/POST upload) to .../source/{org}/{repo}/<path>
    #    Only enforce when a write method/upload is present in the command.
    is_write = re.search(
        r"(-X|--request)\s*(POST|PUT|DELETE)|--upload-file|(^|\s)-T\s",
        scan,
        re.IGNORECASE,
    )
    if is_write:
        for m in re.finditer(
            r"admin\.da\.live/source/[^/\s\"']+/[^/\s\"']+((?:/[^\s\"'?#]+)*)",
            scan,
        ):
            path = m.group(1) or "/"
            if not under_folder(path):
                violations.append("DA source write -> " + path)

    # 3) DA copy: only the destination matters (source is a read). Require the
    #    destination to sit alongside a real DA copy call (admin.da.live/copy
    #    somewhere in the command), so a bare `destination=/x` in unrelated
    #    text is not treated as a publish.
    if re.search(r"admin\.da\.live/copy/", scan):
        for m in re.finditer(
            r"destination[\"']?\s*[:=]\s*[\"']?(/[^\s\"',&]+)",
            scan,
            re.IGNORECASE,
        ):
            path = m.group(1)
            if not under_folder(path):
                violations.append("DA copy destination -> " + path)

    # 4) Packaged DA copy helper. Enforce its <companyKey> arg before the
    #    script runs — but only when the script is actually *invoked*
    #    (start of command, or after &&/;/|/`bash`/`sh`/`./`), never when its
    #    path appears as an argument to grep/cat/rg/etc.
    for m in re.finditer(
        r"(?:^|[;&|]|\bbash\s+|\bsh\s+|(?<=\s)\./)\s*"
        r"(?:[^\s\"';&|]*/)?(?:scripts/da-copy-folder\.sh|scripts/da/copy-folder\.sh)"
        r"\s+[^\s\"';&|]+\s+[^\s\"';&|]+\s+([^\s\"';&|]+)",
        scan,
    ):
        company = "/" + m.group(1).strip().strip("/")
        if not under_folder(company):
            violations.append("DA copy script destination -> " + company)

if violations:
    if not da_folder:
        deny(
            "no company folder resolved yet (customer.daFolder unset) — "
            "refusing DA/Helix publish until Step 2 sets it. "
            + "; ".join(violations)
        )
    deny("target(s) outside the company folder: " + "; ".join(violations))

sys.exit(0)
PY
