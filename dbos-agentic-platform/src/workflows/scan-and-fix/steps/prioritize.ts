import type { ScanFinding } from "../schemas";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Returns the top N findings for LLM triage, ordered by severity then
 * fixability (findings with a known fixedVersion surface first within
 * each severity tier — more actionable for the LLM to reason about).
 *
 * Full raw findings are persisted separately; this slice is triage-only.
 */
export function prioritizeForTriage(findings: ScanFinding[], limit: number): ScanFinding[] {
  return [...findings]
    .sort((a, b) => {
      const severityDiff = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
      if (severityDiff !== 0) return severityDiff;
      // Within same severity: fixable findings first
      const aFixable = a.fixedVersion ? 0 : 1;
      const bFixable = b.fixedVersion ? 0 : 1;
      return aFixable - bFixable;
    })
    .slice(0, limit);
}
