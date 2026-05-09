# DBOS in a Distributed Environment — Deep Research Report

**Date:** 2026-05-09
**Context:** Part of the Agentic Workflow Platform PoC series. Answers concrete questions about how DBOS works across multiple processes / K8s pods, where workflow code lives, and how to deploy new workflows without downtime.

---

## Executive Summary

**Key bullets:**
- DBOS distributes work via **Postgres-backed queues + `FOR UPDATE SKIP LOCKED`** — no message broker needed.
- **Workflow definitions (code) live ONLY in the worker process.** The app server uses `DBOSClient` + workflow name as a string.
- **Crash recovery without Conductor is executor-scoped** (same pod must restart). With Conductor, any healthy pod recovers dead pods' workflows after a 60-second timeout.
- **No hot-reload / dynamic registration.** Adding a new workflow type requires a worker restart (or new deployment).
- **Recommended topology for a multi-workflow platform:** separate K8s Deployments per workflow type, all sharing the same Postgres system database, deployed via GitOps (ArgoCD).
- **DBOS Conductor is cloud-only / not self-hostable.** For self-hosted: use direct Postgres queries + Langfuse + Time-Travel Debugger.

---

## 1. How DBOS Distributes Work — The Core Mechanism

DBOS has **no orchestration server**. All coordination happens through a single shared Postgres database using row-level locking.

### The polling loop

Every worker process running `DBOS.launch()` polls the Postgres system database on a configurable interval (`polling_interval_sec`, default ~1 second):

```sql
-- What the DBOS dequeue loop does internally:
SELECT * FROM dbos.workflow_status
WHERE  status    = 'ENQUEUED'
AND    queue_name = 'my-queue'
ORDER  BY priority ASC, created_at ASC
LIMIT  <worker_concurrency>
FOR UPDATE SKIP LOCKED;   -- ← KEY: Postgres-native distributed lock
```

`SKIP LOCKED` means: "skip rows already locked by another worker." Each worker grabs a different batch — **no duplicates, no message broker, no ZooKeeper.**

### Performance ceiling

> *"A DBOS application using a single Postgres database can sustain a throughput of >40K workflows or steps per second. Scaling beyond that is possible by sharding workflows across multiple Postgres databases."*
> — https://docs.dbos.dev/architecture

---

## 2. Complete LLD — Distributed DBOS System

