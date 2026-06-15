import * as path from "path";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { listOpenPullRequests, getBuildStatus, triggerPipelineForBranch } from "../../platform/bitbucket";
import { buildPrAutofixRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME, FAILED_BUILD_STATES } from "./constants";
import { writeAutofixRun } from "./steps/persist";
import type { AutofixResult, Retrigger } from "./schemas";

async function findFailingPrs(repo: string): Promise<Retrigger[]> {
  const prs = await listOpenPullRequests(repo);
  const failing: Retrigger[] = [];
  for (const pr of prs) {
    const build = await getBuildStatus(repo, pr.commitHash);
    if (FAILED_BUILD_STATES.has(build.state)) {
      failing.push({
        prId: pr.id,
        url: pr.url,
        sourceBranch: pr.sourceBranch,
        buildState: build.state,
        pipelineUuid: null,
        pipelineUrl: null,
        triggered: false,
        error: null,
      });
    }
  }
  return failing;
}

async function bitbucketPrAutofix(repo: string): Promise<AutofixResult> {
  const workflowId = DBOS.workflowID ?? `pr-autofix-${Date.now()}`;
  DBOS.logger.info(`[bb-autofix] ▶ bitbucketPrAutofix(${repo})  wfId=${workflowId}`);

  const failing = await DBOS.runStep(() => findFailingPrs(repo), { name: "find-failing-prs" });
  DBOS.logger.info(`[bb-autofix] ${failing.length} failing PRs`);

  for (const pr of failing) {
    try {
      const pipeline = await DBOS.runStep(
        () => triggerPipelineForBranch(repo, pr.sourceBranch),
        { name: `retrigger-${pr.prId}`, retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
      );
      pr.pipelineUuid = pipeline.uuid;
      pr.pipelineUrl = pipeline.url;
      pr.triggered = true;
    } catch (err) {
      pr.error = (err as Error).message;
    }
  }

  const triggered = failing.filter((p) => p.triggered).length;

  await DBOS.runStep(
    () => writeAutofixRun(workflowId, repo, failing.length, triggered, failing),
    { name: "persist" },
  );

  DBOS.logger.info(`[bb-autofix] ✓ done  wfId=${workflowId}  failing=${failing.length}  triggered=${triggered}`);
  return {
    workflowId,
    repo,
    totalFailing: failing.length,
    triggered,
    retriggers: failing,
    status: "completed",
  };
}

const bitbucketPrAutofixWorkflow = DBOS.registerWorkflow(bitbucketPrAutofix, { name: WORKFLOW_NAME });

export const bitbucketPrAutofixModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  schemaPath: path.join(__dirname, "schema.sql"),
  buildRouter: buildPrAutofixRouter,
  register: () => { void bitbucketPrAutofixWorkflow; },
};
