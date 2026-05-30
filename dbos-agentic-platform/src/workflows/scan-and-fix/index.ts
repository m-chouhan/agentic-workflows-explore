import * as path from "path";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { buildVulnRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME, TRIAGE_LIMIT } from "./constants";
import { runScanners } from "./steps/scan";
import { prioritizeForTriage } from "./steps/prioritize";
import { triageFindings } from "./steps/triage";
import { countBlockers, writeScanResults } from "./steps/persist";
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

  const topFindings = prioritizeForTriage(findings, TRIAGE_LIMIT);
  DBOS.logger.info(`[scan-and-fix] triage slice: ${topFindings.length} / ${findings.length} findings`);

  let triage: TriageResult;
  try {
    triage = await DBOS.runStep(() => triageFindings(topFindings), {
      name: "triage",
      retriesAllowed: true, maxAttempts: 2, intervalSeconds: 5, backoffRate: 1,
    });
  } catch (err) {
    DBOS.logger.error(`triage failed: ${(err as Error).message}`);
    // Fallback: use raw scanner severity so the workflow still completes.
    triage = {
      prioritizedFindings: topFindings.map((f) => ({
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

const scanAndFixWorkflow = DBOS.registerWorkflow(scanAndFix, { name: WORKFLOW_NAME });

export const scanAndFixModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  schemaPath: path.join(__dirname, "schema.sql"),
  buildRouter: buildVulnRouter,
  register: () => { void scanAndFixWorkflow; }, // ensure module is loaded and workflow registered
};
