# DBOS as a Headless Execution Engine — Comprehensive Research Report

**Research Date:** 2026-05-15
**Global Objective:** Explore n8n + DBOS hybrid agentic workflow platform
**Research Domain:** DBOS as a Headless Execution Engine
**Direction:** Top-down (official docs, GitHub, architecture references first)

---

## Executive Summary

DBOS v4 is **fundamentally designed as a headless execution engine** — it provides extensive HTTP-based triggering, event-driven resumption, workflow introspection via REST APIs, and client-server patterns that make it a natural fit for n8n integration. The system is NOT a monolithic orchestrator; it is a lightweight Postgres-backed library that can be deployed as a separate worker/executor service and triggered entirely via REST endpoints.

**Key findings:**
- ✅ DBOS workflows CAN be triggered via HTTP (through `DBOSClient.enqueue()` from an Express server)
- ✅ DBOS supports **event-driven resumption** via `DBOS.send()` / `DBOS.recv()` for inter-workflow messaging
- ✅ Full workflow introspection is available: `DBOS.listWorkflows()`, `DBOS.getEvent()`, step-level debugging
- ✅ No built-in admin HTTP server beyond optional Koa admin UI (easily replaceable with Express)
- ✅ Queue + worker architecture is clean: server enqueues by string name, worker imports and executes
- ⚠️ DBOS Cloud does not exist yet; only self-hosted via Postgres
- ✅ Durability is comprehensive: step outputs, retry state, workflow status all in Postgres
- ⚠️ Some workflows are poorly suited: stateless request handlers, real-time bidirectional comms

---

## 1. DBOS HTTP Exposure & REST API Surface

### Finding: DBOS v4 Provides HTTP Triggering via Express Integration

**How it works (from code analysis):**

DBOS v4 is **not** a standalone HTTP server. Instead, it's a TypeScript library that integrates with Express:

1. **Server (Express) side:**
   - Starts `DBOSClient` (not DBOS itself)
   - Enqueues workflows by string name: `client.enqueue({ workflowName: "myWorkflow", queueName: "q" }, ...)`
   - Polls workflow status: `client.getWorkflow(workflowID)` → `{ status, output, error }`
   - Returns workflow IDs to clients (202 ACCEPTED pattern)

2. **Worker (DBOS) side:**
   - Imports workflow modules via `DBOS.registerWorkflow()`
   - Calls `DBOS.registerQueue()` after `DBOS.launch()`
   - Processes enqueued workflows via Postgres-backed polling (`FOR UPDATE SKIP LOCKED`)

**Example (from dbos-agentic-platform):**
```typescript
// Server: Express endpoint enqueues via REST
app.post("/api/scan", async (req, res) => {
  const { repo, branch } = req.body;
  const workflowId = `scan-${repo.replace("/", "-")}-${Date.now()}`;
  
  await client.enqueue(
    { queueName: VULN_QUEUE_NAME, workflowName: SCAN_AND_FIX_WORKFLOW, workflowID: workflowId },
    repo, branch
  );
  
  res.status(202).json({ workflowId, status: "ENQUEUED", pollUrl: `/api/scan/${workflowId}` });
});

// Server: Status polling
app.get("/api/scan/:id", async (req, res) => {
  const wf = await client.getWorkflow(req.params.id);
  res.json({ workflowId: req.params.id, status: wf.status, result: wf.output });
});
```

**References:**
- `./dbos-agentic-platform/src/server.ts` (Express + DBOSClient pattern)
- `./dbos-agentic-platform/src/api/vulnRoutes.ts` (REST enqueue/status endpoints)
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/client-enqueue.md`
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/lifecycle-express.md`

**Confidence:** HIGH — This is the production pattern used in dbos-agentic-platform.

---

## 2. Event-Driven Workflow Resumption

### Finding: DBOS Provides Durable Messaging for Inter-Workflow Communication

**Communication primitives:**

DBOS v4 has three durable communication mechanisms:

1. **`DBOS.send()` / `DBOS.recv()`** — Topic-based messaging
   - Sender calls: `await DBOS.send(workflowID, message, "topic")`
   - Receiver calls: `const msg = await DBOS.recv<Type>("topic", timeoutSecs)`
   - **Reliability:** Exactly-once from workflows, idempotent from external code (via idempotency key)
   - **Durability:** All messages persisted in Postgres; survive process crashes