```
════════════════════════════════════════════════════════════════════════
                     DISTRIBUTED DBOS — LOW LEVEL DESIGN
════════════════════════════════════════════════════════════════════════

  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │  App Server A    │  │  App Server B    │  │  App Server C    │
  │  (Express/FastAPI│  │  (Express/FastAPI│  │  (Express/FastAPI│
  │                  │  │                  │  │                  │
  │  DBOSClient      │  │  DBOSClient      │  │  DBOSClient      │
  │  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │
  │  │enqueue(    │  │  │  │enqueue(    │  │  │  │enqueue(    │  │
  │  │ queue:str, │  │  │  │ queue:str, │  │  │  │ queue:str, │  │
  │  │ name: str, │  │  │  │ name: str, │  │  │  │ name: str, │  │
  │  │ args: JSON │  │  │  │ args: JSON │  │  │  │ args: JSON │  │
  │  │)           │  │  │  │)           │  │  │  │)           │  │
  │  └─────┬──────┘  │  │  └─────┬──────┘  │  │  └─────┬──────┘  │
  └────────┼─────────┘  └────────┼─────────┘  └────────┼─────────┘
           │                     │                      │
           └─────────────────────┼──────────────────────┘
                                 │ INSERT INTO dbos.workflow_status
                                 │ (status=ENQUEUED, executor_id=NULL)
                                 ▼
  ╔══════════════════════════════════════════════════════════════════╗
  ║           POSTGRES SYSTEM DATABASE  (single source of truth)    ║
  ║                                                                  ║
  ║  ┌────────────────────────────────────────────────────────────┐ ║
  ║  │ dbos.workflow_status                                       │ ║
  ║  │  workflow_id | status   | name | queue_name | executor_id │ ║
  ║  │  uuid-001    | ENQUEUED | wfA  | q-trading  | NULL        │ ║
  ║  │  uuid-002    | PENDING  | wfB  | q-reports  | worker-pod1 │ ║
  ║  │  uuid-003    | SUCCESS  | wfA  | q-trading  | worker-pod2 │ ║
  ║  └────────────────────────────────────────────────────────────┘ ║
  ║                                                                  ║
  ║  ┌────────────────────────────────────────────────────────────┐ ║
  ║  │ dbos.operation_outputs  (step checkpoints)                 │ ║
  ║  │  workflow_id | function_id | output (JSON)                 │ ║
  ║  │  uuid-002    | 0           | {"rows": 23075}               │ ║
  ║  │  uuid-002    | 1           | {"totalRevenue": 1.1M}        │ ║
  ║  │  uuid-002    | 2           | (crashed here — no row yet)   │ ║
  ║  └────────────────────────────────────────────────────────────┘ ║
  ║                                                                  ║
  ║  ┌──────────────────────────────────────────────────────────┐   ║
  ║  │ dbos.workflow_inputs  | workflow_messages | scheduler_state│  ║
  ║  └──────────────────────────────────────────────────────────┘   ║
  ╚══════════════════════════════════════════════════════════════════╝
           ▲                     ▲                      ▲
           │ FOR UPDATE          │  FOR UPDATE          │ FOR UPDATE
           │ SKIP LOCKED         │  SKIP LOCKED         │ SKIP LOCKED
           │ (polls every 1s)    │  (polls every 1s)    │
  ┌────────┴─────────┐  ┌────────┴─────────┐  ┌────────┴─────────┐
  │  Worker Pod 1    │  │  Worker Pod 2    │  │  Worker Pod 3    │
  │  DBOS.launch()   │  │  DBOS.launch()   │  │  DBOS.launch()   │
  │  executor_id:W1  │  │  executor_id:W2  │  │  executor_id:W3  │
  │                  │  │                  │  │                  │
  │  @DBOS.workflow()│  │  @DBOS.workflow()│  │  @DBOS.workflow()│
  │  @DBOS.step()    │  │  @DBOS.step()    │  │  @DBOS.step()    │
  │  (code lives here│  │  (code lives here│  │  (code lives here│
  │                  │  │                  │  │                  │
  │  [wss]──────────►│  │  [wss]──────────►│  │  [wss]──────────►│
  │  DBOS Conductor  │  │  DBOS Conductor  │  │  DBOS Conductor  │
  │  (optional,      │  │  (optional)      │  │  (optional)      │
  │   cloud-only)    │  │                  │  │                  │
  └──────────────────┘  └──────────────────┘  └──────────────────┘

  KEY POINTS:
  • App servers & workers only communicate through Postgres (no pod-to-pod calls)
  • Each worker has a UNIQUE executor_id — critical for recovery scoping
  • Postgres FOR UPDATE SKIP LOCKED = zero-contention distributed dequeue
  • Conductor is optional; without it, recovery is per-executor-id only
```

---

## 3. Concrete Answer: Q1 — Where do workflow definitions sit?

> **"For distributed env with app servers + workers — where does the definition of work sit? Is it in the worker or the app server?"**

### Answer: **ONLY in the Worker. The App Server is completely ignorant of the function code.**

This is proven by the official queue-worker example:

**Worker process** — owns ALL workflow code:
```typescript
// worker.ts — THE ONLY PLACE workflows are defined
class SalesAnalysisWorkflow {
  @DBOS.workflow()
  static async analyzeYear(year: number) { ... }

  @DBOS.step()
  static async readSalesData(year: number) { ... }

  @DBOS.step()
  static async runAnalysisAgent(data: any) { ... }
}

// Launches DBOS runtime — registers all decorated functions
await DBOS.launch();
// Then polls Postgres queue forever, picks up ENQUEUED rows,
// calls the right function by name
```

