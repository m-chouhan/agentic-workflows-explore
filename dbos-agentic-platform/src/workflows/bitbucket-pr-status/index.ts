import * as path from "path";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { listOpenPullRequests, getBuildStatus } from "../../platform/bitbucket";
import { buildPrStatusRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME } from "./constants";
import { writePrStatus } from "./steps/persist";
import type { PrStatusResult, PrWithBuild } from "./schemas";

const FAILED_STATES = new Set(["FAILED", "STOPPED"]);

async function bitbucketPrStatus(repo: string): Promise<PrStatusResult> {
  const workflowId = DBOS.workflowID ?? `pr-status-${Date.now()}`;
  DBOS.logger.info(`[bb-pr] ▶ bitbucketPrStatus(${repo})  wfId=${workflowId}`);

  const prs = await DBOS.runStep(() => listOpenPullRequests(repo), { name: "fetch-prs" });
  DBOS.logger.info(`[bb-pr] ${prs.length} open PRs`);

  const prsWithBuild: PrWithBuild[] = [];
  for (const pr of prs) {
    const build = await DBOS.runStep(

      () => getBuildStatus(repo, pr.commitHash),
      { name: `build-${pr.id}`, retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
    );
    prsWithBuild.push({ ...pr, buildState: build.state, buildUrl: build.url ?? null });
  }

  const failedCount = prsWithBuild.filter((p) => FAILED_STATES.has(p.buildState)).length;

  await DBOS.runStep(
    () => writePrStatus(workflowId, repo, prsWithBuild, failedCount, "completed"),
    { name: "persist" },
  );

  DBOS.logger.info(`[bb-pr] ✓ done  wfId=${workflowId}  prs=${prsWithBuild.length}  failed=${failedCount}`);
  return {
    workflowId,
    repo,
    totalPrs: prsWithBuild.length,
    failedCount,
    prs: prsWithBuild,
    status: "completed",
  };
}

const bitbucketPrStatusWorkflow = DBOS.registerWorkflow(bitbucketPrStatus, { name: WORKFLOW_NAME });

export const bitbucketPrStatusModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  schemaPath: path.join(__dirname, "schema.sql"),
  buildRouter: buildPrStatusRouter,
  register: () => { void bitbucketPrStatusWorkflow; },
};
