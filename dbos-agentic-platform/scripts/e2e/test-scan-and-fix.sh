#!/usr/bin/env bash
# E2E test for the scanAndFix workflow. Pulls a public GitHub repo + runs Trivy in
# the worker container; expect 60-120s. Override TEST_REPO / TEST_BRANCH / POLL_TIMEOUT
# as needed.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=_lib.sh
source ./_lib.sh

TEST_REPO="${TEST_REPO:-lirantal/owasp-vulnerable-node-js-app}"
TEST_BRANCH="${TEST_BRANCH:-master}"
POLL_TIMEOUT="${POLL_TIMEOUT:-180}"

require_server_up

log "Test 1: Validation — empty body returns 400"
RES=$(curl -s -X POST "${BASE_URL}/workflow/scan" \
  -H "Content-Type: application/json" -d '{}')
assert_jq "$RES" '.error // "" | length > 0' "empty body rejected"

log "Test 2: Happy path — enqueue scan  (repo=${TEST_REPO} branch=${TEST_BRANCH})"
RES=$(curl -s -X POST "${BASE_URL}/workflow/scan" \
  -H "Content-Type: application/json" \
  -d "{\"repo\":\"${TEST_REPO}\",\"branch\":\"${TEST_BRANCH}\"}")
WF_ID=$(echo "$RES" | jq -r '.workflowId // .id // empty')
[[ -z "$WF_ID" ]] && { echo "$RES" | jq .; fail "no workflowId in response"; }
ok "scan enqueued (id=${WF_ID})"

log "Test 3: Poll until completion (timeout=${POLL_TIMEOUT}s)"
FINAL=$(wait_for_workflow "${BASE_URL}/workflow/scan/${WF_ID}")

STATUS=$(echo "$FINAL" | jq -r '.status')
if [[ "$STATUS" == "ERROR" ]]; then
  echo "$FINAL" | jq .
  fail "workflow finished with ERROR — check worker logs"
fi
assert_jq "$FINAL" '.status == "SUCCESS"' "workflow SUCCESS"

ok "scanAndFix e2e PASSED  (workflow=${WF_ID})"