**App server process** — uses `DBOSClient`, knows only string names:
```typescript
// server.ts — NO workflow code at all
import { DBOSClient } from "@dbos-inc/dbos-sdk";

const client = await DBOSClient.create({
  systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL
});

// App server enqueues by STRING NAME only:
await client.enqueue(
  {
    queueName: "analysis-queue",    // string
    workflowName: "analyzeYear",    // string — no function import!
  },
  year                              // args (JSON-serializable)
);
```

**How the name lookup works:**
1. App server inserts `workflow_name = "analyzeYear"` into `dbos.workflow_status`
2. Worker dequeues the row, reads `workflow_name`
3. Worker's DBOS runtime looks up the registered function by name in its local registry (populated by `@DBOS.workflow()` decorators at import time)
4. Worker invokes the function

**Official documentation:** https://docs.dbos.dev/python/examples/queue-worker
**Architecture reference:** https://docs.dbos.dev/architecture

---

## 4. Concrete Answer: Q2 — Do we need restarts to add new workflows?

> **"If I want to manage multiple workflows, and deploy new ones easily, do we need app OR workflow service restarts to accommodate new workflows?"**

### Answer: **Yes — worker restart is required. But it can be a zero-downtime rolling restart.**

**Why restarts are required:**
- DBOS uses decorator-based static registration: `@DBOS.workflow()` runs at import time
- There is **no dynamic workflow registry**, no hot-reload, no plugin system
- New workflow type = new function must be imported before `DBOS.launch()` is called

**The good news — rolling restart = zero downtime:**

For a K8s Deployment with 3 replicas:
```
Rolling update (maxUnavailable: 1):
  Pod 1: still running old code, finishing in-flight workflows
  Pod 2: restarting with new code (includes new workflow type)
  Pod 3: still running old code
         ↓
  Pod 1: restarting with new code
  Pod 2: running new code
  Pod 3: still running old code
         ↓
  All 3: running new code ✓
```

In-flight workflows on the old code continue on pods that haven't restarted yet.
New workflow types are available the moment the first pod comes back.

**For adding a BRAND NEW workflow type without affecting existing:**

Best practice is the **separate deployment per workflow type** pattern:

```
dbos-worker-trading/     ← only knows about TradingRiskWorkflow
dbos-worker-reports/     ← only knows about ReportGenWorkflow  (deploy new one here)
dbos-worker-voice/       ← only knows about VoiceAgentWorkflow
```

Adding a new workflow type = `kubectl apply -f new-worker-deployment.yaml`.
Zero impact on existing workers. No restarts.

**For changing an EXISTING workflow's code:**
- Blue-green is the safe path (see Section 7)

---

## 5. End-to-End Request → Recovery Flow

```
  T+0s   Client: POST /api/analyze { year: 2025 }
         │
         ▼ App Server (DBOSClient)
         INSERT INTO dbos.workflow_status
           (workflow_id='uuid-abc', status='ENQUEUED',
            name='analyzeYear', queue_name='analysis-q',
            inputs='[2025]', executor_id=NULL)
         │
         Returns: { workflowId: 'uuid-abc', status: 'PENDING' }

  T+1s   Worker Pod 1 polling loop fires:
         SELECT ... FOR UPDATE SKIP LOCKED
         Grabs uuid-abc (other workers skip it — it's locked)
         UPDATE workflow_status SET status='PENDING', executor_id='W1'
         │
         Calls analyzeYear(2025)

  T+1.1s Step 0 (readSalesData):
         Check operation_outputs WHERE workflow_id='uuid-abc' AND function_id=0
         → No row → execute step → INSERT output → checkpoint ✓

  T+1.5s Step 1 (aggregateSales):
         Check operation_outputs WHERE function_id=1
         → No row → execute → INSERT output → checkpoint ✓

  T+1.6s 💥 CRASH — Worker Pod 1 dies here
         workflow_status: status=PENDING, executor_id='W1'
         operation_outputs: rows for function_id=0 and 1 only

         ─── Without Conductor ───────────────────────────────────
         K8s restarts Pod 1 (same executor_id='W1' or new one)
         DBOS.launch() scans: WHERE executor_id='W1' AND status='PENDING'
         Finds uuid-abc → re-runs analyzeYear(2025)
         → Step 0: output exists → SKIP (no re-execution)
         → Step 1: output exists → SKIP (no re-execution)
         → Step 2: no output → EXECUTE ← resumes here ✓

         ─── With Conductor ──────────────────────────────────────
         T+60s: Conductor marks W1 as DEAD
         T+61s: Conductor signals W2 to recover
         W2 runs same replay logic above (steps 0,1 skipped, step 2 executes)

  T+2.0s Step 2 (runAnalysisAgent): executes → checkpoint ✓
  T+2.1s Step 3 (writeInsights):    executes → checkpoint ✓
         UPDATE workflow_status SET status='SUCCESS', output='{...}'

  T+3s   Client: GET /api/analyze/uuid-abc
         → { status: 'SUCCESS', result: { topProduct: '...', ... } }
```

