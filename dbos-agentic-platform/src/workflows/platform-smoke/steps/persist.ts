import { query } from "../../../platform/db";

/** Upsert the single smoke-run row. Idempotent on workflow_id. */
export async function writeSmokeRun(
  workflowId: string,
  repo: string,
  prId: number | null,
  prState: string,
): Promise<void> {
  await query(
    `INSERT INTO platform_smoke_runs (workflow_id, repo, pr_id, pr_state, checked_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workflow_id) DO UPDATE SET
       repo       = EXCLUDED.repo,
       pr_id      = EXCLUDED.pr_id,
       pr_state   = EXCLUDED.pr_state,
       checked_at = EXCLUDED.checked_at`,
    [workflowId, repo, prId, prState, new Date().toISOString()],
  );
}
