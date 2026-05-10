/**
 * DBOS Workflow: Scan → Policy → Triage → Persist
 *
 * Phase 1: Shallow-clone public repo, run Trivy filesystem scan (deterministic)
 * Phase 2: Policy evaluation (deterministic — CVSS threshold)
 * Phase 3: Triage (agentic — LLM prioritises findings with reasoning)
 * Phase 4: Persist results to Postgres
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { query } from "../db/postgres";
import { triageFindings } from "../agent/vulnTriageAgent";
import type { ScanFinding, TriageResult, ScanAndFixResult } from "../schemas/vulnSchemas";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ── Clone (deterministic) ────────────────────────────────────────────────────

async function cloneRepo(repo: string, branch: string, workDir: string): Promise<void> {
  const url = `https://github.com/${repo}.git`;
  DBOS.logger.info(`[worker] cloneRepo: ${url} → ${workDir}`);
  await execAsync(`git clone --depth 1 --branch ${branch} ${url} ${workDir}`, { timeout: 60_000 });
}

// ── Trivy scanner (deterministic) ────────────────────────────────────────────

interface TrivyVuln {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  PrimaryURL?: string;
  CweIDs?: string[];
}

interface TrivyResult {
  Target: string;
  Type: string;
  Vulnerabilities?: TrivyVuln[];
}

interface TrivyReport {
  Results?: TrivyResult[];
}

function mapTrivySeverity(sev: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (sev.toUpperCase()) {
    case "CRITICAL": return "critical";
    case "HIGH":     return "high";
    case "MEDIUM":   return "medium";
    case "LOW":      return "low";
    default:         return "info";
  }
}

async function runTrivy(workDir: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runTrivy: scanning ${workDir}`);

  let stdout: string;
  try {
    const result = await execAsync(
      `trivy fs --format json --scanners vuln --quiet ${workDir}`,
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, // 10MB buffer for large reports
    );
    stdout = result.stdout;
  } catch (err: any) {
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      DBOS.logger.error(`[worker] trivy failed: ${err.message}`);
      return [];
    }
  }

  let report: TrivyReport;
  try {
    report = JSON.parse(stdout);
  } catch {
    DBOS.logger.error(`[worker] trivy returned invalid JSON`);
    return [];
  }

  const findings: ScanFinding[] = [];
  const seen = new Set<string>(); // deduplicate by VulnerabilityID

  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      if (seen.has(v.VulnerabilityID)) continue;
      seen.add(v.VulnerabilityID);

      findings.push({
        id: v.VulnerabilityID,
        scanner: "trivy",
        severity: mapTrivySeverity(v.Severity),
        packageName: v.PkgName,
        currentVersion: v.InstalledVersion,
        fixedVersion: v.FixedVersion,
        cweId: v.CweIDs?.[0],
        filePath: result.Target,
        description: v.Title ?? `Vulnerability in ${v.PkgName}`,
      });
    }

    DBOS.logger.info(`[worker] runTrivy: ${result.Target} (${result.Type}): ${(result.Vulnerabilities ?? []).length} vulns`);
  }

  DBOS.logger.info(`[worker] runTrivy: ${findings.length} unique findings total`);
  return findings;
}

// ── Scan orchestrator ────────────────────────────────────────────────────────

async function runScanners(repo: string, branch: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runScanners: ${repo}@${branch}`);

  const workDir = `/tmp/scan-${Date.now()}`;
  try {
    await cloneRepo(repo, branch, workDir);
    return await runTrivy(workDir);
  } finally {
    await execAsync(`rm -rf ${workDir}`).catch(() => {});
  }
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
    DBOS.logger.info(`[worker] ✓ scanAndFix done — no findings`);
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
      retriesAllowed: true, maxAttempts: 2, intervalSeconds: 5, backoffRate: 1,
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
