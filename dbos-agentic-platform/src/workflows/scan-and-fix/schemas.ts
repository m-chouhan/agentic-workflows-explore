import { z } from "zod";

export const ScanFindingSchema = z.object({
  id: z.string().describe("CVE or rule ID, e.g. CVE-2026-1234 or semgrep-rule-id"),
  scanner: z.enum(["trivy", "semgrep", "npm-audit"]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  cvss: z.number().optional(),
  cweId: z.string().optional().describe("e.g. CWE-79"),
  packageName: z.string().optional(),
  currentVersion: z.string().optional(),
  fixedVersion: z.string().optional().describe("Minimum version that resolves the vuln"),
  filePath: z.string().optional(),
  line: z.number().optional(),
  description: z.string(),
});
export type ScanFinding = z.infer<typeof ScanFindingSchema>;

export const TriagedFindingSchema = z.object({
  findingId: z.string(),
  adjustedSeverity: z.enum(["critical", "high", "medium", "low", "false-positive"]),
  reasoning: z.string().describe("Why this severity — reference code context"),
  exploitability: z.enum(["proven", "likely", "unlikely", "none"]),
  fixType: z.enum(["version-bump", "code-change", "config-change", "accept-risk"]),
});

export const TriageResultSchema = z.object({
  prioritizedFindings: z.array(TriagedFindingSchema),
  executiveSummary: z.string().describe("2-3 sentence security posture summary"),
  blockerCount: z.number().describe("Number of findings that should block deployment"),
  recommendedAction: z.enum(["block-deploy", "warn-and-proceed", "informational"]),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const FileChangeSchema = z.object({
  filePath: z.string(),
  originalCode: z.string().describe("Exact code to be replaced"),
  fixedCode: z.string().describe("Replacement code with the vulnerability fixed"),
});

export const FixCandidateSchema = z.object({
  findingId: z.string(),
  fixType: z.enum(["version-bump", "code-patch", "config-change"]),
  confidence: z.number().min(0).max(1).describe("0-1 confidence score for this fix"),
  explanation: z.string().describe("What the fix does and why it addresses the vulnerability"),
  changes: z.array(FileChangeSchema).describe("File changes to apply"),
  newDependencies: z.array(z.object({
    packageName: z.string(),
    version: z.string(),
  })).optional().describe("New or upgraded dependencies required by the fix"),
  breakingChange: z.boolean().describe("True if this fix may break existing functionality"),
  testSuggestions: z.array(z.string()).optional().describe("Suggested test cases to validate the fix"),
});
export type FixCandidate = z.infer<typeof FixCandidateSchema>;

export const PRDescriptionSchema = z.object({
  title: z.string().describe("PR title, e.g. [SECURITY] Fix CVE-2026-xxxx in package-name"),
  body: z.string().describe("Markdown PR body: vulnerability details, fix summary, testing notes"),
  labels: z.array(z.string()).describe("Labels to apply, e.g. ['security', 'automated']"),
});
export type PRDescription = z.infer<typeof PRDescriptionSchema>;

export const ScanAndFixResultSchema = z.object({
  workflowId: z.string(),
  repo: z.string(),
  branch: z.string(),
  totalFindings: z.number(),
  blockerCount: z.number(),
  fixesAttempted: z.number(),
  fixesSucceeded: z.number(),
  prUrls: z.array(z.string()),
  triage: TriageResultSchema.optional(),
  status: z.enum(["completed", "partial", "failed", "manual-required"]),
});
export type ScanAndFixResult = z.infer<typeof ScanAndFixResultSchema>;