---

## 6. The `executor_id` — Critical for Distributed Recovery

| Scenario | `executor_id` | What happens on recovery |
|---|---|---|
| Single pod, same pod restarts | `W1` → `W1` | Pod recovers its own workflows on `DBOS.launch()` |
| Single pod, new pod (K8s reschedule) | `W1` → `W2` | Old `W1` workflows stay PENDING forever **without Conductor** |
| Multiple pods, Conductor enabled | `W1`, `W2`, `W3` | Conductor reassigns W1's workflows to W2 or W3 after 60s |
| Two pods share same executor_id | ⚠️ DANGER | Race condition — both try to recover same workflows |

**In K8s without Conductor:** set executor_id to the pod name via downward API:
```yaml
env:
  - name: DBOS_EXECUTOR_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name  # e.g., "dbos-worker-abc123"
```

**With Conductor:** executor_id is auto-assigned. Cross-pod recovery is automatic.

---

## 7. Workflow Versioning — Safe Code Updates

### The problem

DBOS replays workflows by calling the workflow function again and checking for step checkpoints. If you **change the order or number of steps**, a replaying workflow hits a different checkpoint index than expected → exception → workflow fails.

### Strategy 1: Patching (small changes)

Use `DBOS.patch()` to add conditional branches:
```typescript
@DBOS.workflow()
static async analyzeYear(year: number) {
  const rows = await this.readSalesData(year);
  const aggregated = await this.aggregateSales(year, rows);
  
  // New step added in v2 — use patch to gate it
  if (DBOS.patch("added-validation-step")) {
    await this.validateAggregation(aggregated); // new step
  }
  
  const analysis = await this.runAnalysisAgent(aggregated);
  ...
}
```
Old workflows replay the old path; new workflows execute the new path.

**Reference:** https://docs.dbos.dev/typescript/tutorials/upgrading-workflows

### Strategy 2: Blue-Green versioning (breaking changes)

```
Step 1: Deploy v2 worker (new Deployment, new image tag)
        Set DBOS__APPVERSION=v2-<git-sha> on new pods
        New invocations → routed to v2
        
Step 2: v1 workers keep running, drain in-flight v1 workflows
        Monitor: SELECT application_version, status, COUNT(*)
                 FROM dbos.workflow_status
                 GROUP BY application_version, status;
                 
Step 3: Once v1 workflow_status shows zero PENDING rows for v1
        kubectl delete deployment dbos-worker-v1
```

DBOS auto-computes `application_version` from a hash of workflow source code.

**Reference:** https://docs.dbos.dev/typescript/tutorials/upgrading-workflows

---

## 8. Recommended Platform Topology for Multi-Workflow Types

