# dbos-agentic-platform

DBOS-orchestrated agentic workflows combining deterministic steps with LLM-powered agents.

**Stack:** Node.js · TypeScript · Express · DBOS SDK v4 · Vercel AI SDK · Postgres · Octokit

## Workflows

### Vulnerability Scan & Fix
Scan repo → policy check → LLM triage → LLM fix generation → GitHub PR creation.

## Architecture

```
                Express (server.ts)                    DBOS Worker (worker.ts)
                ───────────────────                    ────────────────────────
                POST /api/scan          ─── Postgres   scanAndFix workflow
                GET  /healthz               queues ──►
                                                       ┌─ deterministic steps (DB, CLI, API)
                DBOSClient.enqueue()                   └─ agentic steps (LLM + Zod schemas)
```

- **Server** knows zero workflow code — enqueues by string name via `DBOSClient`
- **Worker** owns all workflow/step definitions, polls Postgres queues
- **Postgres** holds both DBOS system state and business data (single database)
- **Agents** use `generateText` + Zod structured output for type-safe LLM responses

## Quick Start

```bash
# 1. Start Postgres
docker compose up postgres -d

# 2. Install deps
npm install

# 3. Configure
cp .env.example .env
# Edit .env: set GOOGLE_GENERATIVE_AI_API_KEY (required)
#            set GITHUB_TOKEN (optional — enables PR creation)
# The schema is applied automatically by the worker/server on boot.

# 4. Start worker + server (separate terminals)
npm run dev:worker
npm run dev:server
```

## API

```bash
# Vulnerability scan
curl -X POST http://localhost:3000/api/scan -H "Content-Type: application/json" \
  -d '{"repo": "owner/repo", "branch": "main"}'

curl http://localhost:3000/api/scan/<workflowId>
curl http://localhost:3000/api/findings/owner--repo

# Health check
curl http://localhost:3000/healthz
```

## Deployment (Docker / Droplet)

```bash
# Build and run all services
docker compose up --build -d

# Scale workers
docker compose up --scale worker=3 -d
```

The Dockerfile uses a multi-stage build (builder → production). Override the
default CMD for workers:

```yaml
# docker-compose.yml already handles this:
# app-server: node dist/src/server.js  (port 3000)
# worker:     node dist/src/worker.js  (no port)
```

## Project Layout

The DBOS workflow is the first-class citizen. Each workflow is a self-contained
vertical module under `workflows/<name>/`; `platform/` is the thin shared layer
that supports building workflows. Adding a workflow = create a folder + append it
to `workflows/index.ts`.

```
dbos-agentic-platform/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   ├── server.ts                 # thin: mounts each module's router (enqueues work)
│   ├── worker.ts                 # thin: registers each module's workflow + queue
│   ├── schema.sql                # shared business-data schema (split per-workflow later)
│   ├── platform/                 # shared supporting layer — plumbing every workflow uses
│   │   ├── config.ts             # infra config (db url, pool, model name)
│   │   ├── db.ts                 # pg Pool + query helpers + ensureSchema()
│   │   ├── github.ts             # GitHub (Octokit) client + parseRepo
│   │   ├── llm.ts                # chat-model factory (provider choice in one place)
│   │   ├── dbos.ts               # DBOS lifecycle: createDbosClient() / launchWorker()
│   │   └── types.ts              # WorkflowModule contract
│   └── workflows/
│       ├── index.ts              # registry: lists every workflow module
│       └── scan-and-fix/         # ⭐ a workflow module (vertical slice)
│           ├── workflow.ts       # orchestration only (scan → policy → triage → persist)
│           ├── steps/            # scan · triage · generateFix · createPr · persist
│           ├── schemas.ts        # Zod schemas for this workflow
│           ├── routes.ts         # /workflow/scan, /workflow/findings
│           ├── constants.ts      # workflow + queue names
│           ├── index.ts          # module descriptor (WorkflowModule)
│           └── README.md         # flow, steps, API, persistence
```
