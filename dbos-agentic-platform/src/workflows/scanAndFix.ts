/**
 * DBOS Workflow: Scan → Policy → Triage → Persist
 *
 * Phase 1: Shallow-clone public repo, run npm audit (deterministic)
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
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

async function cloneRepo(repo: string, branch: string, workDir: string): Promise<void> {
  const url = `https://github.com/${repo}.git`;
  DBOS.logger.info(`[worker] cloneRepo: ${url} → ${workDir}`);
  await execAsync(`git clone --depth 1 --branch ${branch} ${url} ${workDir}`, { timeout: 60_000 });
}

interface NpmAuditVuln {
  severity: string;
  range: string;
  fixAvailable?: { name: string; version: string } | boolean;
  via: Array<{ title?: string; url?: string; severity?: string; cwe?: string[] } | string>;
}

function mapNpmSeverity(sev: string): "critical" | "high" | "medium" | "low" | "info" {
  switch (sev) {
    case "critical": return "critical";
    case "high":     return "high";
    case "moderate": return "medium";
    case "low":      return "low";
    default:         return "info";
  }
}

async function runNpmAudit(workDir: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runNpmAudit: ${workDir}`);

  let stdout: string;
  try {
    // npm audit exits non-zero when vulns found — that's expected
    const result = await execAsync("npm audit --json 2>/dev/null", { cwd: workDir, timeout: 30_000 });
    stdout = result.stdout;
  } catch (err: any) {
    // exit code 1 = vulns found, stdout still has valid JSON
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      DBOS.logger.error(`[worker] npm audit failed: ${err.message}`);
      return [];
    }
  }

  let audit: { vulnerabilities?: Record<string, NpmAuditVuln> };
  try {
    audit = JSON.parse(stdout);
  } catch {
    DBOS.logger.error(`[worker] npm audit returned invalid JSON`);
    return [];
  }

  const vulns = audit.vulnerabilities ?? {};
  const findings: ScanFinding[] = [];

  for (const [name, v] of Object.entries(vulns)) {
    // v.via can be strings (transitive ref) or objects (actual advisory)
    const advisory = v.via.find((x): x is Exclude<typeof x, string> => typeof x !== "string");

    const fixVersion = typeof v.fixAvailable === "object" ? v.fixAvailable.version : undefined;
    const cweId = advisory?.cwe?.[0];

    findings.push({
      id: advisory?.url ?? `npm-${name}`,
      scanner: "npm-audit",
      severity: mapNpmSeverity(v.severity),
      packageName: name,
      currentVersion: v.range,
      fixedVersion: fixVersion,
      cweId,
      description: advisory?.title ?? `Vulnerability in ${name}`,
    });
  }

  DBOS.logger.info(`[worker] runNpmAudit: found ${findings.length} vulnerabilities`);
  return findings;
}

async function runScanners(repo: string, branch: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runScanners: ${repo}@${branch}`);

  const workDir = `/tmp/scan-${Date.now()}`;
  try {
    await cloneRepo(repo, branch, workDir);

    const findings: ScanFinding[] = [];

    // npm audit (if Node.js project)
    if (fs.existsSync(path.join(workDir, "package-lock.json"))) {
      findings.push(...await runNpmAudit(workDir));
    } else {
      DBOS.logger.info(`[worker] runScanners: no package-lock.json found, skipping npm audit`);
    }

    // TODO: Add trivy, semgrep here for broader coverage

    DBOS.logger.info(`[worker] runScanners: ${findings.length} total findings`);
    return findings;
  } finally {
    // Always cleanup
    await execAsync(`rm -rf ${workDir}`).catch(() => {});
  }
}

function countBlockers(findings: ScanFinding[]): number {
  return findings.filter((f) => f.severity === "critical" || (f.cvss ?? 0) >= 9.0).length;
}

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
