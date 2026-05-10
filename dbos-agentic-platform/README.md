# PoC #1 — DBOS Sales Insights Workflow (Queue-Worker Pattern)

End-to-end demo of the **"narrow agent + durable orchestrator"** pattern,
refactored into the proper **queue-worker architecture** — the app server and
worker are separate processes that only communicate through Postgres.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  App Server  (src/server.ts)                                    │
│  Express + DBOSClient                                           │
│  • NO workflow code — zero imports of @DBOS.workflow/@DBOS.step │
│  • Enqueues by string name only: "analyzeYear" → Postgres       │
│  • GET poll uses DBOSClient.retrieveWorkflow(id)                │
└────────────────────────┬────────────────────────────────────────┘
                         │ INSERT INTO dbos.workflow_status
                         │ (status=ENQUEUED, name="analyzeYear")
                         ▼
              ╔══════════════════════════╗
              ║  SHARED POSTGRES         ║
              ║  dbos.workflow_status    ║
              ║  dbos.operation_outputs  ║
              ╚══════════════════════════╝
                         ▲
                         │ polls every ~1s (FOR UPDATE SKIP LOCKED)
┌────────────────────────┴────────────────────────────────────────┐
│  Worker  (src/worker.ts)                                        │
│  DBOS.launch() — full executor                                  │
│  • Owns ALL @DBOS.workflow + @DBOS.step definitions             │
│  • Polls "analysis-queue", executes, checkpoints each step      │
│  • No HTTP server — purely background                           │
└─────────────────────────────────────────────────────────────────┘
                         │ reads/writes
                         ▼
              ╔══════════════════════════╗
              ║  SQLite  (sales.db)      ║
              ║  sales           (input) ║
              ║  sales_insights (output) ║
              ╚══════════════════════════╝
```

## What it does

```
POST /api/analyze { year }
  → App server enqueues "analyzeYear" via DBOSClient → Postgres

  Worker picks up within ~1s:
    step 1: readSalesData(year)     → SQLite SELECT
    step 2: aggregateSales(rows)    → byProduct / byRegion / byMonth
    step 3: runAnalysisAgent(data)  → mock LLM, structured JSON
    step 4: writeInsights(result)   → SQLite INSERT into sales_insights

GET  /api/analyze/:id     → poll workflow status / result
GET  /api/insights/:year  → read latest stored insight from SQLite
```

## Prerequisites

- Node.js 20+
- Docker (for Postgres — DBOS workflow state)
- Two terminal tabs (one for worker, one for server)

## Quick start

```bash
cd dbos-agentic-platform

# 1. Install deps
npm install

# 2. Start Postgres
docker compose up -d

# 3. Configure env
cp .env.example .env

# 4. Seed ~1 year of fake sales data into SQLite
npm run seed

# 5a. Terminal 1 — start the worker (DBOS executor)
npm run dev:worker

# 5b. Terminal 2 — start the app server (Express)
npm run dev:server
```

## Try it

```bash
# Trigger analysis (app server enqueues, worker executes)
curl -X POST http://localhost:3000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"year": 2025}'
# → { workflowId, status: "ENQUEUED", pollUrl }

# Poll (worker updates status in Postgres; app server reads it)
curl http://localhost:3000/api/analyze/<workflowId>

# Read stored insight from SQLite
curl http://localhost:3000/api/insights/2025
```

## Inspect Postgres workflow state

```bash
# Connect to the DBOS system DB (separate from app DB)
docker exec poc-dbos-postgres psql -U dbos -d dbos_sales_dbos_sys

# Workflow status
SELECT workflow_uuid, status, name, executor_id, created_at
FROM dbos.workflow_status
ORDER BY created_at DESC LIMIT 10;

# Step checkpoints (filled in by worker as each step completes)
SELECT workflow_uuid, function_id, LEFT(output::text, 80) as output
FROM dbos.operation_outputs
ORDER BY workflow_uuid, function_id;
```

## Demonstrating durability (crash + recovery)

1. In `src/workflows/analyzeSales.ts`, add `process.exit(1)` after step 2.
2. `tsx watch` auto-reloads the worker.
3. `POST /api/analyze` — worker runs steps 1 & 2, then crashes.
4. Remove `process.exit(1)` — worker restarts.
5. DBOS replays: steps 1 & 2 are **skipped** (checkpointed), step 3 runs.

## Layout

```
dbos-agentic-platform/
├── docker-compose.yml          # Postgres + (optional) worker + app-server services
├── package.json                # dev:worker / dev:server scripts
├── scripts/
│   └── seed-sales.ts           # ~1 year of fake sales → SQLite
└── src/
    ├── server.ts               # ← App server: Express + DBOSClient ONLY
    ├── worker.ts               # ← Worker: DBOS.launch() + workflow registration
    ├── db/
    │   ├── schema.sql          # sales + sales_insights tables
    │   └── sqlite.ts           # better-sqlite3 connection
    ├── workflows/
    │   └── analyzeSales.ts     # @DBOS.workflow + 4 @DBOS.step methods
    ├── agent/
    │   └── mockAgent.ts        # deterministic mock agent (swap for real LLM)
    └── api/
        └── routes.ts           # Express router (uses DBOSClient, no workflow imports)
```

## Mapping to research recommendations

| Research recommendation              | Where in this PoC                                     |
| ------------------------------------ | ----------------------------------------------------- |
| Durable orchestrator (DBOS)          | `src/worker.ts` + `src/workflows/analyzeSales.ts`     |
| Narrow agent w/ structured I/O       | `src/agent/mockAgent.ts` + Zod schemas                |
| Queue-worker separation              | `src/server.ts` (DBOSClient) vs `src/worker.ts` (DBOS)|
| Workflow definitions in worker only  | `src/worker.ts` imports workflows; server does NOT    |
| Postgres as coordination plane       | `docker-compose.yml` → shared system DB               |
| Step idempotency                     | `writeInsights` uses `ON CONFLICT DO UPDATE`          |

## Next steps

- Replace `mockAgent` with a real LLM (OpenAI Agents SDK).
- Add Langfuse tracing around the agent step.
- Build **PoC #2 (Temporal)** for apples-to-apples comparison.
- Scale workers: `docker compose --profile full up --scale worker=3`.
