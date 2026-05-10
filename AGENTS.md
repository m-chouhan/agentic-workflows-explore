# Workspace Memory — AI Agent Workflow Explore

## Project Overview
Exploring agentic workflow orchestration using DBOS (PoC #1) and Temporal (PoC #2 planned).
Tech stack: Node.js / TypeScript, Express, DBOS SDK v4, Vercel AI SDK, SQLite (business data), Postgres (DBOS system state).

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
- `gemini-2.0-flash` may show quota 0 on new accounts — try `gemini-flash-latest` or `gemini-1.5-flash` instead.
- `gemini-flash-latest` resolves to the latest Gemini flash model (currently `gemini-3-flash-preview`) and tends to have quota available.
- The env var name for Vercel AI SDK Google provider is `GOOGLE_GENERATIVE_AI_API_KEY` (not `GOOGLE_API_KEY`).

### Git & Embedded Repos
- Cloning reference repos (e.g. `dbos-demo-apps`) inside the workspace creates an embedded git repo warning. Best practice: add to `.gitignore` with `echo "dbos-demo-apps/" >> .gitignore` and `git rm --cached dbos-demo-apps` if already staged.

### DBOS TypeScript Skill (Official Reference Docs)
- A full DBOS skill lives at `poc-dbos-sales/.agents/skills/dbos-typescript/` — 32 reference files across 9 categories.
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
