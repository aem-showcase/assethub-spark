#!/usr/bin/env bash
#
# Tests for hooks/guard-live-publish-ceiling.sh — the PreToolUse live-publish gate.
#
# This guard exists because every other ceiling barrier lives inside the packaged
# scripts, and live runs have repeatedly bypassed those by importing the skill's
# internals from a hand-written .mjs or driving the HTTP API with curl. The publish
# is the one step no route can skip, so the guard must:
#
#   (a) gate `live`/`publish` but never `preview` — the check reads the previewed
#       page, so gating preview would make it impossible to satisfy;
#   (b) require a PASSING card-ceiling result for THIS company;
#   (c) reject a stale result, since the page is not a git artifact and an old
#       check says nothing about a page re-authored since;
#   (d) ignore read-only mentions of a publish URL, and non-index pages.
#
# Run: bash .claude/skills/rebrand-portal/tests/hooks/guard-live-publish-ceiling.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/../../hooks/guard-live-publish-ceiling.sh"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

WT="$SB/wt-apple"
mkdir -p "$WT/.internal"
( cd "$WT" && git init -q && git config user.email t@t && git config user.name t )
printf '{"customer":{"key":"apple","daFolder":"/companies/apple"}}' \
  > "$WT/.internal/onboarding-state.json"

mkdir -p "$SB/main/.internal"
( cd "$SB/main" && git init -q && git config user.email t@t && git config user.name t )
export CLAUDE_PROJECT_DIR="$SB/main"

HLX="https://admin.hlx.page"

# Write .internal/verify-report.json. $1 pass(true|false) $2 company $3 age-minutes
write_report() {
  python3 - "$WT/.internal/verify-report.json" "$1" "$2" "$3" <<'PY'
import json, sys
from datetime import datetime, timedelta, timezone
path, passed, company, age = sys.argv[1], sys.argv[2] == "true", sys.argv[3], float(sys.argv[4])
when = datetime.now(timezone.utc) - timedelta(minutes=age)
report = {
    "checkedAt": when.isoformat().replace("+00:00", "Z"),
    "checkedCommit": "deadbeef",
    "company": company or None,
    "preview": "branch.dev.frescopamedia.com",
    "results": {"card-ceiling": {"pass": passed, "reason": "5 cards"}},
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(report, fh)
PY
}

pass=0; fail=0
ev() { python3 -c "import json,sys; print(json.dumps({'tool_name':sys.argv[1],'tool_input':json.loads(sys.argv[2])}))" "$1" "$2"; }
run() { # $1 label  $2 expected(allow|block)  $3 event-json
  local out code got
  out=$(printf '%s' "$3" | bash "$HOOK" 2>&1); code=$?
  got=$([ $code -eq 0 ] && echo allow || echo block)
  if [ "$got" = "$2" ]; then echo "PASS  $1"; pass=$((pass+1))
  else echo "FAIL  $1  expected=$2 got=$got :: $out"; fail=$((fail+1)); fi
}

LIVE_INDEX="$HLX/live/aem-showcase/assethub-spark/main/companies/apple/en/index"
PREVIEW_INDEX="$HLX/preview/aem-showcase/assethub-spark/main/companies/apple/en/index"

# --- The core case: no check has ever run. This is the state a hand-written
# --- script leaves behind, because it never invokes the packaged path.
rm -f "$WT/.internal/verify-report.json"
run "live publish with no verify report blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- Preview must stay open, or the check can never be satisfied.
run "preview publish allowed with no report" allow \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $PREVIEW_INDEX\"}")"

# --- A fresh, passing, company-matched result is the intended happy path.
write_report true apple 1
run "live publish with fresh passing card-ceiling allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- A FAILing check must block: this is a 9-card page trying to go live.
write_report false apple 1
run "live publish with FAILING card-ceiling blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- Stale result: the page may have been re-authored since it was checked.
write_report true apple 120
run "live publish with stale card-ceiling blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- A report from another demo proves nothing about this one.
write_report true disney 1
run "live publish with another company's report blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- A report predating the company field cannot be trusted either.
write_report true "" 1
run "live publish with company-less report blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- Non-index pages in the company folder are not card-bearing.
write_report false apple 1
run "live publish of a non-index page allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && curl -X POST $HLX/live/o/r/main/companies/apple/en/search\"}")"

# --- Read-only inspection is not a publish, even with a FAILing report.
run "grep over a script containing the live URL allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && grep -n '$LIVE_INDEX' publish.sh\"}")"

# --- A GET against the live URL is a read, not a promotion.
run "curl GET of the live URL allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && curl -s $LIVE_INDEX\"}")"

# --- Non-bash tools are out of scope entirely.
run "Edit tool ignored" allow \
  "$(ev Edit "{\"command\":\"cd $WT && curl -X POST $LIVE_INDEX\"}")"

# --- Copilot CLI dialect: lowercase toolName + toolArgs. Matching only the Claude
# --- dialect is how a live Copilot session ran with every guard silently inert.
run "copilot dialect (toolName/toolArgs) still blocks" block \
  "$(python3 -c "import json,sys; print(json.dumps({'toolName':'bash','toolArgs':{'command':sys.argv[1]}}))" \
    "cd $WT && curl -X POST $LIVE_INDEX")"

# --- The packaged CLI builds the admin URL internally, so the URL literal is absent
# --- from the command string. If the gate only matched the URL, shipping publish-page.js
# --- would have handed the agent a supported route straight past this guard.
CLI=".claude/skills/rebrand-portal/scripts/assets/publish-page.js"

write_report false apple 1
run "publish-page.js --publish with FAILING card-ceiling blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --push /tmp/i.html --publish\"}")"

write_report true apple 1
run "publish-page.js --publish with fresh PASSing card-ceiling allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --publish\"}")"

write_report true apple 120
run "publish-page.js --publish with stale card-ceiling blocked" block \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --publish\"}")"

# --- Preview is deliberately ungated: card-ceiling reads the previewed page, so
# --- requiring a passing result before preview would make the check unsatisfiable.
write_report false apple 1
run "publish-page.js --preview-only allowed despite FAILing report" allow \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --preview-only\"}")"

run "publish-page.js --pull allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --pull /tmp/i.html\"}")"

run "publish-page.js --publish --dry-run allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/index --publish --dry-run\"}")"

run "publish-page.js publishing a non-index page allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path companies/apple/en/search --publish\"}")"

run "publish-page.js --path=index= form still blocks" block \
  "$(ev Bash "{\"command\":\"cd $WT && node $CLI --path=companies/apple/en/index --publish\"}")"

# --- A mention is not an invocation. Writing a script that contains the CLI text, or
# --- grepping for it, must not be blocked - the guard caught exactly this while the
# --- CLI's own end-to-end test harness was being written.
run "heredoc containing the CLI text allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && cat > t.mjs <<EOF\nconst C='$CLI'; run([C,'--path','companies/apple/en/index','--publish']);\nEOF\"}")"

run "grep for the CLI path allowed" allow \
  "$(ev Bash "{\"command\":\"cd $WT && grep -rn '$CLI --publish' docs/\"}")"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
