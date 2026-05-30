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

## Quick Start (Docker)

```bash
# 1. Configure — copy the example and set your keys
cp .env.local.example .env.local
# Required: GOOGLE_GENERATIVE_AI_API_KEY  (https://aistudio.google.com/app/apikey)
# Optional: GITHUB_TOKEN                  (enables PR creation; needs 'repo' scope)

# ⚠ Make sure the key is set before starting — the worker will fail loudly otherwise.

# 2. Start the stack (builds image on first run)
docker compose --env-file .env.local up --build -d

# Follow logs
docker compose --env-file .env.local logs -f

# Stop
docker compose --env-file .env.local down

# Full reset (wipes DB volume)
docker compose --env-file .env.local down -v
```

Schema is applied automatically on boot. API is available at `http://localhost:3002`.

## Quick Start (local dev without Docker)

```bash
npm install
cp .env.local.example .env.local   # fill in keys

# Run Postgres only via Docker
docker compose up postgres -d

# Start worker + server in separate terminals
npm run dev:worker
npm run dev:server
```

API available at `http://localhost:3000` (no Docker port mapping in this mode).

## API

```bash
# Trigger a scan
curl -X POST http://localhost:3002/workflow/scan \
  -H "Content-Type: application/json" \
  -d '{"repo": "owner/repo", "branch": "main"}'

# Poll status
curl http://localhost:3002/workflow/scan/<workflowId>

# Get persisted findings (repo with -- instead of /)
curl http://localhost:3002/workflow/findings/owner--repo

# Health check
curl http://localhost:3002/healthz
```

## Deployment (prod / Contabo)

CI builds the image and deploys via `docker-compose.prod.yml`. To deploy manually:

```bash
docker compose -f docker-compose.prod.yml up -d

# Scale workers
docker compose -f docker-compose.prod.yml up --scale worker=3 -d
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
│           ├── index.ts          # workflow orchestration + WorkflowModule descriptor
│           ├── steps/            # scan · triage · generateFix · createPr · persist
│           ├── schema.sql        # tables owned by this workflow
│           ├── schemas.ts        # Zod schemas for this workflow
│           ├── routes.ts         # /workflow/scan, /workflow/findings
│           ├── constants.ts      # workflow + queue names
│           └── README.md         # flow, steps, API, persistence
```
