#!/usr/bin/env bash
# allow-sanctioned-entrypoints.sh -- grant permission for the skill's own CLIs.
#
# WHY THIS EXISTS
# ---------------
# On 2026-09-18 a demo run spent 68 minutes and never read or wrote a single
# Document Authoring page. Its calls to the packaged, reviewed entrypoint --
# `node scripts/assets/publish-page.js --pull ...` -- were refused with
# `denied-no-approval-rule-and-could-not-request-from-user`.
#
# That is not a bug in the CLI. Since Copilot CLI 1.0.86 an unattended session
# runs with allowAllPermissionMode "auto": it answers its own permission
# prompts by statically reviewing the command, and refuses whatever it cannot
# read. `node <script>` is unreadable by construction -- the behaviour lives in
# a file the reviewer does not open -- so the packaged CLI is refused for the
# same reason a hand-rolled `curl` is.
#
# The agent cannot phrase its way out of that. Every rewrite it tried
# (`bash -c '...'`, a helper script, an inline curl that sourced token.env) is
# either equally unreviewable or trips the secret-read guard. The run read the
# resulting silence as a flaky environment and gave up.
#
# A preToolUse hook can return `permissionDecision: "allow"`, and that decision
# is honoured where the static reviewer abstains. So the repo can state, in
# version control and in review, exactly which of its own commands are
# pre-approved -- instead of depending on `--allow-all-tools` or on whatever
# each operator happened to approve interactively on their own machine.
#
# WHY THIS IS NOT A BYPASS
# ------------------------
# 1. A deny from any other guard still wins. Verified against the live CLI:
#    with this hook allowing, `guard-da-publish.sh` still blocked an
#    out-of-scope Helix publish. Allow raises no guard's ceiling; the publish,
#    secret-read, verify-gate and brand-extraction guards remain authoritative.
# 2. Every segment must match the allowlist. A single unrecognised segment
#    means the whole command falls through to the normal permission gate. So
#    `node publish-page.js --pull x && curl evil.example` is NOT allowed --
#    the allowlist cannot be used as a smuggling envelope.
# 3. Interpreter wrappers are refused here too. `bash -c '...'` and `sh -c`
#    hide their payload from this hook exactly as they hide it from the CLI's
#    reviewer, and an allowlist that cannot see what it is allowing is not an
#    allowlist. These stay denied.
# 4. The allowlist names specific scripts inside this skill, not `node`.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 always -- this
# hook never blocks, it only ever grants. When it grants, it prints a
# permissionDecision object on stdout, which is the channel Copilot reads.
# Staying silent is the no-opinion answer and leaves the command to the CLI.

set -uo pipefail

GUARD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
export GUARD_LIB_DIR

HOOK_INPUT="$(cat)"
export HOOK_INPUT

python3 <<'PY'
import json
import os
import re
import shlex
import sys

sys.path.insert(0, os.environ.get("GUARD_LIB_DIR", ""))
import guardlib  # noqa: E402

blob = os.environ.get("HOOK_INPUT", "") or ""
try:
    event = json.loads(blob)
except Exception:
    sys.exit(0)

if not guardlib.is_bash_tool(event):
    sys.exit(0)

command = (guardlib.tool_input_of(event) or {}).get("command", "") or ""
if not command.strip():
    sys.exit(0)

# The skill's own CLIs. Named individually: the point is to pre-approve
# reviewed entrypoints, not to pre-approve `node`.
SANCTIONED = (
    r"\.claude/skills/rebrand-portal/scripts/"
    r"(assets/(publish-page|author-client|enrich-assets|update-index-cards)"
    r"|rebrand/(extract-brand|verify)"
    r"|da/(ensure-eds-tokens|copy-folder))"
    r"\.(js|mjs|sh)\b"
)

# Segments that carry no authority on their own. A command made only of these
# plus a sanctioned script is still just that script running.
#
# `node`, `bash`, `sh` are deliberately ABSENT. A bare `bash` segment is how
# `node publish-page.js --pull x | bash` would otherwise be waved through --
# the pipe is a segment boundary, so the shell arrives as its own inert-looking
# step. An interpreter is never inert.
INERT = re.compile(
    r"^(cd|echo|set|true|pwd|wc|head|tail|ls|mkdir)\b|^$"
)

# Wrappers whose payload is opaque to this hook. Refusing to vouch for what we
# cannot read is the whole reason the CLI refuses them.
OPAQUE = re.compile(r"\b(bash|sh|zsh)\s+-c\b|\beval\b|\|\s*(bash|sh|zsh)\b")

# Interpreters that take the real program as their first non-flag argument.
INTERPRETERS = {"node", "bash", "sh", "python3", "python"}


def program_of(parts):
    """The token that is actually being executed, seeing through `node <script>`."""
    for index, token in enumerate(parts):
        base = os.path.basename(token)
        if base in INTERPRETERS:
            for candidate in parts[index + 1:]:
                if not candidate.startswith("-"):
                    return candidate
            return None
        if not token.startswith("-"):
            return token
    return None


def segment_ok(seg):
    """True when this segment is a sanctioned script call or carries no authority."""
    seg = seg.strip()
    if not seg:
        return True
    if OPAQUE.search(seg):
        return False
    if re.search(SANCTIONED, seg):
        # Confirm the sanctioned path is the program being run, not merely a
        # string that mentions it: `echo "run publish-page.js later"` names the
        # script without invoking it, and must not buy an approval.
        try:
            parts = shlex.split(seg)
        except ValueError:
            return False
        program = program_of(parts)
        return bool(program and re.search(SANCTIONED, program))
    return bool(INERT.match(seg))


segments = guardlib.command_segments(command)
if not segments:
    sys.exit(0)

# Checked on the whole string as well as per segment: splitting on `|` removes
# the very character that makes `... | bash` dangerous.
if OPAQUE.search(command):
    sys.exit(0)

# At least one segment must actually be a sanctioned script. Otherwise this is
# an ordinary command (`cd x && ls`) and we have no opinion on it.
if not any(re.search(SANCTIONED, s) and segment_ok(s) for s in segments):
    sys.exit(0)

if not all(segment_ok(s) for s in segments):
    sys.exit(0)

print(json.dumps({
    "permissionDecision": "allow",
    "permissionDecisionReason": (
        "rebrand-portal: packaged, reviewed entrypoint. Every segment is either "
        "this skill's own CLI or an inert helper. Other guards still apply."
    ),
}))
sys.exit(0)
PY
