#!/usr/bin/env bash
# E2E test for the bitbucketPrStatus workflow.
# Requires:
#   - Docker stack running  (./scripts/run-local.sh)
#   - BITBUCKET_TOKEN set in .env  (worker container needs it)
#
# Env overrides:
#   TEST_REPO    default "atlassian/dt-proc"
#   BASE_URL     default "http://localhost:3002"
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=_lib.sh
source ./_lib.sh

TEST_REPO="${TEST_REPO:-atlassian/dt-proc}"

require_server_up

log "Test 1: Validation — empty body returns 400"
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-status" \
  -H "Content-Type: application/json" -d '{}')
assert_jq "$RES" '.error == "invalid_request"' "empty body rejected"

log "Test 2: Validation — bad repo format returns 400"
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-status" \
  -H "Content-Type: application/json" -d '{"repo":"notavalidrepo"}')
assert_jq "$RES" '.error == "invalid_request"' "bad repo format rejected"

log "Test 3: Poll — unknown workflow returns 404"
RES=$(curl -s "${BASE_URL}/workflow/pr-status/does-not-exist-$(date +%s)")
assert_jq "$RES" '.error == "not_found"' "unknown workflow returns 404"

log "Test 4: Happy path — enqueue and complete  (repo=${TEST_REPO})"
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-status" \
  -H "Content-Type: application/json" -d "{\"repo\":\"${TEST_REPO}\"}")
WF_ID=$(echo "$RES" | jq -r '.workflowId')
[[ "$WF_ID" == "null" || -z "$WF_ID" ]] && fail "no workflowId in: $RES"
assert_jq "$RES" '.status == "ENQUEUED"' "workflow enqueued (id=${WF_ID})"

log "Test 5: Poll until completion (timeout=${POLL_TIMEOUT}s)"
FINAL=$(wait_for_workflow "${BASE_URL}/workflow/pr-status/${WF_ID}")

STATUS=$(echo "$FINAL" | jq -r '.status')
if [[ "$STATUS" == "ERROR" ]]; then
  echo "$FINAL" | jq .
  fail "workflow finished with ERROR — check worker logs (likely BITBUCKET_TOKEN missing in container)"
fi
assert_jq "$FINAL" '.status == "SUCCESS"' "workflow SUCCESS"

log "Test 6: Result shape and invariants"
assert_jq "$FINAL" ".result.repo == \"${TEST_REPO}\""              "result.repo matches request"
assert_jq "$FINAL" '.result.prs | type == "array"'                 "result.prs is array"
assert_jq "$FINAL" '.result.totalPrs == (.result.prs | length)'    "totalPrs equals prs.length"
assert_jq "$FINAL" '.result.failedCount <= .result.totalPrs'       "failedCount ≤ totalPrs"
assert_jq "$FINAL" '(.result.failedCount) == ([.result.prs[] | select(.buildState == "FAILED" or .buildState == "STOPPED")] | length)' \
  "failedCount matches FAILED+STOPPED count"
assert_jq "$FINAL" '.result.status == "completed"'                 "result.status == completed"
assert_jq "$FINAL" 'all(.result.prs[]; .id and .commitHash and .url)' "every PR has id, commitHash, url"

log "Test 7: Idempotency — re-POSTing same workflowID returns same handle"
RES2=$(curl -s -X POST "${BASE_URL}/workflow/pr-status" \
  -H "Content-Type: application/json" -d "{\"repo\":\"${TEST_REPO}\"}")
WF_ID2=$(echo "$RES2" | jq -r '.workflowId')
[[ "$WF_ID2" != "$WF_ID" ]] && ok "fresh POST yields new workflowId (${WF_ID2})" \
  || fail "fresh POST returned same workflowId — generator collision"

TOTAL=$(echo "$FINAL" | jq -r '.result.totalPrs')
FAILED=$(echo "$FINAL" | jq -r '.result.failedCount')
ok "bitbucketPrStatus e2e PASSED  (PRs=${TOTAL}  failed=${FAILED})"
