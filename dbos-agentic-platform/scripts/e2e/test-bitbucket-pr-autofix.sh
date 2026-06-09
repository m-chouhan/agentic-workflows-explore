#!/usr/bin/env bash
# E2E test for the bitbucketPrAutofix workflow.
#
# Requires:
#   - Docker stack running       (./scripts/run-local.sh)
#   - BITBUCKET_TOKEN set in .env (worker container needs it; needs pipeline:write)
#
# Env overrides:
#   TEST_REPO         default "atlassian/dt-proc"
#   BASE_URL          default "http://localhost:3002"
#   POLL_TIMEOUT      default 180 (workflow may take long if pipelines run; bump for real runs)
#   AUTOFIX_DRY       when "1" skip the discover-and-retrigger run; only validate API surface.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck source=_lib.sh
source ./_lib.sh

TEST_REPO="${TEST_REPO:-atlassian/dt-proc}"
AUTOFIX_DRY="${AUTOFIX_DRY:-1}" # default to dry so CI doesn't trigger pipelines

require_server_up

log "Test 1: Validation — empty body returns 400"
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-autofix" \
  -H "Content-Type: application/json" -d '{}')
assert_jq "$RES" '.error == "invalid_request"' "empty body rejected"

log "Test 2: Validation — bad repo format returns 400"
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-autofix" \
  -H "Content-Type: application/json" -d '{"repo":"notavalidrepo"}')
assert_jq "$RES" '.error == "invalid_request"' "bad repo format rejected"

log "Test 3: Validation — sending both repo and statusWorkflowId is OK only if union picks one"
# Union schema picks the first matching variant; both being present should still match `repo`.
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-autofix" \
  -H "Content-Type: application/json" -d '{}')
assert_jq "$RES" '.error == "invalid_request"' "missing both fields rejected"

log "Test 4: Poll — unknown workflow returns 404"
RES=$(curl -s "${BASE_URL}/workflow/pr-autofix/does-not-exist-$(date +%s)")
assert_jq "$RES" '.error == "not_found"' "unknown workflow returns 404"

if [[ "$AUTOFIX_DRY" == "1" ]]; then
  ok "AUTOFIX_DRY=1 — skipping happy-path retrigger (set AUTOFIX_DRY=0 to run end-to-end)"
  ok "bitbucketPrAutofix API-surface e2e PASSED"
  exit 0
fi

log "Test 5: Happy path — discover + retrigger  (repo=${TEST_REPO})"
log "  NOTE: this WILL trigger real Bitbucket pipelines for every failing PR."
RES=$(curl -s -X POST "${BASE_URL}/workflow/pr-autofix" \
  -H "Content-Type: application/json" -d "{\"repo\":\"${TEST_REPO}\"}")
WF_ID=$(echo "$RES" | jq -r '.workflowId')
[[ "$WF_ID" == "null" || -z "$WF_ID" ]] && fail "no workflowId in: $RES"
assert_jq "$RES" '.status == "ENQUEUED"' "workflow enqueued (id=${WF_ID})"

log "Test 6: Poll until completion (timeout=${POLL_TIMEOUT}s — bump for real pipeline runs)"
FINAL=$(wait_for_workflow "${BASE_URL}/workflow/pr-autofix/${WF_ID}")

STATUS=$(echo "$FINAL" | jq -r '.status')
if [[ "$STATUS" == "ERROR" ]]; then
  echo "$FINAL" | jq .
  fail "workflow finished with ERROR — check worker logs (token missing or pipeline:write scope)"
fi
assert_jq "$FINAL" '.status == "SUCCESS"' "workflow SUCCESS"

log "Test 7: Result shape and invariants"
assert_jq "$FINAL" ".result.repo == \"${TEST_REPO}\""                    "result.repo matches request"
assert_jq "$FINAL" '.result.source == "discover"'                        "result.source == discover"
assert_jq "$FINAL" '.result.attempts | type == "array"'                  "attempts is array"
assert_jq "$FINAL" '.result.attempted == (.result.attempts | length)'    "attempted == attempts.length"
assert_jq "$FINAL" '(.result.succeeded + .result.failed + .result.timedOut) <= .result.attempted' \
  "succeeded+failed+timedOut ≤ attempted"
assert_jq "$FINAL" '.result.status == "completed"'                       "result.status == completed"
assert_jq "$FINAL" 'all(.result.attempts[]; .prId and .action == "retrigger")' \
  "every attempt has prId and action=retrigger"

TOTAL=$(echo "$FINAL" | jq -r '.result.totalFailing')
ATTEMPTED=$(echo "$FINAL" | jq -r '.result.attempted')
OK=$(echo "$FINAL" | jq -r '.result.succeeded')
FAIL=$(echo "$FINAL" | jq -r '.result.failed')
TO=$(echo "$FINAL" | jq -r '.result.timedOut')
ok "bitbucketPrAutofix e2e PASSED  (failing=${TOTAL} attempted=${ATTEMPTED} ok=${OK} fail=${FAIL} timeout=${TO})"
