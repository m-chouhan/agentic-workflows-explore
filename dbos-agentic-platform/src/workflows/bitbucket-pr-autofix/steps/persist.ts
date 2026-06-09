import { query } from "../../../platform/db";
import type { AutofixAttempt } from "../schemas";

/** Upsert the top-level run row. Idempotent on workflow_id. */
export async function upsertAutofixRun(args: {
  workflowId: string;
  repo: string;
  source: "discover" | "reuse";
  statusWorkflowId: string | null;
  totalFailing: number;
  attempted: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  skipped: number;
  status: "running" | "completed" | "failed";
  finishedAt: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO pr_autofix_runs
       (workflow_id, repo, source, status_workflow_id,
        started_at, finished_at,
        total_failing, attempted, succeeded, failed, timed_out, skipped, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (workflow_id) DO UPDATE SET
       repo               = EXCLUDED.repo,
       source             = EXCLUDED.source,
       status_workflow_id = EXCLUDED.status_workflow_id,
       finished_at        = EXCLUDED.finished_at,
       total_failing      = EXCLUDED.total_failing,
       attempted          = EXCLUDED.attempted,
       succeeded          = EXCLUDED.succeeded,
       failed             = EXCLUDED.failed,
       timed_out          = EXCLUDED.timed_out,
       skipped            = EXCLUDED.skipped,
       status             = EXCLUDED.status`,
    [
      args.workflowId, args.repo, args.source, args.statusWorkflowId,
      new Date().toISOString(), args.finishedAt,
      args.totalFailing, args.attempted, args.succeeded, args.failed,
      args.timedOut, args.skipped, args.status,
    ],
  );
}

/** Upsert a single PR attempt row. Idempotent on (workflow_id, pr_id). */
export async function upsertAutofixAttempt(
  workflowId: string,
  attempt: AutofixAttempt,
  finishedAt: string | null,
): Promise<void> {
  await query(
    `INSERT INTO pr_autofix_attempts
       (workflow_id, pr_id, pr_url, source_branch, action,
        pipeline_uuid, pipeline_url, initial_state, final_state,
        poll_count, outcome, error_message, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (workflow_id, pr_id) DO UPDATE SET
       pipeline_uuid = EXCLUDED.pipeline_uuid,
       pipeline_url  = EXCLUDED.pipeline_url,
       initial_state = EXCLUDED.initial_state,
       final_state   = EXCLUDED.final_state,
       poll_count    = EXCLUDED.poll_count,
       outcome       = EXCLUDED.outcome,
       error_message = EXCLUDED.error_message,
       finished_at   = EXCLUDED.finished_at`,
    [
      workflowId, attempt.prId, attempt.prUrl, attempt.sourceBranch, attempt.action,
      attempt.pipelineUuid, attempt.pipelineUrl, attempt.initialState, attempt.finalState,
      attempt.pollCount, attempt.outcome, attempt.errorMessage,
      new Date().toISOString(), finishedAt,
    ],
  );
}
