#!/usr/bin/env bash
#
# publish-paths.sh — Preview + publish every copied company-scoped DA doc.
#
# After Step 3 copies the site into /companies/<companyKey> and Step 4 rebrands
# it, the demo must publish ONLY those company-scoped paths via Helix Admin
# (SKILL.md Step 4 item 4; invariant I7 — publish everything copied, never a
# hand-picked subset). This script enumerates the copied paths and previews +
# publishes each one explicitly, so nothing copied is left un-published (a
# copied-but-unpublished page 404s for the customer).
#
# WHY THIS SCRIPT EXISTS (do not hand-roll this each run):
#  1. admin.da.live/list 403s for a non-browser HTTP client (Python urllib,
#     etc.) unless the request carries a real browser User-Agent. curl happens
#     to send one by default; Python does not — which is why a hand-rolled
#     enumerator intermittently 403s and gets MISread as "expired token". This
#     script always sends the browser UA (reused from scripts/assets/
#     scrape-site.js) so the class of 403 never appears.
#  2. A 403/401 is NOT proof of an expired token. This script verifies the
#     token once up front with a status probe and prints the code; a non-200
#     there is the ONLY token-expiry signal. A 403 on an individual publish is
#     reported as a publish failure for that path, not a token problem.
#  3. Publishing uses EXPLICIT per-path literal URLs (never a shell-variable
#     loop the publish guard can't see) with REF=main and the full DA path, so
#     hooks/guard-da-publish.sh can validate each target, and the per-path
#     report is auditable.
#  4. DA_TOKEN is forwarded as `Authorization: Bearer`; on a 401 the same call
#     is retried with `x-content-source-authorization` (a known admin.hlx.page
#     quirk — it can 401 on the Authorization form even with a valid token).
#
# Usage:
#   .claude/skills/rebrand-portal/scripts/da/publish-paths.sh <org> <repo> <companyKey> [--token-file <path>] [--dry-run]
#
#   <org>/<repo>   the DA org and site (same as the GitHub org/repo).
#   <companyKey>   company slug; publishes /companies/<companyKey>/... only.
#   --token-file   env file holding DA_TOKEN (default: ./token.env from repo root).
#   --dry-run      enumerate + print what would be published; make no publish calls.
#
# Reads DA_TOKEN (never printed). Exit codes: 0 = all paths previewed+published;
# 1 = usage/auth/token error; 2 = one or more paths failed; 3 = nothing to publish.

set -euo pipefail

DA_ADMIN="${DA_ADMIN_BASE:-https://admin.da.live}"
HLX_ADMIN="${HLX_ADMIN_BASE:-https://admin.hlx.page}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Browser User-Agent — reused verbatim from scripts/assets/scrape-site.js so DA
# admin calls made from a non-browser client are not 403'd. Keep in sync there.
BROWSER_UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -ge 3 ] || die "usage: publish-paths.sh <org> <repo> <companyKey> [--token-file <path>] [--dry-run]"
ORG="$1"; REPO="$2"; COMPANY="${3#/}"; shift 3

