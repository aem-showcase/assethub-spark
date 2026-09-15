#!/usr/bin/env bash
set -euo pipefail

# Regression test for the `list_files() { local sub="$1" url="...$sub" ... }`
# unbound-variable bug: under `set -u`, a LATER variable in the SAME `local`
# statement cannot see an EARLIER one's just-assigned value yet, so building
# `url` from `$sub` in the same `local sub=... url=...` line throws
# "sub: unbound variable" on the very first call — before any recursion, any
# curl call succeeding or failing. Confirmed live on demo/flipkart (PR #57)
# and independently in this session, isolated to a 4-line minimal repro.
# Fix: assign `sub` in its own `local` statement before it's used to build `url`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/../../scripts/da/publish-paths.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

dir="$(mktemp -d)"
bin="$dir/bin"
mkdir -p "$bin"
token_file="$dir/token.env"
printf 'DA_TOKEN=DA_SECRET\n' > "$token_file"

cat > "$bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

out=""
write_code=false
headers=()
url=""

while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -D) shift 2 ;;
    -w) write_code=true; shift 2 ;;
    -X) shift 2 ;;
    -H) headers+=("$2"); shift 2 ;;
    -F) shift 2 ;;
    -s|-S|-sS) shift ;;
    *) url="$1"; shift ;;
  esac
done

body() {
  [ -n "$out" ] && printf '%s' "$1" > "$out"
}

code="500"
case "$url" in
  */list/acme-co/acme-portal/companies/acme-demo)
    body '[{"path":"/acme-co/acme-portal/companies/acme-demo/en"},{"path":"/acme-co/acme-portal/companies/acme-demo/config"}]'
    code="200" ;;
  */list/acme-co/acme-portal/companies/acme-demo/en)
    body '[{"path":"/acme-co/acme-portal/companies/acme-demo/en/index","ext":"html"}]'
    code="200" ;;
  */list/acme-co/acme-portal/companies/acme-demo/config)
    body '[]'
    code="200" ;;
  */preview/*|*/live/*)
    body ''
    code="200" ;;
  *)
    body '[]'
    code="200" ;;
esac

$write_code && printf '%s' "$code"
exit 0
MOCK
chmod +x "$bin/curl"

out="$dir/out.txt"
err="$dir/err.txt"
status=0
PATH="$bin:$PATH" "$SCRIPT" acme-co acme-portal acme-demo --token-file "$token_file" --dry-run >"$out" 2>"$err" || status=$?

if [ "$status" != "0" ]; then
  cat "$out" >&2
  cat "$err" >&2
  fail "publish-paths.sh --dry-run exited $status (expected 0) — the list_files unbound-variable regression may have returned"
fi

grep -q "sub: unbound variable" "$err" && fail "list_files unbound-variable bug reproduced — 'sub' referenced before its own local statement completed"

grep -qF "companies/acme-demo/en/index.html" "$out" || fail "expected enumerated doc companies/acme-demo/en/index.html in dry-run output, got:\n$(cat "$out")"

rm -rf "$dir"
echo "PASS: list_files enumerates without the sub/url same-statement unbound-variable crash"
