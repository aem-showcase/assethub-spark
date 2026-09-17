#!/usr/bin/env bash
#
# PreToolUse guard: no theme edit without measured brand tokens.
#
# WHY
# ---
# Step 4's preflight has always checked that the excat design plugin is LOADED. Loaded is
# not the same as used, and the gap between them is where every observed failure lives: in
# 13 consecutive runs the skill was loaded and its extraction step was then abandoned —
# each time citing a missing page-templates.json, which excat's own SKILL.md says to handle
# by passing `[]`. The brand colours those runs applied came from memory, a web search, or
# arithmetic on a logo. Nothing downstream could tell the difference, because Step 4g built
# its expected values out of the very edit it was auditing.
#
# Documentation did not fix this — the correct instruction was on screen every time and was
# not followed. So this is a hook: editing the theme is blocked until measured tokens exist
# on disk. It converts "you should measure the source site" from advice into a precondition.
#
# WHAT IT BLOCKS
# --------------
# Writes/edits to styles/styles.css and styles/brand.css when migration-work/brand.json is
# absent, malformed, or records a rejected extraction (gatePassed != true). Reading them is
# always fine, and every other file is out of scope.
#
# Deliberately NOT blocked: the case where brand.json exists and is valid but tokenMap is
# still empty — filling tokenMap is itself part of editing the theme, so blocking it would
# deadlock. verify.mjs's brand-fidelity check fails on an empty tokenMap instead, which
# catches the same omission at the gate that matters.
#
# Defense-in-depth, NOT a sandbox: an agent determined to route around this can. The point
# is to make the correct path the path of least resistance, and to make the incorrect one
# require a conscious, visible override.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow, exit 2 = block
# (stderr is shown to the model). Works for Claude Code and Copilot CLI.

set -uo pipefail

HOOK_INPUT="$(cat)"
export HOOK_INPUT

FALLBACK_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${COPILOT_PROJECT_DIR:-$PWD}}"
export FALLBACK_PROJECT_DIR

python3 <<'PY'
import json
import os
import re
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

# Host CLIs disagree on both the tool name and the argument key: Claude Code sends
# tool_name/tool_input, Copilot CLI sends toolName/toolArgs and lowercase tool names.
# Matching only one dialect makes the guard silently inert on the other host.
def tool_input_of(ev):
    for key in ("tool_input", "toolArgs", "tool_args", "arguments", "input"):
        value = ev.get(key)
        if isinstance(value, dict):
            return value
    nested = (ev.get("tool") or {}).get("input")
    return nested if isinstance(nested, dict) else {}


tool_input = tool_input_of(event)
tool_key = tool_name.lower()

EDIT_TOOLS = {
    "edit", "write", "multiedit", "notebookedit", "create", "str_replace_editor",
    "apply_patch", "str_replace_based_edit_tool",
}
BASH_TOOLS = {
    "bash", "terminal", "execute_command", "run_command", "shell", "run_in_terminal",
}

# Theme files whose colour values must trace to a measurement.
GUARDED = ("styles/styles.css", "styles/brand.css")

targets = []
if tool_key in EDIT_TOOLS:
    for key in ("file_path", "path", "notebook_path", "filePath"):
        v = tool_input.get(key)
        if isinstance(v, str):
            targets.append(v)
elif tool_key in BASH_TOOLS:
    cmd = tool_input.get("command") or ""
    # Only writes. A grep/cat/sed -n of the file is not an edit.
    if re.search(r"(?:>|>>|\btee\b|\bsed\s+-i\b|\bperl\s+-p?i\b|\bpatch\b)", cmd):
        for g in GUARDED:
            if g in cmd:
                targets.append(g)
else:
    sys.exit(0)

hits = [t for t in targets if any(t.replace("\\", "/").endswith(g) for g in GUARDED)]
if not hits:
    sys.exit(0)


def resolve_repo_root(paths):
    """Anchor on the guarded file itself when it is absolute, so worktrees are handled."""
    for p in paths:
        if os.path.isabs(p):
            d = p
            for _ in range(8):
                d = os.path.dirname(d)
                if not d or d == "/":
                    break
                if os.path.isdir(os.path.join(d, ".git")) or os.path.isfile(os.path.join(d, ".git")):
                    return d
    return fallback_project_dir


repo_root = resolve_repo_root(hits)
brand_path = os.path.join(repo_root, "migration-work", "brand.json")


def deny(reason, remedy):
    sys.stderr.write(
        "Blocked by rebrand-portal brand-extraction gate: " + reason + "\n\n" + remedy + "\n"
    )
    sys.exit(2)


EXTRACT_CMD = (
    "  node .claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs \\\n"
    "    --url <the customer's real source site URL>\n"
)

if not os.path.isfile(brand_path):
    deny(
        "migration-work/brand.json does not exist, so the source site has not been measured.\n"
        "Editing the theme now means the colours come from memory or a guess — that is the\n"
        "defect this gate exists to prevent, and it is not detectable later.",
        "Measure the source site first (no clone or npm install is needed at run time;\n"
        "if the toolchain is not ready, --check prints the fix):\n" + EXTRACT_CMD,
    )

try:
    with open(brand_path, "r", encoding="utf-8") as fh:
        brand = json.load(fh)
except (OSError, ValueError) as e:
    deny(
        f"migration-work/brand.json is unreadable ({e}).",
        "Re-run extraction:\n" + EXTRACT_CMD,
    )

prov = brand.get("provenance") or {}
if prov.get("gatePassed") is not True:
    signals = prov.get("gateSignals") or []
    detail = ("\n  - " + "\n  - ".join(signals)) if signals else ""
    deny(
        "migration-work/brand.json exists but records a FAILED extraction "
        f"(gatePassed={prov.get('gatePassed')!r})." + detail + "\n"
        "The measured page was an age gate, cookie wall or bot interstitial, so its colours\n"
        "and fonts are the interstitial's, not the brand's.",
        "Do NOT hand-edit brand.json to clear this flag. Re-extract from a URL that renders\n"
        "real content (a regional landing page, newsroom, or brand-guidelines page):\n"
        + EXTRACT_CMD,
    )

colors = ((brand.get("tokens") or {}).get("colors") or {})
if not colors:
    deny(
        "migration-work/brand.json contains no measured colours.",
        "Re-run extraction and confirm it reports real values:\n" + EXTRACT_CMD,
    )

sys.exit(0)
PY
