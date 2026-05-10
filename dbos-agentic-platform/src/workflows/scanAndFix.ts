/**
 * DBOS Workflow: Scan → Triage → Fix → PR
 *
 * Deterministic steps: scanners, CVE enrichment, policy check, DB writes, GitHub API
 * Agentic steps: triage (LLM), fix generation (LLM)
 *
 * This workflow demonstrates the hybrid pattern: deterministic skeleton + agentic brain.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { query } from "../db/postgres";
import { triageFindings } from "../agent/vulnTriageAgent";
import { generateFix, FixContext } from "../agent/vulnFixAgent";
import { createFixPR, pollChecks, CheckConclusion } from "../github/prCreator";
import type {
  ScanFinding,
  TriageResult,
  FixCandidate,
  ScanAndFixResult,
  PRDescription,
} from "../schemas/vulnSchemas";

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Run scanners (deterministic — wraps CLI tools)
// ═══════════════════════════════════════════════════════════════════════════════

async function runScanners(repo: string, branch: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[worker] runScanners: scanning ${repo}@${branch}`);

  // TODO: Replace with real scanner CLI calls (trivy, semgrep, npm audit).
  // For now, return stub findings to prove the workflow shape.
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

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Policy evaluation (deterministic — plain if/else)
// ═══════════════════════════════════════════════════════════════════════════════

function evaluatePolicy(findings: ScanFinding[]): { blockers: ScanFinding[]; nonBlockers: ScanFinding[] } {
  const blockers = findings.filter((f) => f.severity === "critical" || (f.cvss ?? 0) >= 9.0);
  const nonBlockers = findings.filter((f) => f.severity !== "critical" && (f.cvss ?? 0) < 9.0);
  return { blockers, nonBlockers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 3: Write scan results to DB (deterministic — idempotent upsert)
// ═══════════════════════════════════════════════════════════════════════════════

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
  DBOS.logger.info(`[worker]   writeScanResults: persisted ${findings.length} findings, status=${status}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 4: Write fix attempt to DB (deterministic)
// ═══════════════════════════════════════════════════════════════════════════════

async function writeFixAttempt(
  workflowId: string,
  fix: FixCandidate,
  prUrl: string | null,
  prStatus: string,
): Promise<void> {
  await query(
    `INSERT INTO fix_attempts
       (workflow_id, finding_id, fix_type, confidence, patch_json, pr_url, pr_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      workflowId, fix.findingId, fix.fixType, fix.confidence,
      JSON.stringify(fix), prUrl, prStatus, new Date().toISOString(),
    ],
  );
  DBOS.logger.info(`[worker]   writeFixAttempt: ${fix.findingId} → ${prStatus}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 5: Generate PR description (deterministic — template-based)
// ═══════════════════════════════════════════════════════════════════════════════

function buildPRDescription(finding: ScanFinding, fix: FixCandidate): PRDescription {
  const title = `[SECURITY] Fix ${finding.id}${finding.packageName ? ` in ${finding.packageName}` : ""}`;
  const body = [
    `## Security Fix`,
    ``,
    `**Vulnerability**: ${finding.id} (CVSS ${finding.cvss ?? "N/A"} — ${finding.severity.toUpperCase()})`,
    finding.cweId ? `**CWE**: ${finding.cweId}` : "",
    finding.packageName ? `**Package**: ${finding.packageName}@${finding.currentVersion ?? "?"}` : "",
    finding.fixedVersion ? `**Fixed Version**: ${finding.fixedVersion}` : "",
    ``,
    `### Description`,
    finding.description,
    ``,
    `### Fix Applied`,
    fix.explanation,
    ``,
    `### Confidence`,
    `Agent confidence: **${(fix.confidence * 100).toFixed(0)}%**`,
    fix.breakingChange ? `⚠️ **This fix may introduce breaking changes**` : "",
    ``,
    `---`,
    `*This PR was generated automatically by the vulnerability fix agent.*`,
  ].filter(Boolean).join("\n");

  return { title, body, labels: ["security", "automated"] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main workflow: scanAndFix
// ═══════════════════════════════════════════════════════════════════════════════

async function scanAndFix(repo: string, branch: string): Promise<ScanAndFixResult> {
  const workflowId = DBOS.workflowID ?? `scan-${Date.now()}`;
  DBOS.logger.info(`[worker] ▶ WORKFLOW START  scanAndFix(${repo}@${branch})  workflowId=${workflowId}`);

  // ── Phase 1: Scan (deterministic) ──────────────────────────────────────────
  const findings = await DBOS.runStep(() => runScanners(repo, branch), { name: "runScanners" });

  if (findings.length === 0) {
    await DBOS.runStep(
      () => writeScanResults(workflowId, repo, branch, [], 0, null, "completed"),
      { name: "writeScanResults-empty" },
    );
    DBOS.logger.info(`[worker] ✓ WORKFLOW DONE  no findings  workflowId=${workflowId}`);
    return {
      workflowId, repo, branch,
      totalFindings: 0, blockerCount: 0,
      fixesAttempted: 0, fixesSucceeded: 0,
      prUrls: [], status: "completed",
    };
  }

  // ── Phase 2: Policy evaluation (deterministic — plain if/else) ─────────────
  const { blockers } = evaluatePolicy(findings);
  DBOS.logger.info(`[worker]   policy: ${blockers.length} blockers out of ${findings.length} findings`);

  // ── Phase 3: Triage (agentic — LLM with retry) ────────────────────────────
  let triage: TriageResult;
  try {
    triage = await DBOS.runStep(() => triageFindings(findings), {
      name: "triageFindings",
      retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2,
    });
  } catch (err) {
    DBOS.logger.error(`triageFindings failed: ${(err as Error).message}`);
    triage = {
      prioritizedFindings: findings.map((f) => ({
        findingId: f.id,
        adjustedSeverity: f.severity === "info" ? "low" : f.severity,
        reasoning: "Triage agent unavailable — using scanner severity as-is.",
        exploitability: "likely" as const,
        fixType: f.fixedVersion ? "version-bump" as const : "code-change" as const,
      })),
      executiveSummary: `Triage unavailable. ${findings.length} raw findings, ${blockers.length} blockers.`,
      blockerCount: blockers.length,
      recommendedAction: blockers.length > 0 ? "block-deploy" : "warn-and-proceed",
    };
  }

  // Persist scan + triage results
  await DBOS.runStep(
    () => writeScanResults(workflowId, repo, branch, findings, triage.blockerCount, triage, "triaged"),
    { name: "writeScanResults-triaged" },
  );

  // ── Phase 4: Fix generation (agentic, per finding) ─────────────────────────
  const fixableFindings = triage.prioritizedFindings.filter(
    (f) => f.adjustedSeverity !== "false-positive" && f.fixType !== "accept-risk",
  );

  const fixes: Array<{ fix: FixCandidate; finding: ScanFinding }> = [];

  for (const triaged of fixableFindings) {
    const finding = findings.find((f) => f.id === triaged.findingId);
    if (!finding) continue;

    try {
      const ctx: FixContext = { finding, triage: triaged };
      const fix = await DBOS.runStep(() => generateFix(ctx), {
        name: `generateFix-${triaged.findingId}`,
        retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2,
      });
      fixes.push({ fix, finding });
    } catch (err) {
      DBOS.logger.error(`generateFix failed for ${triaged.findingId}: ${(err as Error).message}`);
      await DBOS.runStep(
        () => writeFixAttempt(workflowId, {
          findingId: triaged.findingId,
          fixType: triaged.fixType === "code-change" ? "code-patch" as const : triaged.fixType as "version-bump" | "config-change",
          confidence: 0,
          explanation: `Fix generation failed: ${(err as Error).message}`,
          changes: [],
          breakingChange: false,
        }, null, "failed"),
        { name: `writeFixAttempt-failed-${triaged.findingId}` },
      );
    }
  }

  // ── Phase 5: PR creation (deterministic — GitHub API) ──────────────────────
  const prUrls: string[] = [];

  for (const { fix, finding } of fixes) {
    try {
      const prDesc = buildPRDescription(finding, fix);

      if (!process.env.GITHUB_TOKEN) {
        DBOS.logger.info(`[worker]   SKIP PR creation (no GITHUB_TOKEN) for ${fix.findingId}`);
        await DBOS.runStep(
          () => writeFixAttempt(workflowId, fix, null, "skipped-no-token"),
          { name: `writeFixAttempt-skip-${fix.findingId}` },
        );
        continue;
      }

      const prResult = await DBOS.runStep(
        () => createFixPR(repo, branch, fix, prDesc),
        { name: `createPR-${fix.findingId}` },
      );

      prUrls.push(prResult.prUrl);

      const ciResult: CheckConclusion = await DBOS.runStep(
        () => pollChecks(repo, prResult.headSha, 5 * 60 * 1000),
        { name: `pollChecks-${fix.findingId}` },
      );

      await DBOS.runStep(
        () => writeFixAttempt(workflowId, fix, prResult.prUrl, ciResult === "success" ? "ci-passed" : `ci-${ciResult}`),
        { name: `writeFixAttempt-${fix.findingId}` },
      );
    } catch (err) {
      DBOS.logger.error(`PR creation failed for ${fix.findingId}: ${(err as Error).message}`);
      await DBOS.runStep(
        () => writeFixAttempt(workflowId, fix, null, "pr-failed"),
        { name: `writeFixAttempt-prfail-${fix.findingId}` },
      );
    }
  }

  // ── Phase 6: Final status ──────────────────────────────────────────────────
  const fixesSucceeded = fixes.length;
  const status = fixes.length === 0 && fixableFindings.length > 0
    ? "failed"
    : fixableFindings.length === 0
      ? "completed"
      : fixes.length < fixableFindings.length
        ? "partial"
        : "completed";

  await DBOS.runStep(
    () => writeScanResults(workflowId, repo, branch, findings, triage.blockerCount, triage, status),
    { name: "writeScanResults-final" },
  );

  const result: ScanAndFixResult = {
    workflowId, repo, branch,
    totalFindings: findings.length,
    blockerCount: triage.blockerCount,
    fixesAttempted: fixableFindings.length,
    fixesSucceeded,
    prUrls,
    triage,
    status,
  };

  DBOS.logger.info(
    `[worker] ✓ WORKFLOW DONE  workflowId=${workflowId}  findings=${findings.length} ` +
    `fixes=${fixesSucceeded}/${fixableFindings.length}  PRs=${prUrls.length}  status=${status}`,
  );

  return result;
}

export const scanAndFixWorkflow = DBOS.registerWorkflow(scanAndFix, { name: "scanAndFix" });
