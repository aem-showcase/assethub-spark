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
# Contract: reads the PreToolUse event JSON on stdin. Exit 0 = allow.
# Exit 2 = block (message on stderr is shown to the model). Works for
# Claude Code and Copilot CLI PreToolUse hooks.

set -uo pipefail

HOOK_INPUT="$(cat)"
export HOOK_INPUT

python3 <<'PY'
import json
import os
import re
import sys

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
if tool_name not in {"Bash", "Terminal", "execute_command", "run_command"}:
    sys.exit(0)

command = (
    event.get("tool_input", {}).get("command")
    if isinstance(event.get("tool_input"), dict)
    else None
) or blob

# git commands never dump a secret file's *contents* to stdout the way cat does,
# and a commit message or a staged path legitimately mentions these filenames
# (e.g. committing this very hook). Policing git is guard-auth-bypass-commit.sh's
# job, not this one — skip git entirely to avoid false-positiving on the name.
if re.search(r"(?:^|[\s;&|(])git\s", command):
    sys.exit(0)

# Does the command reference a secret file at all?
SECRET_FILE = re.compile(r"(?:^|[\s/=('\"])(?:token\.env|secret\.env|\.secrets)\b")
if not SECRET_FILE.search(command):
    sys.exit(0)

# Content-dumping tools that would put the file's bytes on stdout. `echo`/`printf`
# are included because a common leak shape is `echo $(cat token.env | sed ...)`;
# `grep`/`rg` because a bare `grep DA_TOKEN token.env` prints the whole matching
# line (the value) — only a counting/quiet grep is safe (handled below).
DUMP = re.compile(
    r"\b(?:cat|head|tail|sed|awk|less|more|most|xxd|od|hexdump|strings|nl|tac|"
    r"rev|cut|tr|printf|echo|base64|tee|grep|egrep|fgrep|rg)\b"
)
if not DUMP.search(command):
    # No dumping tool touching the secret (e.g. `ls -la token.env`,
    # `wc -c token.env`, `. ./token.env`). Allow.
    sys.exit(0)

# Safe exception: a counting/quiet grep prints only a number or nothing, never
# the matched line. Allow when grep/rg is the only dumping tool AND it carries a
# count/quiet flag (`-c`, `--count`, `-q`, `--quiet`, `--silent`).
grep_only = re.search(r"\b(?:grep|egrep|fgrep|rg)\b", command) and not re.search(
    r"\b(?:cat|head|tail|sed|awk|less|more|xxd|od|strings|printf|echo|base64|tee|tr|cut|rev)\b",
    command,
)
if grep_only and re.search(r"(?:^|\s)-\w*[cq]\w*|--count|--quiet|--silent", command):
    sys.exit(0)

# One narrow, safe exception: `awk` used ONLY to print a field *length*, never
# the value. Allow `awk ... length($2) ...` as long as it never prints the raw
# field (`print $2` / `print$2` / `print $0`).
awk_only = re.search(r"\bawk\b", command) and not re.search(
    r"\b(?:cat|head|tail|sed|less|more|xxd|od|strings|printf|echo|base64|tee|tr|cut)\b",
    command,
)
if awk_only and "length(" in command and not re.search(r"print\s*\$(?:2|0)\b", command):
    sys.exit(0)

sys.stderr.write(
    "Blocked by rebrand-portal secret-read guard: this command would print a "
    "secret file (token.env / .secrets / secret.env) to stdout. Do NOT cat/sed/"
    "echo a secret to 'redact and inspect' it — redaction of a secret is "
    "prohibited (I2), and length-bounded regexes leak the rest of the value. "
    "Check its shape instead without printing the value: "
    "`grep -c '^DA_TOKEN=' token.env` (present?), "
    "`awk -F= '/^DA_TOKEN=/{print length($2)}' token.env` (length only), "
    "`wc -c token.env` / `ls -la token.env`, or verify it live with "
    "`curl -s -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer "
    "$DA_TOKEN\" <url>` after `set -a; . ./token.env; set +a`.\n"
)
sys.exit(2)
PY