```
┌────────────────────────────────────────────────────────────────────┐
│                     K8s CLUSTER                                    │
│                                                                    │
│  Ingress / API Gateway                                             │
│  └─ routes by path or tenant →                                     │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ App Server      │  │ App Server      │  │ App Server      │   │
│  │ Deployment      │  │ Deployment      │  │ Deployment      │   │
│  │ (DBOSClient)    │  │ (DBOSClient)    │  │ (DBOSClient)    │   │
│  │ N replicas      │  │ N replicas      │  │ N replicas      │   │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘   │
│           │enqueue()           │                    │             │
│           └────────────────────┼────────────────────┘             │
│                                │                                  │
│                                ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │             SHARED POSTGRES (RDS / CloudNativePG)           │  │
│  │             dbos_sales_dbos_sys  (DBOS system tables)       │  │
│  └──────┬──────────────────┬───────────────────┬───────────────┘  │
│         │                  │                   │                  │
│         │ polls q-trading  │ polls q-reports   │ polls q-voice    │
│         ▼                  ▼                   ▼                  │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │ Worker:     │   │ Worker:      │   │ Worker:              │   │
│  │ trading-risk│   │ report-gen   │   │ voice-agent          │   │
│  │ Deployment  │   │ Deployment   │   │ Deployment           │   │
│  │ 3 replicas  │   │ 2 replicas   │   │ 1 replica            │   │
│  │             │   │              │   │                      │   │
│  │ @workflow   │   │ @workflow    │   │ @workflow            │   │
│  │ calcRisk()  │   │ genReport()  │   │ handleTurn()         │   │
│  │ @step ...   │   │ @step ...    │   │ @step ...            │   │
│  │             │   │              │   │                      │   │
│  │ KEDA scale  │   │ KEDA scale   │   │ KEDA scale           │   │
│  │ on q depth  │   │ on q depth   │   │ on q depth           │   │
│  └─────────────┘   └──────────────┘   └──────────────────────┘   │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Observability Stack                                          │  │
│  │  Langfuse (Helm) → Postgres + ClickHouse + Redis + MinIO    │  │
│  │  Prometheus + Grafana (OTel GenAI semconv)                  │  │
│  │  Tempo (distributed traces)                                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Adding a new workflow type (zero impact on existing)
1. Write `src/workflows/newWorkflow.ts` in a new repo/package
2. Create `deploy/workers/new-workflow/deployment.yaml`
3. `git push` → ArgoCD applies → new pods start, poll their queue
4. App server calls `client.enqueue({ queueName: "q-new", workflowName: "newWorkflow" }, args)`
5. **Zero restarts to any existing worker**

---

## 9. CI/CD Pattern for K8s

```
Developer pushes code
        │
        ▼
GitHub Actions:
  - npm test / pytest
  - docker build -t ghcr.io/org/dbos-worker-trading:<sha>
  - docker push
        │
        ▼
Update deploy manifests (kustomize image patch):
  image: ghcr.io/org/dbos-worker-trading:<sha>
  env: DBOS__APPVERSION: trading-<sha>
  git commit + push to gitops repo
        │
        ▼
ArgoCD detects manifest change:
  kubectl apply -f deployment.yaml
  (K8s rolling update: maxUnavailable=1)
        │
        ▼
Monitor (check nothing breaks):
  kubectl rollout status deployment/dbos-worker-trading
  psql -c "SELECT application_version, status, COUNT(*)
           FROM dbos.workflow_status
           GROUP BY 1, 2 ORDER BY 1;"
        │
        ▼
Old version pods drain naturally:
  Old in-flight workflows complete on remaining old pods
  New pods handle all new invocations
        │
        ▼
Old pods all replaced ✓ — no manual intervention needed
```

---

## 10. Postgres Tables Reference (dbos system DB)

| Table | Key columns | Purpose |
|---|---|---|
| `dbos.workflow_status` | `workflow_id`, `status` (ENQUEUED/PENDING/SUCCESS/ERROR), `name`, `queue_name`, `executor_id`, `application_version`, `inputs`, `output` | One row per workflow run — the master coordination table |
| `dbos.operation_outputs` | `workflow_id`, `function_id` (step index), `output` | Step checkpoints — the durability guarantee |
| `dbos.workflow_inputs` | `workflow_id`, `inputs` | Serialized inputs for replay |
| `dbos.workflow_messages` | `workflow_id`, `topic`, `message` | `DBOS.send()` / `DBOS.recv()` signals |
| `dbos.workflow_events` | `workflow_id`, `event_key`, `event_value` | `set_event()` / `get_event()` for status pub/sub |
| `dbos.scheduler_state` | `workflow_name`, `next_run_time` | `@DBOS.scheduled()` cron state |
| `dbos.workflow_queue` | `workflow_id`, `queue_name`, `enqueued_at`, `priority` | Queue membership for dequeuing |

**Useful diagnostic queries:**
```sql
-- All workflows and their statuses
SELECT application_version, status, COUNT(*)
FROM dbos.workflow_status
GROUP BY 1, 2 ORDER BY 1;

