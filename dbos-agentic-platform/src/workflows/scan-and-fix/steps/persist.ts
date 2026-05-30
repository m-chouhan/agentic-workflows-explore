/**
 * Policy + persistence steps (deterministic, idempotent).
 */
import { query } from "../../../platform/db";
import type { ScanFinding, TriageResult } from "../schemas";

/** Policy: count findings that should block a deploy. */
export function countBlockers(findings: ScanFinding[]): number {
  return findings.filter((f) => f.severity === "critical" || (f.cvss ?? 0) >= 9.0).length;
}

/** Upsert scan results for a workflow run (idempotent on workflow_id). */
export async function writeScanResults(
  workflowId: string,
  repo: string,
  branch: string,
  findings: ScanFinding[],
  blockerCount: number,
  triage: TriageResult | null,
  status: string,
): Promise<void> {
  await query(
    `INSERT INTO scan_results
       (workflow_id, repo, branch, scanned_at, total_findings, blocker_count, triage_json, findings_json, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(workflow_id) DO UPDATE SET
       scanned_at     = EXCLUDED.scanned_at,
       total_findings = EXCLUDED.total_findings,
       blocker_count  = EXCLUDED.blocker_count,
       triage_json    = EXCLUDED.triage_json,
       findings_json  = EXCLUDED.findings_json,
       status         = EXCLUDED.status`,
    [
      workflowId, repo, branch, new Date().toISOString(),
      findings.length, blockerCount,
      triage ? JSON.stringify(triage) : null,
      JSON.stringify(findings),
      status,
    ],
  );
}
