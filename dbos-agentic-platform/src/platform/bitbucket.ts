// Bitbucket Cloud REST 2.0 typed wrapper. See knowledge/3p-integration-layer-lld.md.
const API_BASE = "https://api.bitbucket.org/2.0/repositories";

export interface BitbucketPullRequest {
  id: number;
  title: string;
  author: string;
  sourceBranch: string;
  destBranch: string;
  commitHash: string;     // PR head (source) commit hash
  destCommitHash: string; // destination branch head hash (needed for pipeline_pullrequest_target)
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
  destination?: { branch?: { name?: string }; commit?: { hash?: string } };
  created_on?: string;
  updated_on?: string;
  links?: { html?: { href?: string } };
}

function toPullRequest(pr: BbPrValue): BitbucketPullRequest {
  return {
    id: pr.id,
    title: pr.title ?? "(no title)",
    author: pr.author?.display_name ?? "unknown",
    sourceBranch: pr.source?.branch?.name ?? "unknown",
    destBranch: pr.destination?.branch?.name ?? "unknown",
    commitHash: pr.source?.commit?.hash ?? "",
    destCommitHash: pr.destination?.commit?.hash ?? "",
    createdOn: pr.created_on?.slice(0, 10) ?? "",
    updatedOn: pr.updated_on?.slice(0, 10) ?? "",
    url: pr.links?.html?.href ?? "",
  };
}

export type PrState = "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED" | "ALL";

/**
 * List pull requests for a repo ("workspace/slug").
 * `state` "ALL" omits the filter so any state is returned; `limit` caps pagelen.
 */
export async function listPullRequests(
  repo: string,
  opts: { state?: PrState; limit?: number } = {},
): Promise<BitbucketPullRequest[]> {
  parseRepo(repo);
  const { state = "OPEN", limit = 50 } = opts;
  const stateQuery = state === "ALL" ? "" : `state=${state}&`;
  const data = await bbGet<{ values?: BbPrValue[] }>(
    `${repo}/pullrequests?${stateQuery}pagelen=${limit}`,
  );
  return (data.values ?? []).map(toPullRequest);
}

/** List OPEN pull requests for a repo ("workspace/slug"). */
export async function listOpenPullRequests(repo: string): Promise<BitbucketPullRequest[]> {
  return listPullRequests(repo, { state: "OPEN", limit: 50 });
}

const VALID_BUILD_STATES = new Set<BitbucketBuildStatus["state"]>([
  "SUCCESSFUL", "FAILED", "INPROGRESS", "STOPPED",
]);

interface BbStatusValue {
  state?: string;
  key?: string;
  name?: string;
  url?: string;
}

function toBuildStatus(raw: BbStatusValue): BitbucketBuildStatus {
  const state = VALID_BUILD_STATES.has(raw.state as BitbucketBuildStatus["state"])
    ? (raw.state as BitbucketBuildStatus["state"])
    : "NO_BUILD";
  return { state, key: raw.key, name: raw.name, url: raw.url };
}

/**
 * All build statuses for a commit — one entry per pipeline definition
 * (e.g. prs:**:master, default, custom:trust-greenlight-pipeline).
 * Returns [] when commitHash is empty or no statuses exist.
 */
export async function getPrBuildStatuses(
  repo: string,
  commitHash: string,
): Promise<BitbucketBuildStatus[]> {
  if (!commitHash) return [];
  parseRepo(repo);
  const data = await bbGet<{ values?: BbStatusValue[] }>(
    `${repo}/commit/${commitHash}/statuses?pagelen=50`,
  );
  return (data.values ?? []).map(toBuildStatus);
}

/**
 * Worst build status for a commit: prefers the prs: pipeline (the gate that
 * blocks a PR merge) over other definitions; falls back to any FAILED/STOPPED,
 * then the first status, then NO_BUILD.
 */
export async function getBuildStatus(repo: string, commitHash: string): Promise<BitbucketBuildStatus> {
  const all = await getPrBuildStatuses(repo, commitHash);
  if (all.length === 0) return { state: "NO_BUILD" };
  const prPipeline = all.find((s) => s.key?.startsWith("prs:"));
  if (prPipeline) return prPipeline;
  return all.find((s) => s.state === "FAILED" || s.state === "STOPPED") ?? all[0];
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

/**
 * Trigger the pull-request pipeline for a PR — the pipeline definition whose status
 * key is `prs:*` and which actually gates the PR merge (a branch/default pipeline
 * trigger would run a different definition and leave the PR check red).
 *
 * The `pipeline_pullrequest_target` type is undocumented in the OpenAPI spec but
 * verified to work (HTTP 201). See knowledge/renovate-autofix-spike_20260615.md.
 */
export async function triggerPrPipeline(
  repo: string,
  pr: { id: number; sourceBranch: string; destBranch: string; commitHash: string; destCommitHash: string },
): Promise<BitbucketPipeline> {
  parseRepo(repo);
  const raw = await bbPost<BbPipelineValue>(`${repo}/pipelines/`, {
    target: {
      type: "pipeline_pullrequest_target",
      source: pr.sourceBranch,
      destination: pr.destBranch,
      destination_commit: { hash: pr.destCommitHash },
      commit: { hash: pr.commitHash },
      pullrequest: { id: pr.id },         // ⚠ one word, id as number
      selector: { type: "pull-requests", pattern: "**" },
    },
  });
  return toPipeline(raw);
}
