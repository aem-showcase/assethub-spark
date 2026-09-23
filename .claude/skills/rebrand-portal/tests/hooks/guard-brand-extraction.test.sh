#!/usr/bin/env bash
#
# Tests for hooks/guard-brand-extraction.sh — the gate that blocks theme edits
# until the source site has actually been measured.
#
# The behaviours that matter:
#   (a) block a styles.css / brand.css edit when migration-work/brand.json is
#       absent, malformed, gate-rejected, or colourless;
#   (b) allow it once a real measurement exists;
#   (c) never block anything else — reads, other files, unrelated commands.
#       An over-broad guard gets disabled, which is worse than no guard.
#
# Run: bash .claude/skills/rebrand-portal/tests/hooks/guard-brand-extraction.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/../../hooks/guard-brand-extraction.sh"

SB="$(mktemp -d)"
trap 'rm -rf "$SB"' EXIT

pass=0
fail=0

# A repo whose brand.json we vary per case.
mk_repo() {
  local name="$1"
  local root="$SB/$name"
  mkdir -p "$root/.git" "$root/styles" "$root/migration-work"
  printf ':root { --link-color: #002C5F; }\n' > "$root/styles/styles.css"
  echo "$root"
}

good_brand() {
  cat <<'JSON'
{
  "schemaVersion": 1,
  "provenance": {
    "sourceUrl": "https://www.hyundai.com/in/en",
    "finalUrl": "https://www.hyundai.com/in/en",
    "extractedAt": "2026-09-17T00:00:00.000Z",
    "extractor": "excat/brand-extract.js",
    "gatePassed": true
  },
  "tokens": { "colors": { "link": "rgb(0, 44, 95)" } },
  "tokenMap": []
}
JSON
}

ev() { # tool, tool_input json
  printf '{"tool_name":"%s","tool_input":%s}' "$1" "$2"
}

run() { # label, expect(allow|block), event
  local label="$1" expect="$2" event="$3"
  local out rc
  out="$(printf '%s' "$event" | bash "$HOOK" 2>&1)"
  rc=$?
  local actual="allow"
  [ "$rc" -eq 2 ] && actual="block"
  if [ "$actual" = "$expect" ]; then
    pass=$((pass + 1))
    echo "ok   - $label"
  else
    fail=$((fail + 1))
    echo "FAIL - $label (expected $expect, got $actual rc=$rc)"
    echo "       $out" | head -3
  fi
}

# --- no brand.json at all: the default state of every run so far -------------
R="$(mk_repo no-brand)"
run "edit styles.css with no measurement is blocked" block \
  "$(ev Edit "{\"file_path\":\"$R/styles/styles.css\"}")"
run "edit brand.css with no measurement is blocked" block \
  "$(ev Write "{\"file_path\":\"$R/styles/brand.css\"}")"

# --- a real measurement unblocks --------------------------------------------
R="$(mk_repo good)"
good_brand > "$R/migration-work/brand.json"
run "edit styles.css after a real measurement is allowed" allow \
  "$(ev Edit "{\"file_path\":\"$R/styles/styles.css\"}")"

# --- a rejected extraction must NOT unblock ---------------------------------
# The Heineken case: tokens exist and look fine, but they came off an age gate.
R="$(mk_repo gated)"
good_brand | sed 's/"gatePassed": true/"gatePassed": false/' > "$R/migration-work/brand.json"
run "edit blocked when extraction was gate-rejected" block \
  "$(ev Edit "{\"file_path\":\"$R/styles/styles.css\"}")"

# --- malformed or empty records fail closed ---------------------------------
R="$(mk_repo malformed)"
printf '{ not json' > "$R/migration-work/brand.json"
run "malformed brand.json fails closed" block \
  "$(ev Edit "{\"file_path\":\"$R/styles/styles.css\"}")"

R="$(mk_repo nocolors)"
good_brand | sed 's/"link": "rgb(0, 44, 95)"//' > "$R/migration-work/brand.json"
run "brand.json with no measured colours fails closed" block \
  "$(ev Edit "{\"file_path\":\"$R/styles/styles.css\"}")"

# --- scope: nothing else may be blocked -------------------------------------
R="$(mk_repo scope)"
run "editing an unrelated file is allowed" allow \
  "$(ev Edit "{\"file_path\":\"$R/blocks/header/header.js\"}")"
run "reading styles.css is allowed" allow \
  "$(ev Read "{\"file_path\":\"$R/styles/styles.css\"}")"
run "grepping styles.css is allowed" allow \
  "$(ev Bash "{\"command\":\"grep -n link-color $R/styles/styles.css\"}")"
run "an unrelated bash command is allowed" allow \
  "$(ev Bash "{\"command\":\"git status\"}")"
run "sed -n (read) on styles.css is allowed" allow \
  "$(ev Bash "{\"command\":\"sed -n 1,20p $R/styles/styles.css\"}")"

# --- shell writes are in scope ----------------------------------------------
run "redirect into styles.css is blocked" block \
  "$(ev Bash "{\"command\":\"echo x > $R/styles/styles.css\"}")"
run "sed -i on styles.css is blocked" block \
  "$(ev Bash "{\"command\":\"sed -i '' s/a/b/ $R/styles/styles.css\"}")"

# --- malformed event input must not crash the hook --------------------------
run "non-JSON stdin does not crash" allow "not json at all"
run "empty stdin does not crash" allow ""

echo "----"; echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ] || exit 1
