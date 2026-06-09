// Bitbucket Cloud REST 2.0 typed wrapper. See knowledge/3p-integration-layer-lld.md.
const API_BASE = "https://api.bitbucket.org/2.0/repositories";

export interface BitbucketPullRequest {
  id: number;
  title: string;
  author: string;
  sourceBranch: string;
  destBranch: string;
  commitHash: string;
  createdOn: string;
  updatedOn: string;
  url: string;
}

export interface BitbucketBuildStatus {
  state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED" | "NO_BUILD";
  key?: string;
  name?: string;
  url?: string;
}

function getBitbucketToken(): string {
  const token = process.env.BITBUCKET_TOKEN;
  if (!token) {
    throw new Error(
      "Missing BITBUCKET_TOKEN. Set a Bitbucket repo/workspace HTTP access token " +
      "(used as a Bearer token for the Bitbucket Cloud REST API).",
    );
  }
  return token;
}

async function bbGet<T>(pathAndQuery: string): Promise<T> {
  const url = `${API_BASE}/${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getBitbucketToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bitbucket API ${res.status} for ${url}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** Validate and split a "workspace/slug" repo identifier. */
export function parseRepo(fullName: string): { workspace: string; slug: string } {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repo format: "${fullName}". Expected "workspace/slug".`);
  }
  return { workspace: parts[0], slug: parts[1] };
}

interface BbPrValue {
  id: number;
  title?: string;
  author?: { display_name?: string };
  source?: { branch?: { name?: string }; commit?: { hash?: string } };
  destination?: { branch?: { name?: string } };
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href?: string } };
}

/** List OPEN pull requests for a repo ("workspace/slug"). */
export async function listOpenPullRequests(repo: string): Promise<BitbucketPullRequest[]> {
  parseRepo(repo);
  const data = await bbGet<{ values?: BbPrValue[] }>(
    `${repo}/pullrequests?state=OPEN&pagelen=50`,
  );
  return (data.values ?? []).map((pr) => ({
    id: pr.id,
    title: pr.title ?? "(no title)",
    author: pr.author?.display_name ?? "unknown",
    sourceBranch: pr.source?.branch?.name ?? "unknown",
    destBranch: pr.destination?.branch?.name ?? "unknown",
    commitHash: pr.source?.commit?.hash ?? "",
    createdOn: pr.created_on?.slice(0, 10) ?? "",
    updatedOn: pr.updated_on?.slice(0, 10) ?? "",
    url: pr.links?.html?.href ?? "",
  }));
}

interface BbStatusValue {
  state?: string;
  key?: string;
  name?: string;
  url?: string;
}

/** Latest build status for a commit. Returns NO_BUILD if none / no commit. */
export async function getBuildStatus(repo: string, commitHash: string): Promise<BitbucketBuildStatus> {
  if (!commitHash) return { state: "NO_BUILD" };
  parseRepo(repo);
  const data = await bbGet<{ values?: BbStatusValue[] }>(
    `${repo}/commit/${commitHash}/statuses?pagelen=10`,
  );
  const latest = (data.values ?? [])[0];
  if (!latest) return { state: "NO_BUILD" };
  const validStates: BitbucketBuildStatus["state"][] = [
    "SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED",
  ];
  const state = validStates.includes(latest.state as BitbucketBuildStatus["state"])
    ? (latest.state as BitbucketBuildStatus["state"])
    : "NO_BUILD";
  return { state, key: latest.key, name: latest.name, url: latest.url };
}

// ── Pipelines API ──────────────────────────────────────────────────────────
//
// Bitbucket Pipelines: a triggered build has a `state` envelope and (when
// completed) a nested `result`. Terminal states are SUCCESSFUL / FAILED /
// STOPPED / ERROR; in-flight states are PENDING / IN_PROGRESS.

export type BitbucketPipelineState =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCESSFUL"
  | "FAILED"
  | "STOPPED"
  | "ERROR";

export interface BitbucketPipeline {
  uuid: string;            // includes braces from the API
  buildNumber: number;
  state: BitbucketPipelineState;
  url: string;             // human-friendly URL on bitbucket.org
}

interface BbPipelineValue {
  uuid?: string;
  build_number?: number;
  state?: { name?: string; result?: { name?: string } };
  links?: { html?: { href?: string } };
}

async function bbPost<T>(pathAndQuery: string, body: unknown): Promise<T> {
  const url = `${API_BASE}/${pathAndQuery}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getBitbucketToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bitbucket API ${res.status} for ${url}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** Normalise Bitbucket's nested state/result envelope into a flat state. */
function flattenPipelineState(raw: BbPipelineValue): BitbucketPipelineState {
  const stateName = raw.state?.name ?? "";
  if (stateName === "COMPLETED") {
    const result = raw.state?.result?.name ?? "";
    if (result === "SUCCESSFUL" || result === "FAILED" || result === "STOPPED" || result === "ERROR") {
      return result;
    }
    return "FAILED"; // unknown completed result — treat as failed
  }
  if (stateName === "IN_PROGRESS") return "IN_PROGRESS";
  return "PENDING"; // PENDING, HALTED, or anything pre-running
}

function toPipeline(raw: BbPipelineValue): BitbucketPipeline {
  return {
    uuid: raw.uuid ?? "",
    buildNumber: raw.build_number ?? 0,
    state: flattenPipelineState(raw),
    url: raw.links?.html?.href ?? "",
  };
}

/** Trigger an on-demand pipeline for a branch (the PR's source branch). */
export async function triggerPipelineForBranch(repo: string, branch: string): Promise<BitbucketPipeline> {
  parseRepo(repo);
  const raw = await bbPost<BbPipelineValue>(`${repo}/pipelines/`, {
    target: { ref_type: "branch", type: "pipeline_ref_target", ref_name: branch },
  });
  return toPipeline(raw);
}

/** Get the current state of a pipeline by UUID (include braces, as returned by Bitbucket). */
export async function getPipeline(repo: string, uuid: string): Promise<BitbucketPipeline> {
  parseRepo(repo);
  const encoded = encodeURIComponent(uuid);
  const raw = await bbGet<BbPipelineValue>(`${repo}/pipelines/${encoded}`);
  return toPipeline(raw);
}

const TERMINAL_PIPELINE_STATES = new Set<BitbucketPipelineState>([
  "SUCCESSFUL", "FAILED", "STOPPED", "ERROR",
]);

export function isPipelineTerminal(state: BitbucketPipelineState): boolean {
  return TERMINAL_PIPELINE_STATES.has(state);
}
