#!/usr/bin/env bash
#
# Tests for hooks/guard-da-publish.sh — the PreToolUse publish guard.
#
# The guard must (a) resolve the onboarding-state.json from the *worktree*
# the command targets (a `cd <path>` or an absolute skill-script path),
# NOT from CLAUDE_PROJECT_DIR, which the harness fixes to the main checkout
# for the whole session; and (b) only treat a real shell invocation as a
# publish/copy — never a path that merely appears in read-only text (a
# grep argument, an AskUserQuestion preview, etc.).
#
# Run: bash .claude/skills/rebrand-portal/tests/hooks/guard-da-publish.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/../../hooks/guard-da-publish.sh"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

# Two independent worktrees, each with its own state file, plus a main
# checkout whose state is a *different* company (simulating a concurrent
# session having written it).
for co in apple xiaomi; do
  mkdir -p "$SB/wt-$co/.internal"
  ( cd "$SB/wt-$co" && git init -q && git config user.email t@t && git config user.name t )
  printf '{"customer":{"daFolder":"/%s"}}' "$co" > "$SB/wt-$co/.internal/onboarding-state.json"
done
mkdir -p "$SB/main/.internal"
( cd "$SB/main" && git init -q && git config user.email t@t && git config user.name t )
printf '{"customer":{"daFolder":"/xiaomi"}}' > "$SB/main/.internal/onboarding-state.json"

export CLAUDE_PROJECT_DIR="$SB/main"   # harness always points this at main
APPLE="$SB/wt-apple"
DA="https://admin.da.live"

pass=0; fail=0
ev() { python3 -c "import json,sys; print(json.dumps({'tool_name':sys.argv[1],'tool_input':json.loads(sys.argv[2])}))" "$1" "$2"; }
run() { # $1 label  $2 expected(allow|block)  $3 event-json
  local out code got
  out=$(printf '%s' "$3" | bash "$HOOK" 2>&1); code=$?
  got=$([ $code -eq 0 ] && echo allow || echo block)
  if [ "$got" = "$2" ]; then echo "PASS  $1"; pass=$((pass+1))
  else echo "FAIL  $1  expected=$2 got=$got :: $out"; fail=$((fail+1)); fi
}

# Core collision fix: env points at main (xiaomi) but the command targets
# the apple worktree; the guard must read apple's state and allow /apple.
run "publish /apple in apple worktree (env=xiaomi) allowed" allow \
  "$(ev Bash "{\"command\":\"cd $APPLE && curl -X POST $DA/copy/o/r/f -F destination=/apple/en\"}")"

# Real out-of-scope publish inside the apple worktree is still blocked.
run "publish /disney in apple worktree blocked" block \
  "$(ev Bash "{\"command\":\"cd $APPLE && curl -X POST $DA/copy/o/r/f -F destination=/disney/en\"}")"

# False positive #1: grep whose argument is the copy-folder.sh path.
run "grep over copy-folder.sh path allowed" allow \
  "$(ev Bash "{\"command\":\"grep -rn PAT .claude/skills/rebrand-portal/scripts/da/copy-folder.sh /head /etc\"}")"

# False positive #2: AskUserQuestion preview text containing a path.
run "AskUserQuestion preview with a path allowed" allow \
  "$(ev AskUserQuestion "{\"questions\":[{\"q\":\"x\",\"preview\":\"destination=/assethub-spark/foo\"}]}")"

# Helper invocation with the wrong company arg is blocked; correct is allowed.
run "copy-folder.sh org repo samsung (in apple wt) blocked" block \
  "$(ev Bash "{\"command\":\"cd $APPLE && bash .claude/skills/rebrand-portal/scripts/da/copy-folder.sh org repo samsung\"}")"
run "copy-folder.sh org repo apple (in apple wt) allowed" allow \
  "$(ev Bash "{\"command\":\"cd $APPLE && bash .claude/skills/rebrand-portal/scripts/da/copy-folder.sh org repo apple\"}")"

# copy-folder.sh path as a read argument (cat), not an invocation -> allowed.
run "cat copy-folder.sh with trailing args allowed" allow \
  "$(ev Bash "{\"command\":\"cat scripts/da/copy-folder.sh org repo samsung\"}")"

# No worktree parseable -> falls back to main state (/xiaomi); a /apple
# publish is then correctly blocked (fail-safe, not silently allowed).
run "no-cd publish /apple falls back to main state, blocked" block \
  "$(ev Bash "{\"command\":\"curl -X POST $DA/copy/o/r/f -F destination=/apple/en\"}")"

# Edit-family tools short-circuit to allow.
run "Edit tool allowed" allow "$(ev Edit "{\"file_path\":\"/x\"}")"

echo "----"; echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
