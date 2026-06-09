# bitbucket-pr-autofix workflow

Given a Bitbucket repo, finds open PRs with failing builds and attempts to
recover each one in sequence. Today the only recovery action is **retrigger**;
the design leaves room for `rebase` and `code-change` (via Rovo CLI) later.

## Flow

```
bitbucketPrAutofix(input)
  ├─ resolve-failing      (discover from repo OR reuse pr_status_runs row)
  ├─ persist-run-start    (status="running", attempts=0)
  └─ for each failing PR (sequential):
       ├─ step: trigger-{prId}        → POST /pipelines/   (Bitbucket Pipelines API)
       └─ loop with DBOS.sleep:
            step: poll-{prId}-{i}     → GET /pipelines/{uuid}
            until terminal (SUCCESSFUL | FAILED | STOPPED | ERROR) or MAX_POLLS
       └─ persist-attempt-{prId}
  └─ persist-run-end      (status="completed", final tallies)
```

`DBOS.sleep` between polls is **durable** — the workflow survives worker
restarts mid-poll without losing progress.

## Input

```jsonc
// either discover failing PRs fresh:
{ "repo": "workspace/slug" }

// or reuse a prior bitbucketPrStatus run:
{ "statusWorkflowId": "pr-status-..." }
```

The Zod union schema in `routes.ts` enforces exactly one of the two.

## HTTP API

```
POST /workflow/pr-autofix       enqueue
GET  /workflow/pr-autofix/:id   poll
```

## Persistence

| Table | Purpose |
|---|---|
| `pr_autofix_runs` | one row per workflow (totals + status) |
| `pr_autofix_attempts` | one row per PR attempt (action, pipeline UUID, outcome) |

Both upsert on a unique key — the workflow is safe to replay.

## Constants (`constants.ts`)

| Const | Default | Notes |
|---|---|---|
| `POLL_INTERVAL_MS` | 30 000 | sleep between polls inside the loop |
| `MAX_POLLS` | 30 | ~15 min ceiling per PR before `outcome="timeout"` |
| `FAILED_BUILD_STATES` | `{FAILED, STOPPED}` | which PRs we consider worth retriggering |

## Future evolution (NOT in this iteration)

1. **More actions.** The `action` column on attempts is already enum-shaped:
   add `"rebase"` (rebase PR branch onto destination) and `"code-change"`
   without schema changes.
2. **Rovo CLI for code-change.** Running `rovo` inside the Docker worker is
   awkward (CLI install, repo clones, host FS access). Cleaner pattern:
   - Keep the Docker worker for deterministic API steps.
   - Run a **second worker process directly on the VPS host** (outside Docker)
     subscribed to a dedicated `rovo-fix-queue`. Docker worker enqueues a
     code-change job; the host worker has filesystem + `rovo` binary and runs
     it natively. DBOS queues are just Postgres rows, so heterogeneous workers
     work out of the box.
3. **Parallel PRs.** Replace the sequential `for` with one
   `DBOS.startWorkflow` per PR onto a bounded-concurrency queue.

## Manual run

```bash
curl -X POST http://localhost:3002/workflow/pr-autofix \
  -H 'Content-Type: application/json' \
  -d '{"repo":"atlassian/dt-proc"}'
# → { "workflowId": "...", "status": "ENQUEUED", "pollUrl": "..." }

curl http://localhost:3002/workflow/pr-autofix/<workflowId>
```
