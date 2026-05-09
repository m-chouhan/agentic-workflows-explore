# DBOS Conductor — Pricing, Features & Distributed-Without-Conductor Viability

**Date:** 2026-05-09
**Context:** Addendum to agentic-workflow-platform research. Answering: is Conductor paid/free, and is it a must-have for self-hosted K8s production?

---

## Executive Summary

**DBOS Conductor is NOT required but strongly recommended for production K8s.** The core DBOS Transact library is fully open-source and free — it handles workflow durability and queue-based distributed work pickup without Conductor. However, Conductor adds automatic cross-pod crash recovery, real-time dashboard, alerting, and one-click workflow control. Without it, these must be implemented manually via Postgres queries and scripts. **Conductor is closed-source SaaS with a free dev tier (1-executor limit) and paid tiers for production (pricing on request). A self-hosted on-prem option exists but requires a paid license.**

**Key bullets:**
- DBOS Transact library = free, OSS, Apache 2.0 — runs anywhere, no Conductor needed
- Conductor = closed-source SaaS (hosted) or Docker container (self-hosted, paid license)
- Free license key available — but limited to 1 executor (dev/hobby only)
- Production self-hosted = paid license (contact sales for pricing)
- **Conductor is NOT on the critical path** — if connectivity drops, workflows keep running
- Without Conductor: workflows stuck on dead pods stay PENDING forever (no auto-reassignment)
- Time-Travel Debugger = fully local, NO Conductor required

---

## 1. Pricing Breakdown

| Tier | Cost | What you get |
|---|---|---|
| **DBOS Transact (library)** | Free / Apache 2.0 | Durable workflows, queues, scheduling, step retries — no Conductor |
| **Conductor (free license)** | Free | Self-host Docker container, **max 1 executor** — dev/hobby only |
| **DBOS Pro** | ~$100/mo (≈ $600/6mo free for startups) | Hosted Conductor, support, SLAs |
| **DBOS Teams** | Custom (contact sales) | Hosted Conductor + metadata-only mode + technical account mgmt |
| **Self-hosted Conductor (prod)** | Custom (contact sales) | Paid license, on-prem/K8s, air-gap support |

**Bottom line:** If you want Conductor for production distributed K8s, you need either the hosted plan or a paid self-hosted license. There is no free production-grade Conductor path.

---

## 2. What Conductor Adds (Feature Matrix)

| Feature | Without Conductor | With Conductor |
|---|---|---|
| Durable workflow execution | ✅ Full | ✅ Full |
| Same-pod crash recovery | ✅ Auto on restart | ✅ Auto |
| **Cross-pod crash recovery** | ❌ Manual | ✅ Automatic (dead executor detected, work reassigned) |
| Workflow dashboard / UI | ❌ Raw Postgres queries | ✅ Real-time UI |
| Cancel / pause / resume workflows | ❌ Manual SQL | ✅ One-click |
| Restart workflow from specific step | ❌ Manual script | ✅ One-click |
| Alerting on failure | ❌ DIY | ✅ Built-in |
| Queue metrics | ❌ SQL only | ✅ Dashboard |
| Executor discovery | ❌ Manual (you set executor_id) | ✅ Automatic |
| Workflow retention policies | ❌ Manual | ✅ Managed |
| Metadata-only mode (sensitive data) | N/A | ✅ Teams plan only |
| Time-Travel Debugger | ✅ Fully local (no Conductor) | ✅ Also works with Cloud |
| Air-gap operation | ✅ (library is offline) | ✅ (self-hosted Conductor) |

---

## 3. Running Without Conductor in K8s — Scenario Analysis

### The core issue: executor_id scoping

Every workflow is tagged with the `executor_id` of the pod that started it. Without Conductor:
- DBOS only auto-recovers PENDING workflows whose `executor_id` matches the **currently starting process**
- If that pod is gone (node failure, scale-down), those workflows stay PENDING forever

```
Pod A (executor_id=worker-abc) starts workflow-123
Pod A crashes → K8s restarts it as Pod B (executor_id=worker-xyz)
                                          ↑ different ID!
workflow-123 stays PENDING indefinitely — nobody recovers it
```

### Scenarios

| Scenario | Without Conductor | Fix |
|---|---|---|
| Container crash, same pod restarts | ✅ Auto-recovers (same pod name → same executor_id) | Use StatefulSet or stable pod names |
| Rolling deployment (new pod name) | ⚠️ New pod won't recover old pod's workflows | Drain before rolling |
| Node failure (pod permanently deleted) | ❌ Workflows stuck PENDING | Manual script or Conductor |
| Scale-down / eviction | ❌ Workflows stuck PENDING | Manual script or Conductor |

### The stable executor_id trick (K8s StatefulSet)

