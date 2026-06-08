#!/usr/bin/env bash
# Shared helpers for e2e test scripts.
# Sourced — do not run directly.

BASE_URL="${BASE_URL:-http://localhost:3002}"
POLL_INTERVAL="${POLL_INTERVAL:-3}"
POLL_TIMEOUT="${POLL_TIMEOUT:-180}"  # seconds

# Colors (only if stdout is a TTY)
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; RED=''; BLUE=''; NC=''
fi

log()  { echo -e "${BLUE}▶${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }

# Assert: jq expression must evaluate to "true" against given JSON
# Usage:  assert_jq <json> <jq-filter> <description>
assert_jq() {
  local json="$1" filter="$2" desc="$3"
  local result
  result=$(echo "$json" | jq -r "$filter")
  if [[ "$result" != "true" ]]; then
    echo "$json" | jq .
    fail "$desc  (jq '$filter' returned: $result)"
  fi
  ok "$desc"
}

# Wait for a workflow to leave PENDING/ENQUEUED. Echoes final JSON on stdout.
# Usage:  wait_for_workflow <workflow_url>
wait_for_workflow() {
  local url="$1"
  local elapsed=0 status json
  while (( elapsed < POLL_TIMEOUT )); do
    json=$(curl -s "$url")
    status=$(echo "$json" | jq -r '.status // "UNKNOWN"')
    if [[ "$status" != "PENDING" && "$status" != "ENQUEUED" ]]; then
      echo "$json"
      return 0
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done
  fail "Workflow did not complete in ${POLL_TIMEOUT}s. Last status: $status"
}

# Require that /healthz is reachable before running tests.
require_server_up() {
  if ! curl -sf "${BASE_URL}/healthz" >/dev/null 2>&1; then
    fail "Server not reachable at ${BASE_URL}. Run: ./scripts/run-local.sh"
  fi
}
