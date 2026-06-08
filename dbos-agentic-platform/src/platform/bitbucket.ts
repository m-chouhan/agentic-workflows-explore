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
