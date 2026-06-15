# bitbucket-pr-autofix workflow

Finds failing Renovate PRs in a Bitbucket repo, asks Rovo Dev to triage each from
its pipeline logs, and acts on the decision: **retrigger** the PR pipeline,
**rebase** (via Rovo Dev), or **flag** for human review. No business table — the
result is the workflow's return value, which DBOS persists and the GET endpoint serves.

Scoped to **non-major** Renovate PRs (low/medium-risk patch/minor bumps), capped at
`MAX_TRIAGE_PRS` per run. High-risk majors need code changes, not automation, so they're skipped.

## Architecture — 3 phases, each a DBOS step

```
bitbucketPrAutofix(repo)                        index.ts = orchestration only
  ├─ step "discover"          (1×)   steps/discover.ts  → list PRs + statuses, keep prs:-failing non-major Renovate
  ├─ step "triage-{prId}"     (N×)   steps/triage.ts    → Rovo Dev reads logs → { decision, confidence, reason }
  └─ step "act-{prId}"        (N×)   steps/act.ts       → retrigger | rebase | flag
```

Per-PR steps (not per-phase) are deliberate: each is the memoization/retry unit, so a
crash mid-run resumes without re-calling Rovo Dev or re-firing a pipeline.

## Requirements

- `BITBUCKET_TOKEN` — list PRs, read statuses, trigger pipelines.
- Rovo Dev serve mode running (`acli rovodev serve 4000`) + `ROVO_DEV_URL` / `ROVO_DEV_TOKEN`.
  From the Docker worker use `http://host.docker.internal:4000`.

## HTTP API

```
POST /workflow/pr-autofix       { "repo": "workspace/slug" }   → 202 ENQUEUED
GET  /workflow/pr-autofix/:id   poll status / result (from DBOS workflow state)
```

## Result

```jsonc
{
  "repo": "atlassian/dt-proc",
  "evaluated": 4,
  "outcomes": [
    { "prId": 1953, "decision": "retrigger", "confidence": 0.9,  "reason": "...", "pipelineUuid": "{4407b9a0-...}", "rebaseOutput": null },
    { "prId": 1342, "decision": "flag",      "confidence": 0.95, "reason": "...", "pipelineUuid": null, "rebaseOutput": null }
  ]
}
```

## Verifying a run

```bash
npm run stack:logs worker | grep bb-autofix
# [bb-autofix] PR #1953 → retrigger (conf=0.9)  transient Artifactory 404, not a code issue
# [bb-autofix] ✓ retriggered PR pipeline {4407b9a0-...} for PR #1953
# [bb-autofix] ✓ done  evaluated=4  {"retrigger":2,"flag":2}
```

## Future evolution (NOT in this iteration)

- Confidence gate between triage and act (only act above a threshold).
- Poll each retriggered pipeline to a terminal state and record the outcome.
- Real `rebase` push (needs git write credentials, separate from `BITBUCKET_TOKEN`).
- `flag` handoff to a PR comment / Slack / Jira (currently log-only).
- Pagination — `listOpenPullRequests` fetches the first 50; dt-proc has ~95 open.

## Manual run

```bash
curl -X POST http://localhost:3002/workflow/pr-autofix \
  -H 'Content-Type: application/json' -d '{"repo":"atlassian/dt-proc"}'

curl http://localhost:3002/workflow/pr-autofix/<workflowId>
```
