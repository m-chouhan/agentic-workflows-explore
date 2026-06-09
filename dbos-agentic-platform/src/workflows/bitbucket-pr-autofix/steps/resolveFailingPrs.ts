import { queryOne } from "../../../platform/db";
import { listOpenPullRequests, getBuildStatus } from "../../../platform/bitbucket";
import { FAILED_BUILD_STATES } from "../constants";
import type { FailingPr } from "../schemas";

interface PrStatusRow {
  repo: string;
  prs_json: string;
}

/**
 * Re-discover failing PRs for a repo by calling Bitbucket directly.
 * Self-contained: does not depend on any prior status run.
 */
export async function discoverFailingPrs(repo: string): Promise<FailingPr[]> {
  const prs = await listOpenPullRequests(repo);
  const failing: FailingPr[] = [];
  for (const pr of prs) {
    const build = await getBuildStatus(repo, pr.commitHash);
    if (FAILED_BUILD_STATES.has(build.state)) {
      failing.push({ ...pr, buildState: build.state, buildUrl: build.url ?? null });
    }
  }
  return failing;
}

/**
 * Reuse failing PRs persisted by a prior `bitbucketPrStatus` run.
 * Returns { repo, failing } so the caller knows which repo the run targeted.
 */
export async function reuseFailingPrsFromStatusRun(
  statusWorkflowId: string,
): Promise<{ repo: string; failing: FailingPr[] }> {
  const row = await queryOne<PrStatusRow>(
    `SELECT repo, prs_json FROM pr_status_runs WHERE workflow_id = $1`,
    [statusWorkflowId],
  );
  if (!row) {
    throw new Error(`pr_status_runs row not found for workflow_id="${statusWorkflowId}"`);
  }
  const all = JSON.parse(row.prs_json) as FailingPr[];
  const failing = all.filter((p) => FAILED_BUILD_STATES.has(p.buildState));
  return { repo: row.repo, failing };
}
