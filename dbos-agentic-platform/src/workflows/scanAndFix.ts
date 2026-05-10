/**
 * DBOS Workflow: Scan → Policy → Triage → Persist
 *
 * Phase 1: Run scanners (deterministic — stub for now, real CLI later)
 * Phase 2: Policy evaluation (deterministic — CVSS threshold)
 * Phase 3: Triage (agentic — LLM prioritises findings with reasoning)
 * Phase 4: Persist results to Postgres
 *
 * Fix generation + PR creation will be added as separate phases once
 * scan-and-triage is proven end-to-end with real repos.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { query } from "../db/postgres";
import { triageFindings } from "../agent/vulnTriageAgent";
import type { ScanFinding, TriageResult, ScanAndFixResult } from "../schemas/vulnSchemas";

// ── Scan (deterministic) ─────────────────────────────────────────────────────

async function runScanners(repo: string, branch: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runScanners: ${repo}@${branch}`);

  // TODO: Replace with real git clone + scanner CLI calls.
  const findings: ScanFinding[] = [
    {
      id: "CVE-2026-31337",
      scanner: "npm-audit",
      severity: "high",
      cvss: 8.1,
      cweId: "CWE-1321",
      packageName: "lodash",
      currentVersion: "4.17.20",
      fixedVersion: "4.17.21",
      description: "Prototype Pollution in lodash via the set function",
    },
    {
      id: "CVE-2026-22145",
      scanner: "semgrep",
      severity: "medium",
      cvss: 5.3,
      cweId: "CWE-79",
      filePath: "src/api/handler.ts",
      line: 42,
      description: "Potential XSS: user input rendered without sanitisation in response body",
    },
    {
      id: "CVE-2026-10099",
      scanner: "trivy",
      severity: "critical",
      cvss: 9.8,
      cweId: "CWE-502",
      packageName: "yaml",
      currentVersion: "2.3.1",
      fixedVersion: "2.4.0",
      description: "Unsafe YAML deserialization allows arbitrary code execution",
    },
  ];

  DBOS.logger.info(`[worker] runScanners: found ${findings.length} findings`);
  return findings;
}

// ── Policy (deterministic) ───────────────────────────────────────────────────

function countBlockers(findings: ScanFinding[]): number {
  return findings.filter((f) => f.severity === "critical" || (f.cvss ?? 0) >= 9.0).length;
}

// ── Persist (deterministic, idempotent) ──────────────────────────────────────

async function writeScanResults(
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

// ── Main workflow ────────────────────────────────────────────────────────────

async function scanAndFix(repo: string, branch: string): Promise<ScanAndFixResult> {
  const workflowId = DBOS.workflowID ?? `scan-${Date.now()}`;
  DBOS.logger.info(`[worker] ▶ scanAndFix(${repo}@${branch})  wfId=${workflowId}`);

  // Phase 1: Scan
  const findings = await DBOS.runStep(() => runScanners(repo, branch), { name: "scan" });

  if (findings.length === 0) {
    await DBOS.runStep(() => writeScanResults(workflowId, repo, branch, [], 0, null, "completed"), { name: "persist-empty" });
    return { workflowId, repo, branch, totalFindings: 0, blockerCount: 0, fixesAttempted: 0, fixesSucceeded: 0, prUrls: [], status: "completed" };
  }

  // Phase 2: Policy
  const blockerCount = countBlockers(findings);
  DBOS.logger.info(`[worker] policy: ${blockerCount} blockers / ${findings.length} total`);

  // Phase 3: Triage (agentic)
  let triage: TriageResult;
  try {
    triage = await DBOS.runStep(() => triageFindings(findings), {
      name: "triage",
      retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2,
    });
  } catch (err) {
    DBOS.logger.error(`triage failed: ${(err as Error).message}`);
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

  // Phase 4: Persist
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

  DBOS.logger.info(`[worker] ✓ scanAndFix done  wfId=${workflowId}  findings=${findings.length}  blockers=${triage.blockerCount}`);
  return result;
}

export const scanAndFixWorkflow = DBOS.registerWorkflow(scanAndFix, { name: "scanAndFix" });
