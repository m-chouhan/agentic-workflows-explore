import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { listOpenPullRequests, getBuildStatus, triggerPipelineForBranch } from "../../platform/bitbucket";
import { buildPrAutofixRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME, FAILED_BUILD_STATES } from "./constants";
import type { AutofixResult } from "./schemas";

interface FailingPr {
  prId: number;
  url: string;
  sourceBranch: string;
  buildState: string;
}

async function findFirstFailingPr(repo: string): Promise<FailingPr | null> {
  const prs = await listOpenPullRequests(repo);
  for (const pr of prs) {
    const build = await getBuildStatus(repo, pr.commitHash);
    if (FAILED_BUILD_STATES.has(build.state)) {
      return { prId: pr.id, url: pr.url, sourceBranch: pr.sourceBranch, buildState: build.state };
    }
  }
  return null;
}

async function bitbucketPrAutofix(repo: string): Promise<AutofixResult> {
  const workflowId = DBOS.workflowID ?? `pr-autofix-${Date.now()}`;
  DBOS.logger.info(`[bb-autofix] ▶ bitbucketPrAutofix(${repo})  wfId=${workflowId}`);

  const pr = await DBOS.runStep(() => findFirstFailingPr(repo), { name: "find-first-failing-pr" });

  if (!pr) {
    DBOS.logger.info(`[bb-autofix] no failing PRs in ${repo} — nothing to retrigger`);
    return { workflowId, repo, triggered: false, prId: null, sourceBranch: null, url: null, pipelineUuid: null };
  }

  DBOS.logger.info(`[bb-autofix] retriggering PR #${pr.prId} (${pr.sourceBranch}) ${pr.url}  buildState=${pr.buildState}`);

  const pipeline = await DBOS.runStep(
    () => triggerPipelineForBranch(repo, pr.sourceBranch),
    { name: "retrigger", retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
  );

  DBOS.logger.info(`[bb-autofix] ✓ triggered pipeline ${pipeline.uuid} for PR #${pr.prId} (${pr.sourceBranch})`);

  return {
    workflowId,
    repo,
    triggered: true,
    prId: pr.prId,
    sourceBranch: pr.sourceBranch,
    url: pr.url,
    pipelineUuid: pipeline.uuid,
  };
}

const bitbucketPrAutofixWorkflow = DBOS.registerWorkflow(bitbucketPrAutofix, { name: WORKFLOW_NAME });

export const bitbucketPrAutofixModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  buildRouter: buildPrAutofixRouter,
  register: () => { void bitbucketPrAutofixWorkflow; },
};