case "$COMPANY" in
  ""|*/*|*..*|.*|*[^a-z0-9-]*)
    die "companyKey must be a lowercase slug like acme-demo (got: $COMPANY)"
    ;;
esac

CONTAINER="companies"
DEST_ROOT="$CONTAINER/$COMPANY"

TOKEN_FILE=""; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --token-file) TOKEN_FILE="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    *) die "unknown arg: $1" ;;
  esac
done

[ -z "$TOKEN_FILE" ] && TOKEN_FILE="$ROOT/token.env"
[ -f "$TOKEN_FILE" ] || die "token file not found: $TOKEN_FILE (create it with DA_TOKEN=...)"
DA_TOKEN="$(grep -E '^DA_TOKEN=' "$TOKEN_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ' | tr -d '\r')"
[ -n "$DA_TOKEN" ] || die "DA_TOKEN missing/empty in $TOKEN_FILE"

# Every DA/Helix admin call carries the browser UA (see header note #1).
UA=(-H "User-Agent: $BROWSER_UA")
AUTH=(-H "Authorization: Bearer $DA_TOKEN")

# --- Token status probe (header note #2) --------------------------------------
# Prove the token works BEFORE any publish. A non-200 here is the only signal
# that justifies asking for a fresh token; a later per-path 403 is a publish
# problem for that path, not a token problem.
probe="$(curl -sS -o /dev/null -w '%{http_code}' "${UA[@]}" "${AUTH[@]}" \
          "$DA_ADMIN/list/$ORG/$REPO/$DEST_ROOT" 2>/dev/null)" || probe="000"
if [ "$probe" != "200" ]; then
  die "DA token status probe returned HTTP $probe for /$ORG/$REPO/$DEST_ROOT. \
This is the token-freshness signal: refresh DA_TOKEN in $TOKEN_FILE and re-run. \
(A 200 here would mean any later failure is a command/path problem, not the token.)"
fi
echo ">> DA token verified (HTTP 200) for /$ORG/$REPO/$DEST_ROOT."

# --- Enumerate the copied company-scoped docs (with browser UA) ---------------
# Mirrors copy-folder.sh's list_json/entries paging; emits each FILE doc's path
# relative to /{org}/{repo}, i.e. companies/<companyKey>/<...>.<ext>.
list_files() {
  local sub="$1" url="$DA_ADMIN/list/$ORG/$REPO/$sub" tok="" hdrs body code combined="[]"
  while :; do
    hdrs="$(mktemp)"; body="$(mktemp)"
    code="$(curl -sS "${UA[@]}" "${AUTH[@]}" -D "$hdrs" -o "$body" -w '%{http_code}' \
              ${tok:+-H "da-continuation-token: $tok"} "$url")" \
      || { rm -f "$hdrs" "$body"; die "list request failed for /$ORG/$REPO/$sub"; }
    [ "$code" = "200" ] || { rm -f "$hdrs" "$body"; die "list returned HTTP $code for /$ORG/$REPO/$sub (bad path or token)"; }
    combined="$(python3 - "$combined" "$body" <<'PY'
import json,sys
a=json.loads(sys.argv[1] or "[]")
try: b=json.load(open(sys.argv[2]))
except Exception: b=[]
print(json.dumps(a+(b if isinstance(b,list) else [])))
PY
)"
    tok="$(grep -i '^da-continuation-token:' "$hdrs" | head -1 | cut -d: -f2- | tr -d ' \r' || true)"
    rm -f "$hdrs" "$body"
    [ -n "$tok" ] || break
  done
  # Split folders (recurse) from files (emit), same shape as copy-folder.sh.
  local dirs files
  dirs="$(printf '%s' "$combined" | python3 -c '
import json,sys
org,repo=sys.argv[1],sys.argv[2]
data=json.load(sys.stdin) if sys.stdin else []
pref="/%s/%s/"%(org,repo)
for it in data:
    p=it.get("path","") or ""
    rel=p[len(pref):] if p.startswith(pref) else p.lstrip("/")
    if rel and not it.get("ext"): print(rel)
' "$ORG" "$REPO")"
  printf '%s' "$combined" | python3 -c '
import json,sys
org,repo=sys.argv[1],sys.argv[2]
data=json.load(sys.stdin) if sys.stdin else []
pref="/%s/%s/"%(org,repo)
for it in data:
    p=it.get("path","") or ""
    rel=p[len(pref):] if p.startswith(pref) else p.lstrip("/")
    ext=it.get("ext")
    if rel and ext: print("%s.%s"%(rel,ext))
' "$ORG" "$REPO"
  local d
  for d in $dirs; do list_files "$d"; done
}

echo ">> Enumerating copied docs under /$DEST_ROOT ..."
mapfile -t DOCS < <(list_files "$DEST_ROOT" | sort -u)
[ "${#DOCS[@]}" -gt 0 ] || { echo ">> No documents found under /$DEST_ROOT — nothing to publish."; exit 3; }
echo ">> ${#DOCS[@]} document(s) to publish."

# hlx_call <preview|live> <da-relpath-with-ext> — publish one explicit literal
# path with REF=main. Strips a trailing .html (Helix paths are extensionless),
# but KEEPS .json (a DA sheet publishes as /<path>.json). Forwards DA_TOKEN as
# Authorization, retrying once with x-content-source-authorization on a 401
# (header note #4). Prints "OK"/"FAIL <code>".
hlx_call() {
  local action="$1" rel="$2" path code
  path="$rel"
  case "$path" in *.html) path="${path%.html}" ;; esac
  local url="$HLX_ADMIN/$action/$ORG/$REPO/main/$path"
  code="$(curl -sS -X POST -o /dev/null -w '%{http_code}' "${UA[@]}" "${AUTH[@]}" "$url" 2>/dev/null)" || code="000"
  if [ "$code" = "401" ]; then
    code="$(curl -sS -X POST -o /dev/null -w '%{http_code}' "${UA[@]}" \
              -H "x-content-source-authorization: Bearer $DA_TOKEN" "$url" 2>/dev/null)" || code="000"
  fi
  case "$code" in
    2*) printf 'OK'   ;;
    *)  printf 'FAIL %s' "$code" ;;
  esac
}

if [ "$DRY_RUN" -eq 1 ]; then
  echo ">> DRY RUN — would preview+publish each of these (REF=main), no calls made:"
  for rel in "${DOCS[@]}"; do echo "   - /$rel"; done
  exit 0
fi

FAILED=0
for rel in "${DOCS[@]}"; do
  pv="$(hlx_call preview "$rel")"
  lv="OK"
  [ "$pv" = "OK" ] && lv="$(hlx_call live "$rel")" || lv="(skipped — preview failed)"
  if [ "$pv" = "OK" ] && [ "$lv" = "OK" ]; then
    echo "   - published /$rel"
  else
    echo "   - FAILED /$rel (preview=$pv live=$lv)" >&2
    FAILED=$((FAILED+1))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "ERROR: $FAILED of ${#DOCS[@]} document(s) failed to publish. See per-path FAILED lines above." >&2
  exit 2
fi
echo ">> OK: all ${#DOCS[@]} document(s) previewed + published under /$DEST_ROOT."
exit 0
