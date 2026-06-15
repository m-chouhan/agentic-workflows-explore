// Rovo Dev serve-mode client.
// Requires `acli rovodev serve <port>` running on the host before the workflow starts.
// ROVO_DEV_URL  — e.g. http://host.docker.internal:4000  (Docker) or http://localhost:4000
// ROVO_DEV_TOKEN — bearer token printed by `acli rovodev serve` on startup
import { z } from "zod";

// Schema is the single source of truth for a triage decision. `.catch()` per field
// makes parsing total: any missing/invalid value falls back to a safe default
// (decision → "flag", the no-op action) instead of throwing and failing the workflow.
const TriageDecisionSchema = z.object({
  decision: z.enum(["retrigger", "rebase", "flag"]).catch("flag"),
  confidence: z.number().min(0).max(1).catch(0),
  reason: z.string().catch(""),
  action_hint: z.string().catch(""),
});

export type TriageDecision = z.infer<typeof TriageDecisionSchema>;

function getRovoDevBase(): string {
  const url = process.env.ROVO_DEV_URL;
  if (!url) throw new Error("Missing ROVO_DEV_URL. Start rovodev serve and set the env var.");
  return url;
}

function getRovoDevToken(): string {
  const token = process.env.ROVO_DEV_TOKEN;
  if (!token) throw new Error("Missing ROVO_DEV_TOKEN. Copy the bearer token printed by `acli rovodev serve`.");
  return token;
}

function authHeader() {
  return { Authorization: `Bearer ${getRovoDevToken()}` };
}

/** Reset the Rovo Dev session so context from a prior run doesn't bleed into the next. */
async function resetRovoDev(): Promise<void> {
  const res = await fetch(`${getRovoDevBase()}/v2/reset`, { method: "POST", headers: authHeader() });
  if (!res.ok) throw new Error(`Rovo Dev reset failed: ${res.status}`);
}

/**
 * Consume the SSE stream from /v2/chat and reassemble the model's text content.
 *
 * SSE frames are blank-line separated and a single logical `data:` value can span
 * multiple physical lines, so we parse per-frame (joining its data lines) rather
 * than line-by-line — line-by-line dropped continuation lines and truncated the
 * front of the reply.
 */
async function consumeSSE(res: Response): Promise<string> {
  const raw = await res.text();
  let content = "";
  for (const frame of raw.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const d = JSON.parse(data);
      if (d.event_kind === "part_delta") content += d.delta?.content_delta ?? "";
    } catch { /* skip non-JSON frames (e.g. heartbeats) */ }
  }
  return content;
}

/**
 * Parse a TriageDecision from Rovo Dev output: pull the first {...} block (ignoring
 * any surrounding prose or code fences) and validate it against the schema, whose
 * per-field `.catch()` supplies safe defaults for anything missing or invalid.
 */
function parseDecision(text: string): TriageDecision {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    return TriageDecisionSchema.parse(json ? JSON.parse(json) : {});
  } catch {
    return TriageDecisionSchema.parse({});  // no/invalid JSON → all safe defaults
  }
}

/**
 * Send a prompt to the running Rovo Dev serve instance and return the response text.
 * Resets session first so prior conversation context doesn't affect the result.
 */
async function askRovoDev(prompt: string): Promise<string> {
  await resetRovoDev();
  const res = await fetch(`${getRovoDevBase()}/v2/chat`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt }),
  });
  if (!res.ok) throw new Error(`Rovo Dev chat failed: ${res.status}`);
  return consumeSSE(res);
}

/** Ask Rovo Dev to triage a failing PR and return a structured decision. */
export async function triagePr(params: {
  repo: string;
  prId: number;
  title: string;
  sourceBranch: string;
  destBranch: string;
  failingStatusKey: string;
}): Promise<TriageDecision> {
  const prompt = `You are triaging a failing Renovate dependency-bump PR in Bitbucket. Decide ONE action.

Repo: ${params.repo}
PR #${params.prId}: ${params.title}
Branch: ${params.sourceBranch} → ${params.destBranch}
Failing pipeline status key: ${params.failingStatusKey}

Investigate before deciding: look at the failing pipeline's steps and logs for branch
${params.sourceBranch}. Identify which STEP actually failed and anchor on its real error
(other steps may have passed — ignore noise from steps that succeeded). If you can, also
check how many times this pipeline has already failed for this PR.

Decide:
  - retrigger: a genuinely TRANSIENT failure (one-off network blip, runner timeout) that
    a fresh run would clear.
  - rebase: the branch is behind ${params.destBranch} and picking up recent changes fixes it.
  - flag: a DETERMINISTIC failure re-running won't fix (compile/type errors, real test
    failures, an unresolvable/forbidden dependency, config/infra validation).

Guidance:
  - A failure that has already reproduced across multiple runs is NOT transient — flag it.
  - Recurring package-registry errors (e.g. HTTP 404 "Package not found") are an
    auth/availability problem, NOT transient — flag, do not retrigger.
  - Only choose retrigger when you can name a specific transient cause.

Reply with ONLY a JSON object — no prose before or after:
{"decision":"retrigger|rebase|flag","confidence":<0-1>,"reason":"<one sentence>","action_hint":"<what to do>"}`;

  const text = await askRovoDev(prompt);
  return parseDecision(text);
}

/** Ask Rovo Dev to rebase a branch onto its destination. Returns the response text for logging. */
export async function rebasePr(params: {
  repo: string;
  prId: number;
  sourceBranch: string;
  destBranch: string;
}): Promise<string> {
  const prompt = `The Renovate PR #${params.prId} in ${params.repo} needs to be rebased onto ${params.destBranch} to pick up recent changes.
Source branch: ${params.sourceBranch}

Please rebase branch ${params.sourceBranch} onto ${params.destBranch} in the repository ${params.repo} and push the result.
If you cannot push (e.g. no git credentials), describe exactly what commands would be needed and why it failed.`;

  return askRovoDev(prompt);
}
