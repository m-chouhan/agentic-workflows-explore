import { query } from "../../../platform/db";
import type { PrWithBuild } from "../schemas";

/** Upsert a PR-status run (idempotent on workflow_id). */
export async function writePrStatus(
  workflowId: string,
  repo: string,
  prs: PrWithBuild[],
  failedCount: number,
  status: string,
): Promise<void> {
  await query(
    `INSERT INTO pr_status_runs
       (workflow_id, repo, checked_at, total_prs, failed_count, prs_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(workflow_id) DO UPDATE SET
       checked_at   = EXCLUDED.checked_at,
       total_prs    = EXCLUDED.total_prs,
       failed_count = EXCLUDED.failed_count,
       prs_json     = EXCLUDED.prs_json,
       status       = EXCLUDED.status`,
    [
      workflowId, repo, new Date().toISOString(),
      prs.length, failedCount,
      JSON.stringify(prs),
      status,
    ],
  );
}
