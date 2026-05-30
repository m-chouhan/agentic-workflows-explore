import { DBOS } from "@dbos-inc/dbos-sdk";
import { exec } from "child_process";
import { promisify } from "util";
import type { ScanFinding } from "../schemas";

const execAsync = promisify(exec);

async function cloneRepo(repo: string, branch: string, workDir: string): Promise<void> {
  const url = `https://github.com/${repo}.git`;
  DBOS.logger.info(`[scan] cloneRepo: ${url} → ${workDir}`);
  await execAsync(`git clone --depth 1 --branch ${branch} ${url} ${workDir}`, { timeout: 60_000 });
}

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
  DBOS.logger.info(`[scan] runTrivy: scanning ${workDir}`);

  let stdout: string;
  try {
    const result = await execAsync(
      `trivy fs --format json --scanners vuln --quiet ${workDir}`,
      { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, // 10 MB — large monorepos can exceed the default
    );
    stdout = result.stdout;
  } catch (err: any) {
    if (err.stdout) {
      stdout = err.stdout;
    } else {
      DBOS.logger.error(`[scan] trivy failed: ${err.message}`);
      return [];
    }
  }

  let report: TrivyReport;
  try {
    report = JSON.parse(stdout);
  } catch {
    DBOS.logger.error(`[scan] trivy returned invalid JSON`);
    return [];
  }

  const findings: ScanFinding[] = [];
  const seen = new Set<string>(); // same CVE can appear across multiple targets

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

    DBOS.logger.info(`[scan] runTrivy: ${result.Target} (${result.Type}): ${(result.Vulnerabilities ?? []).length} vulns`);
  }

  DBOS.logger.info(`[scan] runTrivy: ${findings.length} unique findings total`);
  return findings;
}

export async function runScanners(repo: string, branch: string): Promise<ScanFinding[]> {
  DBOS.logger.info(`[scan] runScanners: ${repo}@${branch}`);

  const workDir = `/tmp/scan-${Date.now()}`;
  try {
    await cloneRepo(repo, branch, workDir);
    return await runTrivy(workDir);
  } finally {
    await execAsync(`rm -rf ${workDir}`).catch(() => {});
  }
}
