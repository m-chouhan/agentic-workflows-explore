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

```
dbos-agentic-platform/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   ├── config.ts                 # Shared constants (queues, model, pool size)
│   ├── server.ts                 # Express + DBOSClient (enqueues work)
│   ├── worker.ts                 # DBOS.launch() (executes work)
│   ├── api/
│   │   └── vulnRoutes.ts         # /api/scan, /api/findings
│   ├── agent/
│   │   ├── vulnTriageAgent.ts    # Gemini → prioritised vuln triage
│   │   └── vulnFixAgent.ts       # Gemini → code/version fix patches
│   ├── db/
│   │   ├── postgres.ts           # pg Pool singleton + query helpers
│   │   └── schema.sql            # Vulnerability tables
│   ├── github/
│   │   ├── octokit.ts            # GitHub client (PAT / App auth)
│   │   └── prCreator.ts          # Git Trees API → atomic commit → draft PR
│   ├── schemas/
│   │   └── vulnSchemas.ts        # Zod schemas (ScanFinding, TriageResult, FixCandidate)
│   └── workflows/
│       └── scanAndFix.ts         # scan → triage → fix → PR → persist
```
