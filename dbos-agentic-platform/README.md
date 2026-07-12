# AgentFlow

> Controls the flow of multi-agent workflows.

A platform to quickly build, deploy, and orchestrate agentic (and deterministic)
workflows that automate mundane daily tasks. Each workflow is a self-contained,
pluggable module — contributors add a folder, register it, and ship. DBOS provides
durable execution (retries, crash recovery, queues) so contributors focus on the
workflow logic, not the plumbing.

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

## Environment config

The app reads a **single `.env` file** — it has no knowledge of `.env.local`/`.env.stg`/
`.env.prod`. Selecting an environment is an ops step: keep per-environment files
(gitignored) and copy the one you want into place before starting.

```bash
cp .env.example .env      # then fill in real secrets
# or, if you keep a self-contained local file:
cp .env.local  .env       # cp .env.stg .env / cp .env.prod .env for other envs
```

Required: `GOOGLE_GENERATIVE_AI_API_KEY` · `BITBUCKET_TOKEN` (for Bitbucket workflows).
Optional: `GITHUB_TOKEN` (enables PR creation; needs `repo` scope). The worker fails
loudly if a required key is missing.

## Quick Start (Docker)

```bash
cp .env.example .env       # fill in keys (see Environment config above)

# Start the stack (builds image on first run)
docker compose up --build -d

# Follow logs / stop / full reset (wipes DB volume)
docker compose logs -f
docker compose down
docker compose down -v
```

Schema is applied automatically on boot. API is available at `http://localhost:3002`.

## Quick Start (local dev without Docker)

```bash
npm install
cp .env.example .env       # fill in keys

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
