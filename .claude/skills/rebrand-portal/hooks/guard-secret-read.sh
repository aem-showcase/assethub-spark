#!/usr/bin/env bash
#
# PreToolUse guard for the rebrand-portal skill.
#
# Secret files (token.env -> DA_TOKEN; cloudflare/.secrets, secret.env -> DM
# creds) must never be printed to stdout — not even "redacted". Redaction of a
# secret is unreliable (a length-bounded sed regex leaves the tail of a long
# token intact; base64/multiline/error paths dump the raw value) and violates
# I2 (never echo or read a token back). Blocks any shell command that pipes a
# secret file through a content-dumping tool. Inspect the file's *shape*
# instead: `grep -c '^DA_TOKEN=' token.env`, `wc -c token.env`, `ls -la`, or an
# authenticated status probe (`curl -w '%{http_code}'` after sourcing) — none of
# which put the value on stdout. Sourcing the file (`. ./token.env`) is allowed;
# it loads the value into the environment without printing it.
#
# Defense-in-depth, NOT a sandbox: pattern-based over the tool input, so unusual
# command shapes can slip past. Complements I2.
#
# Each step of a compound command is judged on its own. Matching a secret filename
# in one step against a dumping tool in a *different* step is what blocked ten
# harmless commands in the 2026-09-18 Copilot run (session 408b4bdc) -- e.g.
# `. ./token.env && curl ... > /tmp/f.html && cat /tmp/f.html`, where the secret is
# sourced and never printed and the `cat` targets a downloaded page.
#
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow.
# Exit 2 = block. On block the reason goes to stderr (Claude Code) *and* to a
# permissionDecision object on stdout (Copilot CLI, which discards stderr).
# Works for Claude Code and Copilot CLI PreToolUse hooks.
# Set REBRAND_GUARDS_WATCH_ONLY=1 to log blocks instead of enforcing them.

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
    event = json.loads(blob) if blob.strip().startswith("{") else {}
except ValueError:
    event = {}

tool_name = (
    event.get("tool_name")
    or (event.get("tool") or {}).get("name")
    or event.get("toolName")
    or ""
)

# Only shell commands are in scope. File edits (how token.env is written) and
# every other tool stay allowed.
#
# Host CLIs disagree on both the tool name and the argument key: Claude Code sends
# tool_name/tool_input, Copilot CLI sends toolName/toolArgs and lowercase tool names.
# Matching only one dialect makes the guard silently inert on the other host.
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

# Content-dumping tools that would put a file's bytes on stdout. `grep`/`rg` are here
# because a bare `grep DA_TOKEN token.env` prints the whole matching line (the value) — only
# a counting/quiet grep is safe (handled below). `echo`/`printf` are NOT in this set: they
# emit their literal arguments, not a file's contents, so `echo "==="; . ./token.env; curl`
# (a legitimate probe with a status banner) must pass. The one echo/printf leak shape —
# command-substitution that dumps the secret, e.g. `echo $(cat token.env)` — is still caught
# because `cat` and the filename land in the same step. Passing the secret filename as a
# *flag argument* to a tool that is not a dumping tool (e.g. `script --token-file token.env`,
# `cp`, `ls`, `mv`, `ln`, `find`) never puts the value on stdout, so those pass too.
SECRET_FILE = re.compile(r"(?:^|[\s/=('\"])(?:token\.env|secret\.env|\.secrets)\b")
DUMP = re.compile(
    r"\b(?:cat|head|tail|sed|awk|less|more|most|xxd|od|hexdump|strings|nl|tac|"
    r"rev|cut|tr|base64|tee|grep|egrep|fgrep|rg)\b"
)
GREP = re.compile(r"\b(?:grep|egrep|fgrep|rg)\b")
COUNT_OR_QUIET = re.compile(r"(?:^|\s)-\w*[cq]\w*|--count|--quiet|--silent")
NON_GREP_DUMP = re.compile(
    r"\b(?:cat|head|tail|sed|awk|less|more|xxd|od|strings|printf|echo|base64|tee|tr|cut|rev)\b"
)
NON_AWK_DUMP = re.compile(
    r"\b(?:cat|head|tail|sed|less|more|xxd|od|strings|printf|echo|base64|tee|tr|cut)\b"
)
FLAG_TAKING_VALUE = {"-e", "-f", "--regexp", "--file", "-m", "--max-count"}