-- Stuck PENDING workflows (possible recovery needed)
SELECT workflow_id, name, executor_id, started_at
FROM dbos.workflow_status
WHERE status = 'PENDING'
ORDER BY started_at;

-- Step checkpoints for a specific workflow
SELECT function_id, LEFT(output::text, 80) as output_preview
FROM dbos.operation_outputs
WHERE workflow_id = '<uuid>'
ORDER BY function_id;
```

---

## 11. DBOS Conductor — Capabilities & Limitations

| Feature | Available? | Notes |
|---|---|---|
| Dashboard / UI | ✅ | Cloud-only, not self-hostable |
| Cross-pod crash recovery | ✅ With Conductor | 60s timeout before reassignment |
| Workflow cancel / resume | ✅ | Via Conductor UI or `cancelWorkflow()` API |
| Alerts on failure | ✅ | Cloud-only |
| Self-hosted / open-source | ❌ | Closed-source SaaS |
| Free tier | ✅ | Free for small usage |
| Time-Travel Debugger | ✅ | VS Code extension — local only, self-hostable in that sense |

**Self-hosted alternative ops stack:**
- Workflow status → direct Postgres queries (see Section 10)
- LLM traces → Langfuse self-hosted (Helm)
- Metrics → Prometheus + Grafana
- Distributed tracing → Tempo + OTel GenAI semconv
- Debugging → DBOS Time-Travel Debugger (VS Code extension, free)

---

## 12. Summary: Answers to Your Two Questions

### Q1: Where does the definition of work sit — worker or app server?

**→ ONLY in the worker.**

The app server (`DBOSClient`) only knows:
- Queue name (string)
- Workflow function name (string)
- Arguments (JSON)

The worker owns all `@DBOS.workflow()` and `@DBOS.step()` definitions. The app server and worker never share code — they only share a Postgres database.

**Doc:** https://docs.dbos.dev/python/examples/queue-worker | https://docs.dbos.dev/architecture

---

### Q2: Do we need restarts to accommodate new workflows?

**→ Yes, but safely via rolling restarts or separate deployments.**

| Scenario | Restart needed? | Impact |
|---|---|---|
| Add new workflow to existing worker | Yes — rolling restart | Zero downtime with K8s rolling update |
| Add new workflow type as new worker deployment | No — new deployment | Zero impact on existing workers |
| Change existing workflow code (non-breaking) | Yes — rolling restart | Old in-flight workflows finish on old pods; DBOS.patch() for safe gating |
| Change existing workflow code (breaking — new step) | Yes — blue-green | Old pods drain, new pods take new invocations |

**Recommended for a platform:** use **separate K8s Deployments per workflow type**. New workflow = new deployment. Existing workers never touched.

**Doc:** https://docs.dbos.dev/typescript/tutorials/upgrading-workflows | https://docs.dbos.dev/production/hosting-with-kubernetes

---

## References

| Resource | URL |
|---|---|
| DBOS Architecture | https://docs.dbos.dev/architecture |
| Queue-Worker Example (Python) | https://docs.dbos.dev/python/examples/queue-worker |
| Queue Tutorial | https://docs.dbos.dev/python/tutorials/queue-tutorial |
| Workflow Recovery | https://docs.dbos.dev/production/workflow-recovery |
| Conductor Docs | https://docs.dbos.dev/production/conductor |
| K8s Hosting | https://docs.dbos.dev/production/hosting-with-kubernetes |
| System Tables | https://docs.dbos.dev/explanations/system-tables |
| Workflow Versioning | https://docs.dbos.dev/typescript/tutorials/upgrading-workflows |
| DBOSClient Reference | https://docs.dbos.dev/python/reference/client |
| Queue Reference | https://docs.dbos.dev/python/reference/queues |
| Configuration | https://docs.dbos.dev/python/reference/configuration |
