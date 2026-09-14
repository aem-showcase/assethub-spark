#!/usr/bin/env bash
#
# deploy_stage.sh — Deploy the App Builder PoC actions to the Stage namespace
# and smoke-test the live dispatcher.
#
# Usage:
#   ./deploy_stage.sh              # deploy + verify
#   ./deploy_stage.sh --verify     # skip deploy, just run the smoke tests
#   ./deploy_stage.sh --no-verify  # deploy only, skip the smoke tests
#
# Reads all namespace/auth/config from ./.env (git-ignored). Never commit .env.

set -euo pipefail

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 1. Load .env
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in $(pwd). Copy .env.example and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ---------------------------------------------------------------------------
# 2. Validate required vars
# ---------------------------------------------------------------------------
required=(
  AIO_runtime_namespace
  AIO_runtime_auth
  HELIX_ORIGIN
  COOKIE_SECRET
  HELIX_ORIGIN_AUTHENTICATION
  OAUTH_CLIENT_ID
  OAUTH_CLIENT_SECRET
  OAUTH_SCOPES
)
missing=()
for v in "${required[@]}"; do
  [[ -z "${!v:-}" ]] && missing+=("$v")
done
if (( ${#missing[@]} )); then
  echo "ERROR: missing required .env vars: ${missing[*]}" >&2
  exit 1
fi

NS="${AIO_runtime_namespace}"
DISP="https://${NS}.adobeioruntime.net/api/v1/web/spark/dispatcher"

# ---------------------------------------------------------------------------
# 3. Deploy (unless --verify)
# ---------------------------------------------------------------------------
do_deploy=1
do_verify=1
case "${1:-}" in
  --verify)    do_deploy=0 ;;
  --no-verify) do_verify=0 ;;
  "")          ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

if (( do_deploy )); then
  echo "==> Deploying actions to namespace: ${NS}"
  echo "    HELIX_ORIGIN=${HELIX_ORIGIN}"
  npx aio app deploy --no-web-assets
  echo "==> Deploy complete."
fi

# ---------------------------------------------------------------------------
# 4. Smoke tests
# ---------------------------------------------------------------------------
if (( do_verify )); then
  echo ""
  echo "==> Smoke-testing ${DISP}"
  JAR="$(mktemp)"
  trap 'rm -f "$JAR"' EXIT

  fail=0
  check() { # label  url  expected_code
    local label="$1" url="$2" want="$3" got
    got="$(curl -s -o /dev/null -b "$JAR" -c "$JAR" -w '%{http_code}' "$url")"
    if [[ "$got" == "$want" ]]; then
      printf '   [ok]   %-28s HTTP %s\n' "$label" "$got"
    else
      printf '   [FAIL] %-28s HTTP %s (want %s)\n' "$label" "$got" "$want"
      fail=1
    fi
  }

  # dev-login mints a session cookie into $JAR (PoC auth bypass)
  check "auth/dev-login"        "${DISP}/auth/dev-login"        200
  check "GET /api/user"         "${DISP}/api/user"             200
  check "GET /api/smart-collections" "${DISP}/api/smart-collections" 200
  check "GET /en/ (proxied UI)" "${DISP}/en/"                  200

  echo ""
  if (( fail )); then
    echo "==> SMOKE TESTS FAILED" >&2
    exit 1
  fi
  echo "==> All smoke tests passed."
  echo "    Dispatcher: ${DISP}"
fi