2. **`DBOS.setEvent()` / `DBOS.getEvent()`** — Key-value store per workflow
   - Workflow publishes: `await DBOS.setEvent("status", "processing")`
   - External code polls: `const status = await client.getEvent<string>(workflowID, "status", timeoutSecs)`
   - **Use case:** Real-time progress tracking, interactive workflows
   - **Durability:** All events persisted

3. **`DBOS.writeStream()` / `DBOS.readStream()`** — Append-only streams
   - Workflow pushes: `await DBOS.writeStream("results", value)`
   - External code reads: `for await (const v of client.readStream(workflowID, "results")) { ... }`
   - **Use case:** Streaming LLM output, progress reporting

**Example (from skill reference):**
```typescript
// Workflow pauses until webhook sends message
async function checkoutWorkflowFn() {
  const paymentStatus = await DBOS.recv<string>("payment_status", 120);
  if (paymentStatus === "paid") {
    await DBOS.runStep(fulfillOrder, { name: "fulfillOrder" });
  }
}

// Webhook handler resumes workflow
async function paymentWebhook(workflowID: string, status: string) {
  await DBOS.send(workflowID, status, "payment_status");
}
```

**Why this enables n8n integration:**
- n8n can send HTTP webhooks → DBOS API endpoint → `DBOS.send()` to resume a paused workflow
- DBOS workflows pause durably until notification arrives (even weeks)
- On crash/restart, DBOS replays to the exact pause point and waits again

**References:**
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/comm-events.md`
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/comm-messages.md`
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/comm-streaming.md`
- SDK README: "📫 Durable Notifications" section

**Confidence:** HIGH — Core DBOS v4 feature, fully documented.

---

## 3. Workflow Introspection & Status APIs

### Finding: Comprehensive REST API for Workflow Monitoring

**Introspection capabilities (programmatic via DBOSClient or DBOS.listWorkflows):**

```typescript
// List workflows by status
const erroredWorkflows = await DBOS.listWorkflows({
  workflowName: "processOrder",
  status: "ERROR",  // ENQUEUED, PENDING, SUCCESS, ERROR, CANCELLED, RETRIES_EXCEEDED
  limit: 100,
  sortDesc: true,
  loadOutput: true,  // Include result/output
});

// List enqueued workflows
const queued = await DBOS.listQueuedWorkflows({ queueName: "task_queue" });

// Inspect workflow steps
const steps = await DBOS.listWorkflowSteps(workflowID);
// Returns: { functionID, name, status, error, childWorkflowID, ... }

// Poll events from a workflow
const status = await client.getEvent<string>(workflowID, "status", 60);
```

**Exposed via HTTP in dbos-agentic-platform:**
```typescript
// GET /api/scan/:id → { status, result, error }
// GET /api/analyze/:id → { status, result, error }
```

**Real-time monitoring capability:**
- Poll workflow status at any interval
- Read step execution trace (success/failure/child workflows)
- Access event stream for progress
- List pending workflows in a queue

**Limitations:**
- No built-in subscription/webhook push model (must poll)
- Status is eventually consistent (polling loop latency)

**References:**
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/workflow-introspection.md`
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/client-setup.md` (client.listWorkflows, client.getEvent)

**Confidence:** HIGH — Fully available in v4.17.6.

---

## 4. Queue + Worker Architecture

### Finding: Clean Separation of Concerns; Suitable for External Triggering

**Architecture pattern:**

```
┌─────────────────────────────────────────────────────────────┐
│ External System (n8n, HTTP client, etc.)                    │
├─────────────────────────────────────────────────────────────┤
│           HTTP POST /api/trigger (REST)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────▼────────────┐
        │  Express Server         │
        │  (DBOSClient.enqueue)   │
        └────────────┬────────────┘
                     │
         ┌───────────▼────────────┐
         │ Postgres (system DB)   │
         │ Queue Table: _dbos_sys │
         └───────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │  DBOS Worker            │
        │  (DBOS.launch)          │
        │  (RegisterQueue)        │
        │  (RegisterWorkflow)     │
        └────────────┬────────────┘
                     │
                ┌────▼────┐
                │ Workflow │
                │ Execution│
                └──────────┘
