# Bitbucket PR Autofix — Learnings & Reasoning Layer Plan

**Date:** 2026-06-09  
**Status:** MVP live-validated; reasoning layer designed  
**Related:** `bitbucket-pr-autofix-lld_20260608.md`, `3p-integration-layer-lld_20260608.md`

---

## 1. What We Built (MVP recap)

The `bitbucketPrAutofix` workflow discovers open PRs with failing builds on a
Bitbucket repo and attempts to recover each one — today with a single action:
**retrigger the pipeline**.

### Architecture in one diagram

```
POST /workflow/pr-autofix
{ "repo": "atlassian/dt-proc" }
         │
         ▼
  [DBOS Queue]  bitbucket-pr-autofix-queue
         │
         ▼
  bitbucketPrAutofix workflow (worker)
         │
         ├─ step: resolve-failing
         │    ├─ option A: call Bitbucket API fresh (source="discover")
         │    └─ option B: read pr_status_runs table (source="reuse")
         │
         ├─ step: persist-run-start  ──▶  pr_autofix_runs (status="running")
         │
         └─ for each failing PR (sequential):
              ├─ step: trigger-{prId}       POST /pipelines/  (retrigger)
              ├─ loop: DBOS.sleep(30s)
              │        step: poll-{prId}-{i}  GET /pipelines/{uuid}
              │        until terminal or MAX_POLLS=30 (~15 min ceiling)
              ├─ step: persist-attempt-{prId}  ──▶  pr_autofix_attempts
              └─ ...next PR...

         └─ step: persist-run-end  ──▶  pr_autofix_runs (status="completed")
```

### Key engineering decisions

| Decision | What | Why |
|---|---|---|
| New workflow, not extension | `bitbucketPrAutofix` is a separate vertical module | Keeps read-only snapshot (`bitbucketPrStatus`) decoupled from side-effecting actions |
| `DBOS.sleep` in poll loop | Durable 30s sleep between polls | Survives worker restarts — DBOS replays from last completed step, not from scratch |
| Sequential PRs | Process one PR at a time | Predictable, easy to debug; parallel is a 1-line swap later |
| Union input | `{ repo }` OR `{ statusWorkflowId }` | Fresh discovery OR reuse a prior curated snapshot — flexible without UI |
| Per-attempt DB row | `pr_autofix_attempts (workflow_id, pr_id) UNIQUE` | Audit trail + idempotent upsert on replay; foundation for multi-action analytics |
| Upsert everywhere | Both table writes use `ON CONFLICT DO UPDATE` | DBOS can replay any step — DB writes must be idempotent |

---

## 2. Live Run Results (2026-06-09, atlassian/dt-proc)

Triggered against a real Bitbucket repo with 23 open PRs in failed build state.
Results as of 4 PRs processed:

| PR | Branch | Outcome | Final State | Polls | Interpretation |
|---|---|---|---|---|---|
| #2013 | `renovate/chokidar-5.x` | **failed** | FAILED | 11 | Genuine breakage — build correctly fails again after retrigger |
| #2025 | `renovate/oas3-chow-chow-4.x` | ✅ **succeeded** | SUCCESSFUL | 10 | Flaky build — recovered on retrigger |
| #2009 | `renovate/brace-expansion-5.x` | ✅ **succeeded** | SUCCESSFUL | 14 | Flaky build — recovered on retrigger |
| #2019 | `renovate/glob-13.x` | **failed** | FAILED | 10 | Genuine breakage |

**Signal extracted:** ~50% of "failing" builds in this repo are flaky (recover
on retrigger). The other 50% are genuine failures that need investigation.
This is exactly the split that motivates the reasoning layer — retrigger-only
is insufficient for the genuinely broken PRs.

### What `initial_state = PENDING` means

When you `POST /pipelines/` to trigger a new build, Bitbucket returns the
pipeline in `PENDING` state (queued, not yet running). The first poll usually
sees `IN_PROGRESS`. Final states are `SUCCESSFUL`, `FAILED`, `STOPPED`, or
`ERROR`. The `flattenPipelineState()` helper in `platform/bitbucket.ts` maps
Bitbucket's nested `{ state.name, state.result.name }` envelope into this flat
enum.

### Why run totals show 0 mid-run

`pr_autofix_runs.attempted` (and `succeeded`, `failed`, etc.) are written **only
at the `persist-run-end` step** — i.e. when the full workflow completes. During
the run, individual attempt rows are in `pr_autofix_attempts`. This is an
intentional design: the run row is a summary, not a live counter. If you need
live progress, query `pr_autofix_attempts` directly.

---

## 3. Test Strategy

