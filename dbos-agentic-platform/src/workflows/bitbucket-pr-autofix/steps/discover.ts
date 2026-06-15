import { listOpenPullRequests, getPrBuildStatuses } from "../../../platform/bitbucket";
import { FAILED_BUILD_STATES } from "../constants";

// A failing Renovate PR with enough context to triage and act on it.
export interface FailingRenovatePr {
  prId: number;
  title: string;
  url: string;
  sourceBranch: string;
  destBranch: string;
  commitHash: string;
  destCommitHash: string;
  failingStatusKey: string;  // e.g. "prs:**:master"
}

// DBOS step body (wrapped by the workflow). Collect up to `limit` failing
// non-major Renovate PRs. High-risk majors need code changes, not automation.
export async function discoverFailingPrs(repo: string, limit: number): Promise<FailingRenovatePr[]> {
  const prs = await listOpenPullRequests(repo);
  const failing: FailingRenovatePr[] = [];
  for (const pr of prs) {
    if (failing.length >= limit) break;
    if (!pr.title.includes("[Renovate]")) continue;
    if (pr.title.includes("[major]")) continue;

    const statuses = await getPrBuildStatuses(repo, pr.commitHash);
    const f = statuses.find((s) => FAILED_BUILD_STATES.has(s.state) && s.key?.startsWith("prs:"));
    if (f) {
      failing.push({
        prId: pr.id,
        title: pr.title,
        url: pr.url,
        sourceBranch: pr.sourceBranch,
        destBranch: pr.destBranch,
        commitHash: pr.commitHash,
        destCommitHash: pr.destCommitHash,
        failingStatusKey: f.key ?? "prs:**",
      });
    }
  }
  return failing;
}
