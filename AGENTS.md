# Workspace Memory — AI Agent Workflow Explore

## Project Overview
**DBOS is our chosen workflow orchestration platform.** Evaluated DBOS vs Temporal — DBOS wins on simplicity (just TypeScript + Postgres, no separate orchestration server, no workflow DSL). Will only revisit Temporal if we hit actual scale limits.

Tech stack: Node.js / TypeScript, Express, DBOS SDK v4, Vercel AI SDK, Trivy, **Postgres only** (business data + DBOS system state in same DB, different tables).
Project lives in `dbos-agentic-platform/` (renamed from `poc-dbos-sales`).
Two workflows: `analyzeYear` (sales analysis) + `scanAndFix` (vulnerability scan → triage → persist).

### Why DBOS over Temporal
- **No infra to manage** — just Postgres. No Temporal Server, no Cassandra/MySQL backend.
- **Plain TypeScript** — `if/else`, `for` loops, `try/catch`. No workflow DSL, no "activities" concept.
- **Postgres-backed queues** — `FOR UPDATE SKIP LOCKED` = no message broker needed.
- **Retry/fallback as config** — `{ retriesAllowed: true, maxAttempts: 2 }` on any step.
- **Queue-worker split is clean** — server knows zero workflow code, just enqueues by string name.
- **Deterministic + agentic in same workflow** — scanner steps are deterministic, LLM steps are agentic, both are just `DBOS.runStep()`.
- **Cost** — Postgres is the only dependency. Temporal needs 3+ services minimum.

---

## Notes

### DBOS SDK Version
- Always use **v4.x** (`@dbos-inc/dbos-sdk@4.17.6` or later). v2 uses decorators (`@DBOS.workflow()`), v4 uses `DBOS.registerWorkflow()` + `DBOS.runStep()`. The official demo apps (`dbos-demo-apps`) are on v4. Do not mix versions.
- `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json` are only needed for v2 — remove them when on v4.

### DBOS Configuration (v4)
- `DBOS.setConfig()` takes `systemDatabaseUrl`, NOT `databaseUrl`. This changed between v2 and v4.
- `DBOSClient.create()` takes an object `{ systemDatabaseUrl }`, not a plain string.
- `dbos-config.yaml` is NOT automatically read at runtime in library mode — pass config explicitly via `DBOS.setConfig()` in code.
- DBOS creates its own system database (named `<appname>_dbos_sys`) separate from your app database. They are two different Postgres databases.

### DBOS Step Naming in Loops
- Steps inside loops MUST have unique names per iteration, otherwise DBOS cannot distinguish step outputs during replay.
- Pattern: `{ name: \`analyzeMonth-${month}\` }` — always include the loop variable in the name.

### DBOS Parallel Execution
- Use `Promise.allSettled` (NOT `Promise.all`) for parallel independent steps — `Promise.allSettled` handles errors gracefully.
- For parallel sequences (step A → step B in one branch, step C → step D in another), use child workflows via `DBOS.startWorkflow()` instead of nested `Promise.allSettled`.
- You cannot start/enqueue workflows from inside steps — only from workflow functions.

### DBOS Queue-Worker Pattern
- App server uses `DBOSClient` (no DBOS.launch) — enqueues by workflow name string only, zero workflow code imported.
- Worker uses `DBOS.launch()` + `DBOS.registerQueue()` — imports workflow modules (decorators/registerWorkflow run at import time, registering workflows).
- `DBOS.registerQueue()` must be called AFTER `DBOS.launch()`.
- Workflow definitions (code) live ONLY in the worker. The server only needs the string name.
- DBOS creates a `_dbos_sys` database for system state — check THIS database (not the app DB) for workflow_status, operation_outputs etc.

### DBOS Admin Server
- DBOS v2 starts a Koa admin server by default which crashes with `is-generator-function` error on Node 20+. Disable with `runAdminServer: false` in `DBOS.setConfig()`.
- In v4 this is no longer an issue.

