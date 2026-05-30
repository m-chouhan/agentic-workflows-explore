import { generateText, Output } from "ai";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { getChatModel } from "../../../platform/llm";
import { ScanFinding, TriageResultSchema, TriageResult } from "../schemas";

export async function triageFindings(findings: ScanFinding[]): Promise<TriageResult> {
  if (!findings.length) {
    return {
      prioritizedFindings: [],
      executiveSummary: "No findings to triage.",
      blockerCount: 0,
      recommendedAction: "informational",
    };
  }

  const prompt = [
    `You are a senior application security engineer. Analyse the following vulnerability scan findings and produce a structured triage.`,
    ``,
    `For each finding:`,
    `- Assess real-world exploitability (not just CVSS score)`,
    `- Determine if a version bump is sufficient or if code changes are needed`,
    `- Flag false positives if the context suggests the vulnerability is not reachable`,
    `- Adjust severity based on exploitability and context`,
    ``,
    `Findings:`,
    JSON.stringify(findings, null, 2),
  ].join("\n");

  DBOS.logger.info(`[triage] → ${findings.length} findings | ${prompt.length} chars`);

  const { experimental_output: object, usage } = await (generateText as any)({
    model: getChatModel(),
    output: (Output.object as any)({ schema: TriageResultSchema }),
    prompt,
  });

  const result = object as TriageResult;
  DBOS.logger.info(
    `[triage] ← tokens in=${usage.inputTokens} out=${usage.outputTokens} | ` +
    `blockers=${result.blockerCount} action=${result.recommendedAction}`,
  );

  return result;
}