If you use a **StatefulSet** instead of a Deployment, pod names are stable (`worker-0`, `worker-1`):
```yaml
# StatefulSet pod names are stable across restarts
metadata:
  name: worker  # pods: worker-0, worker-1, worker-2
```
Set in your worker:
```bash
DBOS_EXECUTOR_ID: $(POD_NAME)  # e.g. "worker-0" — stable across restarts
```
Now if `worker-0` crashes and K8s restarts it as `worker-0` again → same executor_id → auto-recovery works ✅

This covers **container crash** and **rolling restart** scenarios.
It does NOT cover **node failure** where the pod is permanently deleted and rescheduled on another node with a new name.

### Workaround for cross-pod recovery (no Conductor)

Build a lightweight recovery cron job / daemon:
```sql
-- Find orphaned PENDING workflows (executor not in active set)
SELECT workflow_id, executor_id, name, created_at
FROM dbos.workflow_status
WHERE status = 'PENDING'
  AND executor_id NOT IN (SELECT executor_id FROM <active_executors_table>)
  AND created_at < NOW() - INTERVAL '2 minutes';
```
Then use `DBOSClient` to re-enqueue or trigger recovery:
```typescript
// Programmatically recover orphaned workflows
const client = await DBOSClient.create(databaseUrl);
// List stuck workflows and reassign via re-enqueue with same workflowID
```

This is DIY Conductor. Viable for small clusters; becomes operationally expensive at scale.

---

## 4. Conductor Connectivity

```
K8s Worker Pods ──── outbound WebSocket ────► Conductor (cloud or self-hosted)
                      (port 443, HTTPS/WSS)

- Direction: OUTBOUND ONLY from pods → no inbound firewall rules needed
- Critical path: NO — if WebSocket drops, workflows keep running normally
- Recovery resumes automatically when connection is restored
- For air-gap: deploy self-hosted Conductor within same network (paid license)
```

**Conductor is NOT on your critical path.** It is a management plane, not a data plane.

---

## 5. Time-Travel Debugger — No Conductor Required

The VS Code DBOS Debugger extension works with your **local or on-prem Postgres** directly:
- Points to `DBOS_SYSTEM_DATABASE_URL` (your `_dbos_sys` database)
- Replays any workflow execution locally with breakpoints
- Can modify code and replay as-if the new code had run in the past
- **Fully self-hostable — Conductor NOT required**
- Download: VS Code marketplace → "DBOS Debugger"

---

## 6. Ops Without Conductor — Practical Stack

For self-hosted K8s without Conductor, use:

```
┌─────────────────────────────────────────────────────────────┐
│ Observability (replaces Conductor dashboard)                 │
│                                                              │
│  Grafana dashboard ──► queries dbos.workflow_status          │
│  Prometheus ──────────► custom exporter (workflow counts)    │
│  Alertmanager ────────► alerts on ERROR/stuck PENDING count  │
│  Loki ────────────────► worker/server logs                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Recovery (replaces Conductor cross-pod recovery)             │
│                                                              │
│  StatefulSet ─────────► stable executor_id per pod          │
│  Recovery CronJob ────► scan PENDING orphans every 60s       │
│                          re-enqueue via DBOSClient           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Debugging (same as with Conductor)                           │
│                                                              │
│  VS Code DBOS Debugger ► time-travel replay (local Postgres) │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Decision Guide

```
Do you need cross-pod auto-recovery?
  (node failures, pod evictions, permanent deletions)
          │
     YES  │  NO
          │
          ├── YES → Use Conductor
          │         (hosted or self-hosted paid license)
          │
          └── NO → Can you tolerate manual recovery scripts + StatefulSet?
                        │
                   YES  │  NO
                        │
                        ├── YES → Run without Conductor
                        │         (StatefulSet + recovery cron + Grafana)
                        │
                        └── NO → Use Conductor
```

**For your platform (self-hosted K8s, algo trading use case):**
- Trading risk calc = mission-critical, low RTO → **Conductor recommended**
- Report generation = can tolerate delayed recovery → **without Conductor acceptable**
- Voice agents = short-lived workflows → **without Conductor fine**

**Pragmatic path:** Start without Conductor (PoC + early prod). Add Conductor when you hit the first node failure in prod and realise manual recovery is painful. Enterprise license with self-hosted Conductor becomes the end state for a regulated trading environment.

---

## References

| Resource | URL |
|---|---|
| Conductor docs | https://docs.dbos.dev/production/conductor |
| Workflow recovery | https://docs.dbos.dev/production/workflow-recovery |
| Self-hosting Conductor | https://docs.dbos.dev/production/hosting-conductor |
| K8s hosting | https://docs.dbos.dev/production/hosting-with-kubernetes |
| System tables | https://docs.dbos.dev/explanations/system-tables |
| Pricing | https://www.dbos.dev/dbos-pricing |
| Conductor license | https://www.dbos.dev/conductor-license |
| Time-Travel Debugger | https://docs.dbos.dev/typescript/tutorials/debugging |
| Conductor blog post | https://www.dbos.dev/blog/introducing-dbos-conductor |