```

**Key characteristics:**

1. **Server knows NOTHING about workflow code:**
   - Only enqueues by string name: `"analyzeYear"`, `"scanAndFix"`
   - No imports of workflow modules
   - Can be deployed independently

2. **Worker has complete workflow logic:**
   - Imports and registers all workflows at startup
   - Processes workflows from queue
   - DBOS system DB tables are the only IPC

3. **Scaling:**
   - Multiple servers can enqueue concurrently
   - Multiple workers can process concurrently (via queue concurrency limits)
   - No direct server-to-worker coupling

**Reference implementation (dbos-agentic-platform):**
- Server: `./src/server.ts` + `./src/api/*Routes.ts` (Express + DBOSClient only)
- Worker: `./src/worker.ts` (DBOS.launch + DBOS.registerQueue + registerWorkflow imports)

**References:**
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/queue-basics.md`
- `./research/dbos-distributed-workflows-2026-05-09.md` (Section 3-5: distributed patterns)

**Confidence:** HIGH — Production pattern validated.

---

## 5. DBOS Cloud / Hosted Offering

### Finding: DBOS Cloud Does NOT Yet Exist

**Current status:**
- DBOS is **open-source, self-hosted only**
- Requires Postgres (your own or managed, e.g., AWS RDS, Neon, Supabase)
- No SaaS offering or managed API gateway (as of May 2026)

**DBOS, Inc. roadmap:**
- Conductor (self-hosted fleet manager) is in development, not released
- Pricing & features explored in: `./research/dbos-conductor-pricing-2026-05-09.md`
- Conductor provides: multi-executor coordination, debugging, fleet management
- BUT: Conductor is **optional** — DBOS works without it (single-machine limitation)

**Implication for n8n hybrid:**
- You must self-host both DBOS (worker + system DB) and n8n
- No managed gateway to simplify HTTP triggering
- BUT: Easy to add Express layer as gateway (as shown in dbos-agentic-platform)

**References:**
- `./research/dbos-conductor-pricing-2026-05-09.md` (Section 1-3: pricing, feature matrix)
- DBOS GitHub: https://github.com/dbos-inc/dbos-transact-ts

**Confidence:** MEDIUM — Based on May 2026 research; may change by end of 2026.

---

## 6. Durability Guarantees

### Finding: Comprehensive Durability; All State in Postgres

**What is persisted:**
- ✅ **Workflow status** (ENQUEUED, PENDING, SUCCESS, ERROR)
- ✅ **Step outputs** (result of each DBOS.runStep)
- ✅ **Retry state** (attempt count, backoff schedule)
- ✅ **Events** (key-value store)
- ✅ **Messages** (topic-based queue)
- ✅ **Streams** (append-only log)
- ✅ **Schedules** (cron definitions)

**System database tables (in `<dbname>_dbos_sys` Postgres DB):**
- `workflow_executions` — workflow status, inputs, outputs
- `workflow_steps` — per-step execution trace
- `queue_entries` — enqueued workflows
- `events` — setEvent/getEvent key-value store
- `messages` — send/recv topic queues
- `streams` — writeStream/readStream append-only logs

**Recovery semantics:**
- On process crash, DBOS replays workflow from last checkpoint
- Checkpoints are created after each DBOS.runStep
- **Exactly-once semantics:** Steps are never re-executed; outputs are re-read from DB
- **Idempotency:** External callers can use `deduplicationID` on enqueue to prevent duplicate workflows

**Example durability flow:**
1. Workflow starts, runs step 1, persists output to `workflow_steps`
2. Process crashes
3. On restart, DBOS detects incomplete workflow, loads step 1 output from DB
4. Skips step 1, begins step 2
5. Continues until completion or next failure

**References:**
- `./research/dbos-distributed-workflows-2026-05-09.md` (Section 10: Postgres tables)
- SDK README: "🔄 Exactly-Once Event Processing"
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/step-basics.md`

**Confidence:** HIGH — Core feature, essential to DBOS.

---

## 7. DBOS Limitations & Poor-Fit Scenarios

### Finding: DBOS Is NOT Universal; Some Workflows Perform Poorly

**Poorly suited patterns:**

1. **Stateless request handlers**
   - DBOS adds durability overhead (Postgres writes per step)
   - Better to use plain Express for fast, idempotent HTTP handlers
   - Use DBOS only if you need crash recovery

2. **Real-time bidirectional communication**
   - DBOS workflows are checkpointed; can't stream state updates in real-time
   - Better to use WebSocket + polling events OR DBOS streams (which are append-only, not live updates)

3. **Microsecond-latency critical paths**
   - Each step writes to Postgres (10-100ms latency per step)
   - Not suitable for high-frequency trading, real-time game logic, etc.

4. **Complex fan-out without messages**
   - Starting 1000 child workflows and waiting sequentially is inefficient
   - Better to enqueue them all and process concurrently

5. **Long-running, memory-intensive workflows**
   - If a workflow runs for days without checkpoints, DBOS may keep workflow state in memory
   - Better to break into smaller workflows with messages

**When DBOS shines:**
- ✅ LLM chains (long-running, occasional pauses for inference)
- ✅ Scan/fix pipelines (deterministic + agentic steps mixed)
- ✅ Approval workflows (pause until human approves)
- ✅ Payment processing (wait for webhook)
- ✅ Data pipelines (with retries + notifications)

**References:**
- `./research/dbos-distributed-workflows-2026-05-09.md` (Section 8: platform topology)
- SDK README: "DBOS vs. Other Systems"
- DBOS docs: https://docs.dbos.dev/typescript/programming-guide

**Confidence:** MEDIUM-HIGH — Inferred from architecture; may be refined with production use.

---

## 8. DBOS + n8n Hybrid Architecture — Integration Points

### Finding: DBOS Can Be n8n's Backend; n8n Triggers DBOS via HTTP

**Proposed architecture:**

```
┌──────────────────────────────────────────────────────────┐
│ n8n (Visual Workflow Designer)                           │
│ - Schedule triggers, human approval, notifications       │
└──────────┬───────────────────────────────────────────────┘
           │ HTTP POST (REST)
    ┌──────▼──────────────────────────────────┐
    │ DBOS HTTP Gateway (Express)              │
    │ - POST /dbos/enqueue/:workflowName       │
    │ - GET  /dbos/workflow/:id/status         │
    │ - GET  /dbos/workflow/:id/events         │
    │ - POST /dbos/webhook/:id (recv)          │
    └──────┬───────────────────────────────────┘
           │ Postgres Queues
    ┌──────▼──────────────────────────────────┐
    │ DBOS Worker (TypeScript)                 │
    │ - LLM reasoning steps (agentic)          │
    │ - Deterministic processing steps         │
    │ - Retry + durability                     │
    └──────┬───────────────────────────────────┘
           │ Results → HTTP Callback to n8n
           │ (or n8n polls status periodically)
           └─────────────────────────────────→
```

**Integration pattern:**

1. **n8n initiates workflow (via HTTP):**
   ```
   POST /dbos/enqueue/vulnerabilityScan
   { "repo": "owner/name", "branch": "main" }
   → 202 { "workflowID": "scan-...", "pollUrl": "..." }
   ```

2. **n8n polls workflow status (async):**
   ```
   GET /dbos/workflow/scan-.../status
   → { "status": "PENDING" | "SUCCESS" | "ERROR", "result": {...} }
   ```

3. **DBOS pauses for approval (durable wait):**
   ```
   await DBOS.recv<string>("approval", 86400);  // Wait up to 1 day
   ```

4. **n8n sends approval via webhook:**
   ```
   POST /dbos/webhook/scan-.../approval
   { "approved": true, "reviewer": "bob" }
   → Resumes DBOS workflow via DBOS.send()
   ```

5. **DBOS publishes progress updates:**
   ```
   await DBOS.setEvent("progress", 50);
   await DBOS.writeStream("logs", "Finding blocker vulnerabilities...");
   ```

6. **n8n polls progress (optional):**
   ```
   GET /dbos/workflow/scan-.../events?key=progress
   GET /dbos/workflow/scan-.../stream/logs
   ```

**Benefits:**
- n8n handles: **scheduling, notifications, human-in-the-loop, retries (with backoff policies)**
- DBOS handles: **LLM reasoning chains, complex branching, durability, exactly-once**
- Clean separation: visual layer (n8n) vs. logic layer (DBOS)
- Each system does what it's best at

**Challenges:**
- Must implement n8n HTTP client (POST, GET, OAuth if needed)
- Status polling adds latency (can mitigate with streams/events)
- Webhook callback from n8n requires static URL + auth
- Workflow ID mapping between n8n + DBOS

**References:**
- Global objective in research prompt
- `./dbos-agentic-platform/` (reference implementation of HTTP gateway pattern)

**Confidence:** MEDIUM-HIGH — Architecture is sound; implementation is standard.

---

## 9. Key Limitations & Open Questions

### Unanswered or Partially Answered:

1. **Admin HTTP server:**
   - DBOS v4 includes optional Koa admin UI (`runAdminServer: true`, port 3001)
   - NOT suitable for production; can be disabled
   - No REST API for workflow management (create/delete/inspect)
   - You must build your own REST gateway (as shown in dbos-agentic-platform)

2. **Webhook push vs. poll:**
   - DBOS has NO built-in webhook PUSH (send events to external systems)
   - Must call external APIs manually from steps: `await DBOS.runStep(() => notifySlack(...))`
   - Or n8n polls for updates (higher latency)

3. **Scaling beyond single Postgres instance:**
   - DBOS Conductor (fleet manager) is not yet released
   - Without Conductor, multiple workers need same Postgres (no sharding)
   - Postgres can handle 100s of workers, but not 1000s

4. **Multi-database / multi-cloud:**
   - System DB must be shared Postgres
   - App DB can be separate
   - No federation across regions

5. **TypeScript-only:**
   - DBOS SDK is TypeScript/Node.js only
   - No Python, Go, Java bindings yet
   - n8n integration would require Node.js runtime

**References:**
- `./dbos-agentic-platform/.agents/skills/dbos-typescript/references/lifecycle-config.md` (config options)
- `./research/dbos-conductor-pricing-2026-05-09.md` (Conductor limitations)

---

## 10. Official DBOS Resources

**Primary Sources:**
- **DBOS TypeScript Skill** (in-workspace):
  - `./dbos-agentic-platform/.agents/skills/dbos-typescript/` (32 reference files)
  - Topics: client setup, enqueue, events, streams, queues, workflow introspection
- **GitHub:** https://github.com/dbos-inc/dbos-transact-ts
- **Official Docs:** https://docs.dbos.dev/
- **SDK NPM:** @dbos-inc/dbos-sdk@4.17.6

**Research in workspace:**
- `./research/dbos-distributed-workflows-2026-05-09.md` (executor, queue, distributed patterns)
- `./research/dbos-conductor-pricing-2026-05-09.md` (Conductor, fleet management, pricing)

---

## Conclusion

**DBOS v4 is a well-designed, production-ready headless execution engine** that is ideal as the backend for an n8n hybrid agentic platform. It provides:

✅ **HTTP Triggering:** Via Express + DBOSClient (standard REST enqueue/status)  
✅ **Event-Driven Resumption:** DBOS.send/recv for durable inter-system messaging  
✅ **Workflow Introspection:** Full status, steps, events, streams via REST API  
✅ **Clean Queue/Worker Architecture:** Server enqueues, worker executes; zero coupling  
✅ **Durability:** All state in Postgres; exactly-once execution; crash recovery  
✅ **LLM-Friendly:** Durable pauses, message handling, stream output for LLM chains  

⚠️ **Limitations:**  
- No SaaS/Cloud offering (self-hosted only)  
- No built-in admin HTTP APIs (you must build Express layer)  
- Polling-based status (no push webhooks yet)  
- TypeScript-only  

**For the n8n + DBOS hybrid:**  
1. Deploy DBOS worker (import workflows, register queues, launch)
2. Deploy Express gateway with DBOSClient (enqueue, status, webhook endpoints)
3. Configure n8n to HTTP POST to Express gateway
4. n8n polls workflow status or listens for streams/events
5. DBOS handles long-running agentic logic; n8n handles orchestration

**Next steps for implementation:**
- Build minimal Express gateway (similar to dbos-agentic-platform/src/)
- Define HTTP contract between n8n and gateway (POST /dbos/enqueue, GET /dbos/status)
- Implement webhook callback handler (POST /dbos/webhook/:id)
- Add stream/event polling endpoints if needed
- Test with sample n8n workflows

---

