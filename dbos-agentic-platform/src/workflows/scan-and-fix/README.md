# scan-and-fix workflow

Scans a GitHub repo for vulnerabilities, triages them with an LLM, and persists
the results. (Fix generation + PR creation steps exist but are not yet wired
into the workflow — see the follow-ups in the architecture refactor plan.)

## Flow

```
scan (deterministic)  →  policy (deterministic)  →  triage (agentic)  →  persist (deterministic)
```

| Step | File | Kind | Notes |
|------|------|------|-------|
| scan | `steps/scan.ts` | deterministic | shallow git clone + Trivy fs scan, deduped findings |
| policy | `steps/persist.ts` (`countBlockers`) | deterministic | critical / CVSS ≥ 9.0 = blocker |
| triage | `steps/triage.ts` | agentic | LLM structured output; falls back to scanner severity on failure (2 retries) |
| persist | `steps/persist.ts` (`writeScanResults`) | deterministic | idempotent upsert on `workflow_id` |

Workflow orchestration + `WorkflowModule` descriptor live in `index.ts`.

Available-but-unwired steps: `steps/generateFix.ts` (LLM patch generation),
`steps/createPr.ts` (Git Trees API → atomic commit → draft PR).

## HTTP API (`routes.ts`)

```
POST /workflow/scan            { "repo": "owner/name", "branch": "main" }
GET  /workflow/scan/:id        poll status
GET  /workflow/findings/:repo  latest findings (repo as "owner--name")
```

## Identifiers (`constants.ts`)

- Workflow name: `scanAndFix`
- Queue: `vuln-queue` (override via `VULN_QUEUE_NAME`)

## Persistence

Tables `scan_results` and `fix_attempts` (see `src/schema.sql`).
