/**
 * Vulnerability Fix Agent — uses LLM structured output to generate
 * code patches or version-bump instructions for a single finding.
 *
 * The output is constrained by FixCandidateSchema (Zod) so the LLM
 * cannot invent arbitrary fields or skip required ones.
 */
import { generateText, Output } from "ai";
import { google } from "@ai-sdk/google";
import { DBOS } from "@dbos-inc/dbos-sdk";
import {
  ScanFinding,
  FixCandidateSchema,
  FixCandidate,
  TriagedFindingSchema,
} from "../schemas/vulnSchemas";
import { z } from "zod";

type TriagedFinding = z.infer<typeof TriagedFindingSchema>;

export interface FixContext {
  finding: ScanFinding;
  triage: TriagedFinding;
  /** Relevant source code snippets around the vulnerable location */
  codeSnippets?: string[];
  /** package.json content (for version-bump fixes) */
  packageJson?: string;
}

export async function generateFix(ctx: FixContext): Promise<FixCandidate> {
  const { finding, triage, codeSnippets, packageJson } = ctx;

  const promptParts = [
    `You are a senior security engineer. Generate a minimal, precise fix for the following vulnerability.`,
    ``,
    `## Vulnerability`,
    `- ID: ${finding.id}`,
    `- Severity: ${finding.severity} (adjusted: ${triage.adjustedSeverity})`,
    `- CWE: ${finding.cweId ?? "unknown"}`,
    `- Description: ${finding.description}`,
    `- Fix type recommended by triage: ${triage.fixType}`,
  ];

  if (finding.packageName) {
    promptParts.push(`- Package: ${finding.packageName}@${finding.currentVersion ?? "unknown"}`);
    if (finding.fixedVersion) {
      promptParts.push(`- Known fixed version: ${finding.fixedVersion}`);
    }
  }

  if (finding.filePath) {
    promptParts.push(`- File: ${finding.filePath}:${finding.line ?? "?"}`);
  }

  if (codeSnippets?.length) {
    promptParts.push(``, `## Relevant Code`, ...codeSnippets.map((s) => "```\n" + s + "\n```"));
  }

  if (packageJson) {
    promptParts.push(``, `## package.json (relevant section)`, "```json", packageJson, "```");
  }

  promptParts.push(
    ``,
    `## Instructions`,
    `- Generate the MINIMAL change to fix this vulnerability`,
    `- Do NOT change unrelated code`,
    `- If this is a version bump, set fixType to "version-bump" and put the dependency change in newDependencies`,
    `- If this requires code changes, provide exact originalCode and fixedCode for each affected file`,
    `- Set breakingChange to true if the fix could break existing functionality`,
    `- Set confidence between 0 and 1 based on how certain you are the fix is correct`,
  );

  const prompt = promptParts.join("\n");

  DBOS.logger.info(`[fix-agent] → ${finding.id} | ${prompt.length} chars`);

  const { experimental_output: object, usage } = await (generateText as any)({
    model: google((process.env.GOOGLE_MODEL ?? "gemini-2.0-flash") as any),
    output: (Output.object as any)({ schema: FixCandidateSchema }),
    prompt,
  });

  const result = object as FixCandidate;
  DBOS.logger.info(
    `[fix-agent] ← tokens in=${usage.inputTokens} out=${usage.outputTokens} | ` +
    `confidence=${result.confidence} type=${result.fixType} breaking=${result.breakingChange}`,
  );

  return result;
}
