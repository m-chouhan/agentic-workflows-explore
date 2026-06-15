# bitbucket-pr-autofix workflow

Given a Bitbucket repo, finds open PRs with a failing build and retriggers their
pipeline. Deliberately minimal: it fires the retrigger and records what it did —
it does **not** wait for the new pipelines to finish.

## Flow

```
bitbucketPrAutofix(repo)
  ├─ step: find-failing-prs   list open PRs, keep those whose build is FAILED/STOPPED
  ├─ for each failing PR:
  │    └─ step: retrigger-{prId}  → POST /pipelines/ (Bitbucket Pipelines API)
  └─ step: persist            one pr_autofix_runs row
```

## HTTP API

```
POST /workflow/pr-autofix       { "repo": "workspace/slug" }   → 202 ENQUEUED
GET  /workflow/pr-autofix/:id   poll status / result
```

## Result

```jsonc
{
  "repo": "atlassian/dt-proc",
  "totalFailing": 3,
  "triggered": 3,            // retriggers that succeeded
  "retriggers": [ { "prId": 12, "sourceBranch": "...", "pipelineUuid": "...", "triggered": true, "error": null } ],
  "status": "completed"
}
```

## Persistence

`pr_autofix_runs` — one row per workflow (totals + the `retriggers_json` array), upserted on
`workflow_id` so the workflow is safe to replay.

## Future evolution (NOT in this iteration)

- Poll each retriggered pipeline to a terminal state and record the outcome.
- More recovery actions beyond retrigger (rebase, code-change via Rovo CLI).
- Reuse failing PRs from a prior `bitbucketPrStatus` run instead of re-discovering.
- Parallelise per-PR work via `DBOS.startWorkflow` onto a bounded-concurrency queue.

## Manual run

```bash
curl -X POST http://localhost:3002/workflow/pr-autofix \
  -H 'Content-Type: application/json' -d '{"repo":"atlassian/dt-proc"}'

curl http://localhost:3002/workflow/pr-autofix/<workflowId>
```
