// Rovo Dev serve-mode client.
// Requires `acli rovodev serve <port>` running on the host before the workflow starts.
// ROVO_DEV_URL  — e.g. http://host.docker.internal:4000  (Docker) or http://localhost:4000
// ROVO_DEV_TOKEN — bearer token printed by `acli rovodev serve` on startup

export interface TriageDecision {
  decision: "retrigger" | "rebase" | "flag";
  confidence: number;
  reason: string;
  action_hint: string;
}

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

/** Reset the Rovo Dev session. Call before each new PR so context from a prior run doesn't bleed. */
export async function resetRovoDev(): Promise<void> {
  const res = await fetch(`${getRovoDevBase()}/v2/reset`, { method: "POST", headers: authHeader() });
  if (!res.ok) throw new Error(`Rovo Dev reset failed: ${res.status}`);
}

/** Consume the SSE stream from /v2/chat and reassemble all text content. */
async function consumeSSE(res: Response): Promise<string> {
  const raw = await res.text();
  let content = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const d = JSON.parse(line.slice(5));
      if (d.event_kind === "part_delta") content += d.delta?.content_delta ?? "";
    } catch { /* skip malformed lines */ }
  }
  return content;
}

/** Extract the first JSON object from Rovo Dev prose output. */
function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON found in Rovo Dev response. Raw:\n${text.slice(0, 500)}`);
  return JSON.parse(match[0]);
}

/**
 * Send a prompt to the running Rovo Dev serve instance and return the response text.
 * Resets session first so prior conversation context doesn't affect the result.
 */
export async function askRovoDev(prompt: string): Promise<string> {
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
  commitHash: string;
  failingStatusKey: string;
}): Promise<TriageDecision> {
  const prompt = `Analyze this failing Bitbucket PR and decide what action to take.

Repo: ${params.repo}
PR #${params.prId}: ${params.title}
Branch: ${params.sourceBranch} → ${params.destBranch}
Head commit: ${params.commitHash}
Failing pipeline status key: ${params.failingStatusKey}

Fetch the pipeline steps and logs for the most recent failed pipeline on branch ${params.sourceBranch}.
Based on the actual failure reason, decide:
  - retrigger: flaky CI, re-running the pipeline should pass
  - rebase: the branch is behind ${params.destBranch} and picking up recent changes should fix it
  - flag: needs human or deeper intervention (broken binary, real test failure, etc.)

Reply with ONLY a JSON object — no prose before or after:
{"decision":"retrigger|rebase|flag","confidence":<0-1>,"reason":"<one sentence>","action_hint":"<what to do>"}`;

  const text = await askRovoDev(prompt);
  console.log(`[rovodev] triage response for PR #${params.prId}:\n${text}`);
  return extractJson(text) as TriageDecision;
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
