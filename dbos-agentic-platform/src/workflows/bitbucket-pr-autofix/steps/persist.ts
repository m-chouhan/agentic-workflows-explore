import { query } from "../../../platform/db";
import type { Retrigger } from "../schemas";

/** Upsert the autofix run. Idempotent on workflow_id. */
export async function writeAutofixRun(
  workflowId: string,
  repo: string,
  totalFailing: number,
  triggered: number,
  retriggers: Retrigger[],
): Promise<void> {
  await query(
    `INSERT INTO pr_autofix_runs
       (workflow_id, repo, triggered_at, total_failing, triggered, retriggers_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed')
     ON CONFLICT (workflow_id) DO UPDATE SET
       triggered_at    = EXCLUDED.triggered_at,
       total_failing   = EXCLUDED.total_failing,
       triggered       = EXCLUDED.triggered,
       retriggers_json = EXCLUDED.retriggers_json,
       status          = EXCLUDED.status`,
    [workflowId, repo, new Date().toISOString(), totalFailing, triggered, JSON.stringify(retriggers)],
  );
}