```
Tier 1 — API surface (AUTOFIX_DRY=1, default in CI):
  - empty body → 400 (Zod union rejection)
  - bad repo format → 400
  - unknown workflow ID → 404
  These run without BITBUCKET_TOKEN and without triggering any pipelines.

Tier 2 — Live e2e (AUTOFIX_DRY=0, manual):
  - enqueue → 202 + workflowId
  - poll until SUCCESS
  - result shape: repo, source, attempts[], succeeded/failed/timedOut counts
  - invariant: succeeded + failed + timedOut ≤ attempted
  - every attempt.action == "retrigger"
```

Run Tier 2:
```bash
AUTOFIX_E2E=1 POLL_TIMEOUT=900 npm run test:e2e
```

Monitor mid-run:
```bash
docker exec dbos-agentic-postgres bash -c \
  'psql -U $POSTGRES_USER -d dbos_platform -c \
  "SELECT pr_id, source_branch, outcome, final_state, poll_count FROM pr_autofix_attempts ORDER BY id;"'
```

---

## 4. Reasoning Layer — Plan

The MVP proves the mechanical loop works. The next iteration adds a **triage
step** that reads the failed pipeline's logs and uses `acli rovodev run` to
decide which recovery action to take — rather than blindly retriggering
everything.

### The problem with retrigger-only

- For flaky builds: retrigger works. ✅
- For genuine failures: retrigger wastes CI minutes and confirms what we
  already knew. ❌ We need to understand *why* it failed and pick a smarter
  action.

### Why `acli rovodev run` instead of a raw LLM call

We validated this on 2026-06-09. Key findings:

```bash
# stdout-only (INFO logs go to stderr):
acli rovodev run "prompt here" 2>/dev/null

# Returns clean JSON when asked — no markdown fence needed if you say "no markdown":
{"action": "code-change", "reasoning": "...", "confidence": 0.92}
```

**Test 1 — peer dependency conflict (chokidar-5.x):**
```
npm ERR! ERESOLVE could not resolve
npm ERR! peer chokidar@"^5.0.0" from some-package@2.1.0
```
→ `{ action: "code-change", confidence: 0.92 }` ✅ correct

**Test 2 — flaky async timeout:**
```
1) Suite timeout of 2000ms exceeded.
passed: 142, failing: 1
```
→ `{ action: "retrigger", confidence: 0.82 }` ✅ correct

**Why it's better than a raw LLM call:**
- Full workspace context (7,845 files indexed, AGENTS.md loaded)
- Atlassian skills built-in (knows Bitbucket, Jira, your patterns)
- Prior session awareness via `--restore`
- No prompt engineering required — it reasons from context
- Model: `claude-sonnet-4-6`, ~15s per call, deterministic JSON output

**Practical notes:**
- `2>/dev/null` suppresses INFO logs cleanly
- Response is in markdown code fence when multi-line, clean JSON when asked explicitly
- Session ID returned for `--restore` if you want conversational follow-up
- Non-interactive: starts, responds, exits — no TTY needed

### Proposed action taxonomy

| Action | When | How |
|---|---|---|
| `retrigger` | Failure looks transient (network, cache, flaky test, timeout) | POST /pipelines/ |
| `rebase` | Branch is stale — base branch has moved on (merge conflicts) | `git rebase origin/<dest>` + force-push |
| `code-change` | Actual code/dependency breakage in this PR's changes | `acli rovodev run` with failure log + diff |

The `action` column on `pr_autofix_attempts` already supports this — no schema
change needed.

### Where the reasoning step fits

```
for each failing PR:

  NEW ─── step: fetch-prior-pipeline-{prId}
  │         getLatestPipelineForBranch(repo, branch)
  │         → prior failed pipeline UUID (to read logs from, NOT the new trigger)
  │
  NEW ─── step: fetch-logs-{prId}
  │         getPipelineSteps(repo, priorUuid)
  │         getPipelineStepLog(repo, priorUuid, failedStepUuid)
  │         → raw failure log (last N lines, ~4000 chars)
  │
  NEW ─── step: triage-{prId}   (acli rovodev run)
  │         input:  PR metadata + failure log
  │         output: { action, reasoning, confidence }
  │         if confidence < 0.7 → default to "retrigger" (safe)
  │
  EXISTING ─ step: trigger-{prId}     (if action == "retrigger")
  OR NEW ─── step: rebase-{prId}      (if action == "rebase")
  OR NEW ─── step: code-change-{prId} (if action == "code-change", deferred — needs host worker)
  │
  EXISTING ─ loop: poll-{prId}-{i}
  EXISTING ─ step: persist-attempt-{prId}   (now includes triage.reasoning)
```

### Bitbucket log API

```
GET /repositories/{workspace}/{repo_slug}/pipelines/?target.branch={branch}&sort=-created_on&pagelen=1
  → most recent pipeline for a branch (to get prior failure UUID)

GET /repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps/
  → list of steps; find the one with state.result.name == "FAILED"

GET /repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps/{step_uuid}/log
  → raw text log (the terminal output of the failed step)
```

> **Key gotcha:** We need a *prior* failed pipeline UUID to read logs from, not
> the newly triggered one. So fetch-prior-pipeline runs **before** the trigger
> step. That gives us the failure evidence to feed to the triage step.

