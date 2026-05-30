import { DBOS } from "@dbos-inc/dbos-sdk";
import { runScanners } from "./steps/scan";
import { triageFindings } from "./steps/triage";
import { countBlockers, writeScanResults } from "./steps/persist";
import { SCAN_AND_FIX_WORKFLOW } from "./constants";
import type { TriageResult, ScanAndFixResult } from "./schemas";

async function scanAndFix(repo: string, branch: string): Promise<ScanAndFixResult> {
  const workflowId = DBOS.workflowID ?? `scan-${Date.now()}`;
  DBOS.logger.info(`[scan-and-fix] ▶ scanAndFix(${repo}@${branch})  wfId=${workflowId}`);

  const findings = await DBOS.runStep(() => runScanners(repo, branch), { name: "scan" });

  if (findings.length === 0) {
    await DBOS.runStep(() => writeScanResults(workflowId, repo, branch, [], 0, null, "completed"), { name: "persist-empty" });
    DBOS.logger.info(`[scan-and-fix] ✓ done — no findings`);
    return { workflowId, repo, branch, totalFindings: 0, blockerCount: 0, fixesAttempted: 0, fixesSucceeded: 0, prUrls: [], status: "completed" };
  }

  const blockerCount = countBlockers(findings);
  DBOS.logger.info(`[scan-and-fix] policy: ${blockerCount} blockers / ${findings.length} total`);

  let triage: TriageResult;
  try {
    triage = await DBOS.runStep(() => triageFindings(findings), {
      name: "triage",
      retriesAllowed: true, maxAttempts: 2, intervalSeconds: 5, backoffRate: 1,
    });
  } catch (err) {
    DBOS.logger.error(`triage failed: ${(err as Error).message}`);
    // Fallback: use raw scanner severity so the workflow still completes.
    triage = {
      prioritizedFindings: findings.map((f) => ({
        findingId: f.id,
        adjustedSeverity: f.severity === "info" ? "low" : f.severity,
        reasoning: "Triage agent unavailable — using scanner severity.",
        exploitability: "likely" as const,
        fixType: f.fixedVersion ? "version-bump" as const : "code-change" as const,
      })),
      executiveSummary: `Triage failed. ${findings.length} raw findings, ${blockerCount} blockers.`,
      blockerCount,
      recommendedAction: blockerCount > 0 ? "block-deploy" : "warn-and-proceed",
    };
  }

  await DBOS.runStep(() => writeScanResults(workflowId, repo, branch, findings, triage.blockerCount, triage, "completed"), { name: "persist" });

  const result: ScanAndFixResult = {
    workflowId, repo, branch,
    totalFindings: findings.length,
    blockerCount: triage.blockerCount,
    fixesAttempted: 0,
    fixesSucceeded: 0,
    prUrls: [],
    triage,
    status: "completed",
  };

  DBOS.logger.info(`[scan-and-fix] ✓ done  wfId=${workflowId}  findings=${findings.length}  blockers=${triage.blockerCount}`);
  return result;
}

export const scanAndFixWorkflow = DBOS.registerWorkflow(scanAndFix, { name: SCAN_AND_FIX_WORKFLOW });
