# dbos-agentic-platform — Architecture Refactor Plan

**Date:** 2026-05-30
**Status:** Executed 2026-05-30 (typecheck + build green)
**Scope:** Restructure `dbos-agentic-platform/src` so the DBOS workflow is a first-class citizen, with a thin shared "platform" layer supporting easy authoring of future workflows.

### Implementation notes (deviations from the original sketch)

- Added `platform/llm.ts` — a `getChatModel()` factory so the provider/model choice
  lives in one place instead of being hard-coded in each agent step.
- Added `platform/types.ts` — a `WorkflowModule` contract (`name`, `queueName`,
  `buildRouter`, `register`). The server mounts routers; the worker calls `register()`
  (a lazy `require("./workflow")`) so the API server doesn't load heavy workflow code.
- Each workflow owns a `constants.ts` (workflow + queue names) instead of central config.
- `schema.sql` lives at `src/schema.sql`; `platform/db.ts` resolves it via
  `path.join(__dirname, "..", "schema.sql")`. Dockerfile copies it to `dist/src/schema.sql`.
- Steps split into `steps/`: `scan.ts`, `triage.ts`, `generateFix.ts`, `createPr.ts`,
  `persist.ts` (policy `countBlockers` + `writeScanResults`).

---

## North-star

The DBOS workflow is the headline of the codebase. Every other directory exists to make
authoring new workflows easy. A new workflow should be: *copy a folder, implement its steps,
register one line.* The API server and worker stay thin and never accumulate per-workflow code.

## Context

Today `src/` is organized **by technical layer** (`agent/`, `api/`, `db/`, `github/`,
`schemas/`, `workflows/`). To build or understand one workflow you touch ~6 directories, and
the workflow file is just one folder peer among equals — it is not first-class. Supporting
plumbing (db, github client, llm) is mixed with workflow-specific code with no signal about
what is reusable infra vs workflow-specific.

This plan was set after removing the sales-analysis PoC (see commit removing sales), leaving a
single workflow (`scanAndFix`) — the cheapest possible moment to restructure.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Long-term scope | **Multi-workflow platform** — vuln-fix is the first of several agentic workflows on a shared DBOS runtime |
| 2 | Co-location vs layering | **Vertical modules** — co-locate workflow + steps + agents + schemas + routes per workflow |
| 3 | Server / worker split | **Keep the split** — thin Express API (enqueue) + scalable DBOS worker (execute) |
| 4 | n8n hybrid invocation | **Deferred** — don't contort the design now; workflows stay HTTP/webhook-triggerable so n8n can drive them later if needed |
| 5 | Reusable steps library | **No** — keep steps private to each workflow until a second workflow genuinely needs one (avoid premature abstraction) |
| 6 | Shared layer name | **`platform/`** |
| 7 | DB schema ownership | **Per-workflow** — each module owns its `schema.sql` and declares `schemaPath`; `platform/db.ts` applies all declared schemas. (Originally deferred as "shared for now"; completed 2026-05-30.) |

## "Shared supporting layer" defined

Plumbing every workflow needs but no single workflow owns: Postgres pool/helpers, the generic
GitHub (Octokit) client, LLM model/config, and the DBOS bootstrap. These move into `platform/`.
Workflow-specific code (vuln agents, vuln schemas, the `FixCandidate`-aware PR builder, scan
steps) moves into the workflow module.

## Target structure

```
src/
  workflows/
    scan-and-fix/
      workflow.ts        # orchestration only (from workflows/scanAndFix.ts)
      steps/
        scan.ts          # cloneRepo + runTrivy + runScanners (inline today)
        triage.ts        # from agent/vulnTriageAgent.ts
        generateFix.ts   # from agent/vulnFixAgent.ts
        createPr.ts      # from github/prCreator.ts (workflow-specific PR logic)
        persist.ts       # writeScanResults (inline today)
      schemas.ts         # from schemas/vulnSchemas.ts
      routes.ts          # from api/vulnRoutes.ts
      README.md          # what it does, gates, state machine
    index.ts             # registry: workflows + queues + routers
  platform/
    config.ts            # shared config (db url, pool, model)
    db.ts                # from db/postgres.ts (pool, query, ensureSchema)
    github.ts            # from github/octokit.ts (generic client + parseRepo)
    llm.ts               # getModel() + AI SDK model factory
    dbos.ts              # DBOS bootstrap extracted from worker.ts
  server.ts              # thin: loops workflows/index.ts, mounts each routes.ts
  worker.ts              # thin: imports registry, registers workflows + queues
```

Each workflow module ships its own `schema.sql` (declared via `schemaPath`). The build copies
`.sql` assets into `dist/` (`tsc && copyfiles -u 1 "src/**/*.sql" dist/src`), so the Dockerfile
stays agnostic — it just copies `dist/`.

### File mapping (current → target)

| Current | Target |
|---------|--------|
| `src/workflows/scanAndFix.ts` | `src/workflows/scan-and-fix/workflow.ts` (+ extract inline `runScanners`/`writeScanResults` into `steps/`) |
| `src/agent/vulnTriageAgent.ts` | `src/workflows/scan-and-fix/steps/triage.ts` |
| `src/agent/vulnFixAgent.ts` | `src/workflows/scan-and-fix/steps/generateFix.ts` |
| `src/github/prCreator.ts` | `src/workflows/scan-and-fix/steps/createPr.ts` |
| `src/schemas/vulnSchemas.ts` | `src/workflows/scan-and-fix/schemas.ts` |
| `src/api/vulnRoutes.ts` | `src/workflows/scan-and-fix/routes.ts` |
| `src/db/postgres.ts` | `src/platform/db.ts` |
| `src/github/octokit.ts` | `src/platform/github.ts` |
| `src/config.ts` | `src/platform/config.ts` (+ `llm.ts` for model factory) |
| DBOS bootstrap in `src/worker.ts` | `src/platform/dbos.ts` |
| `src/db/schema.sql` | `src/schema.sql` (shared, unchanged) |

## Deferred (explicitly not now)

- Per-workflow `schema.sql` fragments + a migration runner that applies all of them (decision #7).
- A shared `steps/` library for reusable steps like `cloneRepo` / `createPr` (decision #5).
- n8n-as-orchestrator integration (decision #4).

## Follow-ups after the refactor (separate work)

These pre-existing gaps were identified during the architecture review and are tracked
separately from the move:

1. **Wire the fix→PR loop** — `generateFix` and `createFixPR` exist but are never called by the
   workflow; today it stops at scan→triage→persist.
2. **File-apply bug** — `createFixPR` writes `fixedCode` as the entire file blob; `fixedCode` is
   a snippet. Needs fetch + `originalCode`→`fixedCode` replacement, or a full-file schema.
3. **Enum mismatch** — triage emits `fixType: "code-change"`; fix candidate expects `"code-patch"`.
4. **Security guardrails (research §11)** — no CVE-description sanitization or suspicious-pattern
   AST check before opening PRs.
5. **Human approval gate** — `DBOS.recv()` keyed by PR id with timeout escalation (not implemented).

## Migration mechanics

Pure mechanical move: relocate files, rewrite import paths, extract the inline steps out of
`workflow.ts`, add `workflows/index.ts` registry, slim `server.ts`/`worker.ts` to read it.
Validate with `npm run typecheck` after the move.