def grep_file_operands(step):
    """The files a grep-family step actually reads, or None if unparseable.

    `grep -n "token.env" .gitignore` searches .gitignore *for the string*
    "token.env" — it never opens the secret. Matching the filename anywhere in
    the step confuses the search pattern with the file being read.
    """
    try:
        tokens = shlex.split(step)
    except ValueError:
        return None
    for index, token in enumerate(tokens):
        if os.path.basename(token) not in {"grep", "egrep", "fgrep", "rg"}:
            continue
        rest = tokens[index + 1:]
        pattern_seen = False
        files, skip_next = [], False
        for token_ in rest:
            if skip_next:
                skip_next = False
                continue
            if token_.startswith("-"):
                if token_ in FLAG_TAKING_VALUE:
                    skip_next = True
                    # -e/-f supply the pattern explicitly, so the next bare word
                    # is already a file.
                    pattern_seen = True
                continue
            if not pattern_seen:
                pattern_seen = True
                continue
            files.append(token_)
        return files
    return None


def leaks(step):
    """True when this single step would put a secret file's contents on stdout."""
    # git commands never dump a secret file's *contents* to stdout the way cat does,
    # and a commit message or a staged path legitimately mentions these filenames
    # (e.g. committing this very hook). Policing git is guard-auth-bypass-commit.sh's
    # job, not this one — skip git to avoid false-positiving on the name.
    if re.search(r"(?:^|[\s;&|(])git\s", step) or step.strip().startswith("git "):
        return False

    # Both conditions must hold *in this same step*: the secret file is named here,
    # and a dumping tool runs here. Either one alone is harmless — `. ./token.env`
    # loads the value without printing it, and `cat /tmp/page.html` prints a file
    # that is not a secret.
    if not SECRET_FILE.search(step) or not DUMP.search(step):
        return False

    # When grep is the only dumping tool, judge the files it actually reads
    # rather than the whole step: the secret filename may be the search *pattern*
    # (`grep -n "token.env" .gitignore`), which opens nothing sensitive.
    if GREP.search(step) and not NON_GREP_DUMP.search(step):
        operands = grep_file_operands(step)
        if operands is not None and not any(SECRET_FILE.search(" " + f) for f in operands):
            return False

    # Safe exception: a counting/quiet grep prints only a number or nothing, never
    # the matched line. Scoped to this step, so an unrelated `sed` elsewhere in the
    # compound command can no longer revoke it.
    if GREP.search(step) and not NON_GREP_DUMP.search(step) and COUNT_OR_QUIET.search(step):
        return False

    # One narrow, safe exception: `awk` used ONLY to print a field *length*, never
    # the value. Allow `awk ... length($2) ...` as long as it never prints the raw
    # field (`print $2` / `print$2` / `print $0`).
    if (
        re.search(r"\bawk\b", step)
        and not NON_AWK_DUMP.search(step)
        and "length(" in step
        and not re.search(r"print\s*\$(?:2|0)\b", step)
    ):
        return False

    return True


offending = next((s for s in guardlib.command_segments(command) if leaks(s)), None)
if offending is None:
    sys.exit(0)

guardlib.deny(
    "secret-read",
    "this step would print a secret file (token.env / .secrets / secret.env) to "
    "stdout. Redaction of a secret is prohibited (I2) and unreliable — a "
    "length-bounded regex leaves the tail of a long token intact.",
    offending=offending,
    route=(
        "check the file's shape without printing the value: "
        "`grep -c '^DA_TOKEN=' token.env` (present?), "
        "`awk -F= '/^DA_TOKEN=/{print length($2)}' token.env` (length only), "
        "`wc -c token.env` / `ls -la token.env`; or verify it live with "
        "`curl -s -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer "
        "$DA_TOKEN\" <url>` after `set -a; . ./token.env; set +a`. To read or write "
        "a DA document, use scripts/assets/publish-page.js (--pull / --push) rather "
        "than hand-rolling curl."
    ),
)
PY
