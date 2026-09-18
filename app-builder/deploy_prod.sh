#!/usr/bin/env bash
#
# deploy_prod.sh — Deploy the App Builder PoC actions to the PRODUCTION namespace
# and smoke-test the live dispatcher.
#
# Usage:
#   ./deploy_prod.sh              # deploy + verify (asks to confirm first)
#   ./deploy_prod.sh --verify     # skip deploy, just run the smoke tests
#   ./deploy_prod.sh --no-verify  # deploy only, skip the smoke tests
#   ./deploy_prod.sh --yes        # skip the "are you sure" prompt (for CI)
#
# Reads all namespace/auth/config from ./.env.prod (git-ignored). Never commit it.
# Override the env file with ENV_FILE=/path/to/file ./deploy_prod.sh

set -euo pipefail

cd "$(dirname "$0")"

# ---------------------------------------------------------------------------
# 1. Load the prod .env
# ---------------------------------------------------------------------------
ENV_FILE="${ENV_FILE:-.env.prod}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found in $(pwd). Copy .env.example and fill it in with the PROD namespace/creds." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
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
  echo "ERROR: missing required vars in ${ENV_FILE}: ${missing[*]}" >&2
  exit 1
fi

NS="${AIO_runtime_namespace}"
DISP="https://${NS}.adobeioruntime.net/api/v1/web/spark/dispatcher"

# ---------------------------------------------------------------------------
# 3. Parse flags
# ---------------------------------------------------------------------------
do_deploy=1
do_verify=1
assume_yes=0
for arg in "$@"; do
  case "$arg" in
    --verify)    do_deploy=0 ;;
    --no-verify) do_verify=0 ;;
    --yes|-y)    assume_yes=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# 4. Safety guards for production
# ---------------------------------------------------------------------------
# Refuse to run the "prod" deploy against a namespace that looks like stage/dev.
if [[ "$NS" == *stage* || "$NS" == *dev* ]]; then
  echo "ERROR: ${ENV_FILE} points at a non-prod namespace: ${NS}" >&2
  echo "       Use deploy_stage.sh for stage, or fix AIO_runtime_namespace in ${ENV_FILE}." >&2
  exit 1
fi

if (( do_deploy && ! assume_yes )); then
  echo "You are about to deploy to PRODUCTION."
  echo "    namespace   = ${NS}"
  echo "    HELIX_ORIGIN= ${HELIX_ORIGIN}"
  read -r -p "Type 'deploy prod' to continue: " reply
  if [[ "$reply" != "deploy prod" ]]; then
    echo "Aborted." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Deploy (unless --verify)
# ---------------------------------------------------------------------------
if (( do_deploy )); then
  echo "==> Deploying actions to PROD namespace: ${NS}"
  echo "    HELIX_ORIGIN=${HELIX_ORIGIN}"
  npx aio app deploy --no-web-assets
  echo "==> Deploy complete."
fi

# ---------------------------------------------------------------------------
# 6. Smoke tests
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
