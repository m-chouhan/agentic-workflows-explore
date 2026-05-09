# PoC #1 — DBOS Sales Insights Workflow

End-to-end demo of the **"narrow agent + durable orchestrator"** pattern from
the agentic-workflow-platform research, using **DBOS** as the durable
orchestrator.

## What it does

```
POST /api/analyze   ──► DBOS workflow ──► step1: read sales (SQLite)
                                     ──► step2: aggregate rows
                                     ──► step3: mock analysis agent
                                     ──► step4: write insights (SQLite)
                                     ──► returns workflow id

GET  /api/analyze/:id     poll workflow status / result
GET  /api/insights/:year  read latest stored insight directly from SQLite
```

DBOS persists each step's output to **Postgres**. If the Node.js process
crashes mid-workflow, DBOS replays from the last completed step on restart.
Business data lives in **SQLite** (`./data/sales.db`).

The "agent" is a deterministic mock so the PoC has no LLM / network
dependency; swap `src/agent/mockAgent.ts` for a real LLM call later, keeping
the same `AnalysisResult` schema.

## Prerequisites

- Node.js 20+
- Docker (for the Postgres container that backs DBOS state)

## Quick start

```bash
cd poc-dbos-sales

# 1. Install
npm install

# 2. Start Postgres for DBOS
docker compose up -d

# 3. Configure env
cp .env.example .env
# (defaults match docker-compose.yml; tweak if needed)

# 4. Seed ~1 year of fake sales data into SQLite
npm run seed

# 5. Run the API + DBOS executor in dev mode
npm run dev
```

## Try it

```bash
# Trigger an analysis for 2025
curl -X POST http://localhost:3000/api/analyze \
  -H 'content-type: application/json' \
  -d '{"year": 2025}'
# → { "workflowId": "analyze-2025-...", "status": "PENDING", "pollUrl": "..." }

# Poll for the result
curl http://localhost:3000/api/analyze/analyze-2025-XXXXXXXXXXXXX

# Or read the latest stored insight directly from SQLite
curl http://localhost:3000/api/insights/2025
```

## Demonstrating durability

1. Add a `console.log("about to crash")` + `process.exit(1)` inside any step
   (e.g. `runAnalysisAgent`).
2. Trigger the workflow with `POST /api/analyze`.
3. The process dies after the earlier steps have already completed.
4. Restart `npm run dev`. DBOS replays the workflow, **skipping the steps it
   already persisted**, and runs the failed step again. Remove the crash and
   restart to see it complete.

You can inspect workflow state directly in Postgres:

```bash
docker exec -it poc-dbos-postgres \
  psql -U dbos -d dbos_sales -c "SELECT workflow_uuid, status, name FROM dbos.workflow_status ORDER BY created_at DESC LIMIT 10;"
```

## Layout

```
poc-dbos-sales/
├── docker-compose.yml          # Postgres for DBOS state
├── dbos-config.yaml            # DBOS connection config
├── package.json
├── tsconfig.json
├── scripts/
│   └── seed-sales.ts           # ~1 year of fake sales → SQLite
└── src/
    ├── index.ts                # Express + DBOS launch
    ├── db/
    │   ├── schema.sql          # sales + sales_insights tables
    │   └── sqlite.ts           # better-sqlite3 connection
    ├── workflows/
    │   └── analyzeSales.ts     # @DBOS.workflow + 4 @DBOS.step methods
    ├── agent/
    │   └── mockAgent.ts        # deterministic stand-in for an LLM agent
    └── api/
        └── routes.ts           # Express router
```

## Where this maps to the research

| Research recommendation              | Where in this PoC                                   |
| ------------------------------------ | --------------------------------------------------- |
| Durable orchestrator (DBOS option)   | `src/workflows/analyzeSales.ts` (`@DBOS.workflow`)  |
| Narrow agent w/ structured I/O       | `src/agent/mockAgent.ts` + Zod schemas              |
| Utility services / DB access as steps| Read & write are `@DBOS.step` methods               |
| Workflow state in Postgres           | `docker-compose.yml` + `dbos-config.yaml`           |
| Trigger via web API                  | `src/api/routes.ts` (Express)                       |

## Next steps (out of scope for this PoC)

- Replace `mockAgent` with a real LLM (OpenAI Agents SDK / Pydantic-AI port).
- Add Langfuse tracing around the agent call.
- Build the parallel **PoC #2 (Temporal)** for an apples-to-apples comparison.
- Helm-deploy on K8s with multi-tenant namespacing.
