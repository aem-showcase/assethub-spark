"""Shared helpers for the rebrand-portal PreToolUse guards.

Two problems this solves, both diagnosed from the 2026-09-18 Copilot CLI run
(session 408b4bdc) in which ten harmless commands were blocked:

1. Copilot CLI discards a hook's stderr. The agent saw only
   "Denied by preToolUse hook: hook exited with code 2" -- no guard name, no
   reason, no alternative -- so it could not tell a policy block from a broken
   environment. It concluded the environment was flaky and retried for ~35
   minutes. ``deny()`` therefore emits the documented Copilot JSON decision on
   stdout *as well as* the Claude Code stderr + exit 2 contract, so the reason
   reaches the model on both hosts.

2. A guard newly registered for a host it has never run on can take out the
   critical path on its first session, with nobody having seen it run there.
   ``watch_only()`` downgrades every block to a logged observation so a guard
   can be shadowed for one run before it is allowed to deny.
"""

import json
import os
import re
import sys

# Splits a compound shell command into the steps a human would call separate
# commands. The guards must judge each step on its own: matching a secret
# filename in one step against a dumping tool in another is what produced every
# false positive in the Disney run.
_SEGMENT_SPLIT = re.compile(r"&&|\|\||(?<!\|)\|(?!\|)|;|\n")

# Host CLIs disagree on the shell tool's name. Claude Code sends "Bash";
# Copilot CLI sends "bash". Matching only one dialect is how these guards sat
# inert on Copilot until 2026-09-18 -- compare lowercased, always.
BASH_TOOLS = {
    "bash", "terminal", "execute_command", "run_command", "shell", "run_in_terminal",
}


def is_bash_tool(event):
    """True when this PreToolUse event is a shell command on either host."""
    name = event.get("tool_name") or event.get("toolName") or ""
    return name.lower() in BASH_TOOLS


def tool_input_of(event):
    """The tool's argument dict, under whichever key this host used.

    Claude Code sends `tool_input`, Copilot CLI sends `toolArgs`. Reading only
    one yields an empty command on the other host -- a guard that sees no
    command silently allows everything.
    """
    for key in ("tool_input", "toolArgs", "tool_args", "arguments", "input"):
        value = event.get(key)
        if isinstance(value, dict):
            return value
    nested = (event.get("tool") or {}).get("input")
    return nested if isinstance(nested, dict) else {}


def command_segments(command):
    """Split a compound shell command into individually judgeable steps."""
    if not command:
        return []
    # A backslash-newline continuation is one command, not two.
    flattened = re.sub(r"\\\s*\n", " ", command)
    return [seg for seg in _SEGMENT_SPLIT.split(flattened) if seg.strip()]


def watch_only():
    """True when guards should log what they would block instead of blocking.

    Set REBRAND_GUARDS_WATCH_ONLY=1 for the first run of any guard on a host it
    has never executed on before.
    """
    return os.environ.get("REBRAND_GUARDS_WATCH_ONLY", "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _watch_log_path():
    return os.environ.get(
        "REBRAND_GUARDS_WATCH_LOG",
        os.path.join(os.path.expanduser("~"), ".rebrand-portal-guards-watch.log"),
    )


def deny(guard, reason, route=None, offending=None):
    """Block the tool call (or log it, under watch-only) and exit.

    guard     short guard name, e.g. "secret-read" -- always named so the agent
              knows which rule it hit rather than just "denied".
    reason    why this specific command was refused.
    route     the supported way to achieve the same thing. A block that does not
              name an alternative produces a retry loop; one that does produces a
              single corrected step.
    offending the exact command step that triggered the block, if applicable.
    """
    parts = ["Blocked by rebrand-portal %s guard: %s" % (guard, reason)]
    if offending:
        parts.append("Offending step: %s" % offending.strip())
    if route:
        parts.append("Do this instead: %s" % route)
    message = "\n".join(parts)

    if watch_only():
        try:
            with open(_watch_log_path(), "a") as handle:
                handle.write(json.dumps({"guard": guard, "would_block": message}) + "\n")
        except OSError:
            pass
        sys.stderr.write(
            "[watch-only] %s\n(allowed because REBRAND_GUARDS_WATCH_ONLY is set)\n" % message
        )
        sys.exit(0)

    # Copilot CLI: documented preToolUse decision object on stdout. This is the
    # only channel on that host that carries the reason back to the model.
    sys.stdout.write(json.dumps({
        "permissionDecision": "deny",
        "permissionDecisionReason": message,
    }))
    sys.stdout.flush()

    # Claude Code: stderr + exit 2. Both hosts agree on the outcome.
    sys.stderr.write(message + "\n")
    sys.exit(2)
