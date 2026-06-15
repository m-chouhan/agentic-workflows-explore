# bitbucket-pr-autofix workflow

Given a Bitbucket repo, finds the **first** open PR with a failing build and
retriggers its pipeline. Deliberately minimal: one retrigger per run, logged so
you can verify it landed on the right PR. No business table — the result is the
workflow's return value, which DBOS persists and the GET endpoint serves.

## Flow

```
bitbucketPrAutofix(repo)
  ├─ step: find-first-failing-pr   list open PRs, return the first FAILED/STOPPED build
  └─ step: retrigger               → POST /pipelines/ for that PR's source branch
```

If no failing PR is found, it returns `triggered: false` and does nothing.

## HTTP API

```
POST /workflow/pr-autofix       { "repo": "workspace/slug" }   → 202 ENQUEUED
GET  /workflow/pr-autofix/:id   poll status / result (from DBOS workflow state)
```

## Result

```jsonc
{
  "repo": "atlassian/dt-proc",
  "triggered": true,
  "prId": 2022,
  "sourceBranch": "renovate/minimatch-10.x",
  "url": "https://bitbucket.org/atlassian/dt-proc/pull-requests/2022",
  "pipelineUuid": "{94da6298-...}"
}
```

## Verifying a run

The worker logs the PR before and after triggering:

```
[bb-autofix] retriggering PR #2022 (renovate/minimatch-10.x) https://bitbucket.org/...  buildState=FAILED
[bb-autofix] ✓ triggered pipeline {94da6298-...} for PR #2022 (renovate/minimatch-10.x)
```

```bash
npm run stack:logs worker | grep bb-autofix
```

## Future evolution (NOT in this iteration)

- Trigger all failing PRs (not just the first) and/or parallelise via `DBOS.startWorkflow`.
- Poll each retriggered pipeline to a terminal state and record the outcome.
- A `pr_autofix_runs` projection table — add when you need "runs per repo" queries,
  dashboards, or mid-run progress (DBOS output only exists once the workflow completes).
- More recovery actions beyond retrigger (rebase, code-change via Rovo CLI).

## Manual run

```bash
curl -X POST http://localhost:3002/workflow/pr-autofix \
  -H 'Content-Type: application/json' -d '{"repo":"atlassian/dt-proc"}'

curl http://localhost:3002/workflow/pr-autofix/<workflowId>
```