### Docker & Postgres
- `docker exec -it <NAMES> psql -U <user> -d <db>` — the `NAMES` column from `docker ps` is the container name.
- Always end SQL queries with `;` in psql — without it, psql waits for more input silently.
- Use `\r` to reset the query buffer in psql if commands accumulate without a semicolon.
- `docker pull` can hang silently — retry or restart Docker Desktop if it hangs > 2 minutes.
- Directory deletion is not allowed via bash tool — only individual files via `delete_file` tool.

### Vercel AI SDK
- Package names: `ai` (core) + `@ai-sdk/openai` / `@ai-sdk/google` / `@ai-sdk/groq` (providers). "Vercel" does not appear in the import names.
- `generateObject()` + Zod schema = type-safe structured LLM output. This is the cleanest pattern for replacing mock agents.
- TS2589 "Type instantiation is excessively deep" error on `generateObject` — fix by casting: `(generateObject as any)({...})` and `return object as MyType` for type safety on return.
- Model env var must be loaded BEFORE the provider module reads it — ensure `dotenv.config()` runs first.
- Restarting the worker process is required when `.env` is updated — `tsx watch` does NOT reload env vars on file change.

### Google Gemini API
- `gemini-flash-latest` resolves to `gemini-3-flash` which has a **20 RPD** (requests per day) free tier limit — easy to exhaust during dev.
- `gemini-2.5-flash` is the correct model ID for Vercel AI SDK (NOT `gemini-2.5-flash-preview-04-17` — that format is rejected).
- Check quota at [ai.dev/rate-limit](https://ai.dev/rate-limit) — look at RPD column, not just RPM.
- The env var name for Vercel AI SDK Google provider is `GOOGLE_GENERATIVE_AI_API_KEY` (not `GOOGLE_API_KEY`).
- Always use `getModel()` (function) not `DEFAULT_MODEL` (constant) — env vars must be read at call time, not import time.

### Config / Environment Variables
- All config must come from `.env` — never hardcode defaults in `server.ts` / `worker.ts` / `postgres.ts`.
- Use a `required(key)` helper that throws early with a clear message if an env var is missing.
- DB URL, model, pool size — build lazily via functions in `config.ts` (called after `dotenv.config()`).
- Module-level constants (e.g., `export const DEFAULT_MODEL = process.env.X`) are evaluated at import time — may read before dotenv runs. Use functions instead.
- After changing `.env`, fully stop and restart the process — `tsx watch` does NOT hot-reload env vars.

### DBOS Versioning (app_version hash)
- DBOS computes an `application_version` hash from workflow source code. Any code change = new hash.
- Workers only recover workflows from their own app version. PENDING workflows from an older version will NOT be picked up by a new version worker automatically.
- After a code change during dev: old PENDING workflows stay stuck. Just enqueue a new workflow — don't try to rescue the old one.
- In production: use rolling deploys and drain old version before retiring it.

### DBOS Database Naming
- DBOS system DB is named `<PGDATABASE>_dbos_sys`. If you rename PGDATABASE, DBOS creates a new system DB.
- Business tables live in the same Postgres DB as the DBOS system schema (schema name: `dbos`).
- When starting fresh (new DB name), DBOS auto-runs migrations on first `DBOS.launch()` — you see `Running DBOS system database migrations...` in logs.
- Check tables with: `docker exec <container> psql -U dbos -d <dbname> -c "\dt dbos.*"`

### Multi-Workflow Pattern (confirmed in practice)
- One worker can register multiple queues and import multiple workflow modules — no architectural change needed.
- Each workflow registers itself via `DBOS.registerWorkflow()` at import time — just import the module in worker.ts.
- Server uses string names only — never imports workflow code.
- `npm audit --json` exits with code 1 when vulnerabilities are found — this is expected, not an error. Always catch and parse stdout.

### Git & Embedded Repos
- Cloning reference repos (e.g. `dbos-demo-apps`) inside the workspace creates an embedded git repo warning. Best practice: add to `.gitignore` with `echo "dbos-demo-apps/" >> .gitignore` and `git rm --cached dbos-demo-apps` if already staged.

### DBOS TypeScript Skill (Official Reference Docs)
- A full DBOS skill lives at `dbos-agentic-platform/.agents/skills/dbos-typescript/` — 32 reference files across 9 categories.
- Before writing any DBOS code, check the relevant reference: `references/lifecycle-config.md`, `references/workflow-determinism.md`, `references/queue-basics.md`, `references/client-setup.md` etc.
- This skill would have prevented most DBOS debugging iterations (config shape, registerQueue order, step naming rules).
- Read `AGENTS.md` inside the skill folder first for the full index.

### Research File Organisation
- Keep research in `/research` folder (flat, not nested).
- One file per research topic, named `<topic>-YYYY-MM-DD.md`.
- Append compact validated sections to existing files rather than creating new files for every exploration.
- Always validate claims against official docs before writing to research files — include doc URLs as citations.

### Plan Mode Restrictions
- `bash` is not available in plan mode — only readonly tools (`open_files`, `expand_code_chunks`, `grep`, `expand_folder`).
- File creation/editing tools are also blocked in plan mode.

### General Efficiency Notes
- When `.env` is missing a key and the process is already running, the fastest fix is to append the key to `.env` and restart the process — no code changes needed.
- Check `node_modules/<package>/package.json` for `"version"` to quickly compare installed vs expected SDK versions before debugging API shape mismatches.
- Use `npx tsc --noEmit` after every non-trivial code change to catch type errors before runtime.

---

## Deployment — Contabo VPS (vmi3308702)

**Server:** `62.171.183.99` · Ubuntu 24.04 · Docker 29 · Docker Compose v5  
**SSH key:** `~/.ssh/contabo_agentic` (alias: `contabo-agentic` in `~/.ssh/config`)  
**App directory on server:** `/opt/agentic-platform/`  
**App server port:** `3002` (mapped to container port 3000)

### Pattern (mirrors `my-portfolio`)
- `docker-compose.prod.yml` — production compose with `platform: linux/amd64`, `env_file: .env`
- `cloud/server-setup.sh` — one-time Nginx/Certbot/UFW setup
- `cloud/nginx/agents-mchouhan.conf` — proxy `agents.mchouhan.co.in` → `localhost:3002`
- `.github/workflows/deploy-agentic-docker.yml` — CI/CD: build → tar → scp → ssh load & up
- `.github/workflows/deploy-nginx.yml` — deploy all nginx configs in `cloud/nginx/**`

### GitHub Secrets required (repo: `m-chouhan/agentic-workflows-explore`)
| Secret | Value |
|---|---|
| `CLOUD_SSH_KEY` | contents of `~/.ssh/contabo_agentic` (private key) |
| `CLOUD_IP` | `62.171.183.99` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | your Gemini API key |
| `GOOGLE_MODEL` | `gemini-2.5-flash` (optional, has default) |
| `GITHUB_TOKEN` | GitHub PAT for PR creation (optional) |

### One-time server setup
```bash
# 1. Run setup script
scp dbos-agentic-platform/cloud/server-setup.sh root@62.171.183.99:/tmp/
ssh contabo-agentic "bash /tmp/server-setup.sh"

# 2. Deploy nginx config
scp dbos-agentic-platform/cloud/nginx/agents-mchouhan.conf root@62.171.183.99:/etc/nginx/sites-available/
ssh contabo-agentic "ln -sf /etc/nginx/sites-available/agents-mchouhan.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"
```

### Deploy manually (without CI)
```bash
cd dbos-agentic-platform
docker compose -f docker-compose.prod.yml build
docker save agentic-platform:latest -o agentic-platform.tar
tar -czf deploy.tar.gz agentic-platform.tar docker-compose.prod.yml
scp deploy.tar.gz root@62.171.183.99:~/
ssh contabo-agentic "cd ~ && tar -xzf deploy.tar.gz && docker load -i agentic-platform.tar && cp docker-compose.prod.yml /opt/agentic-platform/ && cd /opt/agentic-platform && docker compose -f docker-compose.prod.yml up -d"
```

### Health check
```bash
curl http://62.171.183.99:3002/healthz
```