These three calls go into `platform/bitbucket.ts` as:
- `getLatestPipelineForBranch(repo, branch)` → `BitbucketPipeline | null`
- `getPipelineSteps(repo, uuid)` → `BitbucketPipelineStep[]`
- `getPipelineStepLog(repo, uuid, stepUuid)` → `string`

### Triage step via `acli rovodev run`

```typescript
// steps/triage.ts
import { execSync } from "child_process";
import type { FailingPr } from "../schemas";

export interface TriageResult {
  action: "retrigger" | "rebase" | "code-change";
  reasoning: string;
  confidence: number;
}

const CONFIDENCE_THRESHOLD = 0.7;

export async function triagePrFailure(
  pr: FailingPr,
  failureLog: string,
): Promise<TriageResult> {
  const prompt = `You are a CI triage expert. A Bitbucket PR has a failing build.

PR: ${pr.title}
Branch: ${pr.sourceBranch} → ${pr.destBranch}
Author: ${pr.author}

Build failure log (last 100 lines):
${failureLog.slice(-4000)}

Decide the recovery action:
- "retrigger": transient failure (network, cache, timeout, flaky test)
- "rebase": stale branch / merge conflict with base
- "code-change": actual code or dependency issue in this PR

Reply with ONLY valid JSON (no markdown):
{"action": "retrigger|rebase|code-change", "reasoning": "one sentence", "confidence": 0.0}`;

  const raw = execSync(`acli rovodev run ${JSON.stringify(prompt)} 2>/dev/null`, {
    timeout: 60_000,
    encoding: "utf8",
  }).trim();

  // Strip optional markdown code fence
  const json = raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "").trim();
  const result = JSON.parse(json) as TriageResult;

  // Fall back to retrigger if confidence is too low
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    return { action: "retrigger", reasoning: `Low confidence (${result.confidence}); defaulting to retrigger`, confidence: result.confidence };
  }
  return result;
}
```

### Schema change for triage

Add `triage_action` and `triage_reasoning` to `pr_autofix_attempts`:

```sql
ALTER TABLE pr_autofix_attempts
  ADD COLUMN IF NOT EXISTS triage_action   TEXT,
  ADD COLUMN IF NOT EXISTS triage_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS triage_confidence NUMERIC(4,3);
```

### Where `acli rovodev run` fits (host worker vs Docker)

**For triage (retrigger/rebase decisions):** runs fine inside the Docker worker
as a subprocess — just needs `acli` installed in the worker image, or (for MVP)
just run the worker on the host directly (outside Docker).

**For `code-change`:** `acli rovodev run` needs the full repo on the filesystem
to actually make file edits and commit. This is the host worker case:

```
Docker container (deterministic API steps):
  resolve, fetch-logs, triage, retrigger, poll, persist

VPS host process (side-effecting CLI steps):
  git clone, acli rovodev run "fix ...", git push
  (DBOS step: persist code-change outcome back to the same DB)
```

Both workers use the same Postgres system DB. The Docker worker enqueues the
code-change job; the host worker picks it up. DBOS queues are Postgres rows —
heterogeneous workers work out of the box.

### Implementation order (recommended)

1. **Bitbucket log API** — `getLatestPipelineForBranch`, `getPipelineSteps`,
   `getPipelineStepLog` in `platform/bitbucket.ts`
2. **`steps/fetchLogs.ts`** — wraps the three calls, returns truncated log string
3. **`steps/triage.ts`** — `acli rovodev run` subprocess, JSON parse, confidence gate
4. **Update orchestration** in `index.ts` — insert fetch-logs + triage before
   trigger; branch on `action`; pass `triage.*` into persist
5. **Schema migration** — add three triage columns to `pr_autofix_attempts`
6. **`steps/rebase.ts`** — `git rebase` + push (Docker; needs git+SSH in image)
7. **Host worker + `code-change` action** — separate process, separate queue (iteration 3)

---

## 5. Open Questions

- **Log truncation strategy.** Pipeline logs can be very long (thousands of
  lines). What's the right window to send the LLM? Last 100 lines? The lines
  around `ERROR` / `FAILED` / `AssertionError`? A regex-extracted failure block?
- **Triage confidence threshold.** If the LLM is <70% confident, default to
  `retrigger` (safe, cheap). Define the threshold in `constants.ts`.
- **Rebase safety.** Force-pushing a rebased branch can break other reviewers'
  local copies. Should we add a Bitbucket PR comment before rebasing?
- **Rate limits.** Bitbucket Pipelines API has rate limits. With 23 PRs, we're
  fine. At 100+ PRs, we'd need to add delays between triggers.
- **Rovo CLI prompt design.** The prompt for `code-change` needs to be careful:
  give it the failing log + the PR diff only (not the whole codebase). Design
  this prompt before building the host worker.
