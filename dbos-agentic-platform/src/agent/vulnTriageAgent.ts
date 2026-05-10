/**
 * Vulnerability Triage Agent — uses LLM structured output to prioritise
 * and classify scan findings with reasoning.
 *
 * Same pattern as mockAgent.ts (sales): generateText + Zod schema = type-safe output.
 */
import { generateText, Output } from "ai";
import { google } from "@ai-sdk/google";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { ScanFinding, TriageResultSchema, TriageResult } from "../schemas/vulnSchemas";

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

  DBOS.logger.info(`[triage-agent] → ${findings.length} findings | ${prompt.length} chars`);

  const { experimental_output: object, usage } = await (generateText as any)({
    model: google((process.env.GOOGLE_MODEL ?? "gemini-2.0-flash") as any),
    output: (Output.object as any)({ schema: TriageResultSchema }),
    prompt,
  });

  const result = object as TriageResult;
  DBOS.logger.info(
    `[triage-agent] ← tokens in=${usage.inputTokens} out=${usage.outputTokens} | ` +
    `blockers=${result.blockerCount} action=${result.recommendedAction}`,
  );

  return result;
}
