import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { listOpenPullRequests, getPrBuildStatuses, triggerPrPipeline } from "../../platform/bitbucket";
import { triagePr, rebasePr } from "../../platform/rovodev";
import { buildPrAutofixRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME, FAILED_BUILD_STATES } from "./constants";
import type { AutofixResult } from "./schemas";

// A failing Renovate PR with enough context to triage and act on it.
interface FailingRenovatePr {
  prId: number;
  title: string;
  url: string;
  sourceBranch: string;
  destBranch: string;
  commitHash: string;
  destCommitHash: string;
  failingStatusKey: string;  // e.g. "prs:**:master"
}

// Find the first failing non-major Renovate PR (low/medium-risk patch/minor bumps).
// High-risk majors need code changes, not automation — we skip them here.
async function findFirstFailingRenovatePr(repo: string): Promise<FailingRenovatePr | null> {
  const prs = await listOpenPullRequests(repo);
  for (const pr of prs) {
    if (!pr.title.includes("[Renovate]")) continue;
    if (pr.title.includes("[major]")) continue;     // skip — needs code changes

    const statuses = await getPrBuildStatuses(repo, pr.commitHash);
    const failing = statuses.find(
      (s) => FAILED_BUILD_STATES.has(s.state) && s.key?.startsWith("prs:"),
    );
    if (failing) {
      return {
        prId: pr.id,
        title: pr.title,
        url: pr.url,
        sourceBranch: pr.sourceBranch,
        destBranch: pr.destBranch,
        commitHash: pr.commitHash,
        destCommitHash: pr.destCommitHash,
        failingStatusKey: failing.key ?? "prs:**",
      };
    }
  }
  return null;
}

async function bitbucketPrAutofix(repo: string): Promise<AutofixResult> {
  const workflowId = DBOS.workflowID ?? `pr-autofix-${Date.now()}`;
  DBOS.logger.info(`[bb-autofix] ▶ bitbucketPrAutofix(${repo})  wfId=${workflowId}`);

  // Step 1 — find a failing non-major Renovate PR
  const pr = await DBOS.runStep(
    () => findFirstFailingRenovatePr(repo),
    { name: "find-first-failing-renovate-pr" },
  );

  if (!pr) {
    DBOS.logger.info(`[bb-autofix] no failing non-major Renovate PRs in ${repo}`);
    return { workflowId, repo, prId: null, title: null, url: null, decision: "no_failing_pr", confidence: null, reason: null, pipelineUuid: null, rebaseOutput: null };
  }

  DBOS.logger.info(`[bb-autofix] found PR #${pr.prId} "${pr.title}"  status=${pr.failingStatusKey}`);
  DBOS.logger.info(`[bb-autofix] PR URL: ${pr.url}`);

  // Step 2 — triage via Rovo Dev (reads pipeline logs, returns structured decision)
  const triage = await DBOS.runStep(
    () => triagePr({ repo, prId: pr.prId, title: pr.title, sourceBranch: pr.sourceBranch, destBranch: pr.destBranch, commitHash: pr.commitHash, failingStatusKey: pr.failingStatusKey }),
    { name: "triage" },
  );

  DBOS.logger.info(
    `[bb-autofix] triage → decision=${triage.decision}  confidence=${triage.confidence}  reason=${triage.reason}`,
  );

  const base = { workflowId, repo, prId: pr.prId, title: pr.title, url: pr.url, confidence: triage.confidence, reason: triage.reason };

  // Step 3 — act on the decision
  if (triage.decision === "retrigger") {
    DBOS.logger.info(`[bb-autofix] retriggering PR pipeline for PR #${pr.prId} (${pr.sourceBranch})`);
    const pipeline = await DBOS.runStep(
      () => triggerPrPipeline(repo, { id: pr.prId, sourceBranch: pr.sourceBranch, destBranch: pr.destBranch, commitHash: pr.commitHash, destCommitHash: pr.destCommitHash }),
      { name: "retrigger", retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
    );
    DBOS.logger.info(`[bb-autofix] ✓ triggered PR pipeline ${pipeline.uuid} for PR #${pr.prId}`);
    return { ...base, decision: "retrigger", pipelineUuid: pipeline.uuid, rebaseOutput: null };
  }

  if (triage.decision === "rebase") {
    DBOS.logger.info(`[bb-autofix] asking Rovo Dev to rebase PR #${pr.prId} onto ${pr.destBranch}`);
    const output = await DBOS.runStep(
      () => rebasePr({ repo, prId: pr.prId, sourceBranch: pr.sourceBranch, destBranch: pr.destBranch }),
      { name: "rebase" },
    );
    DBOS.logger.info(`[bb-autofix] rebase response for PR #${pr.prId}:\n${output}`);
    return { ...base, decision: "rebase", pipelineUuid: null, rebaseOutput: output };
  }

  // flag — log and return for human/downstream action
  DBOS.logger.info(`[bb-autofix] flagging PR #${pr.prId}: ${triage.action_hint}`);
  return { ...base, decision: "flag", pipelineUuid: null, rebaseOutput: null };
}

const bitbucketPrAutofixWorkflow = DBOS.registerWorkflow(bitbucketPrAutofix, { name: WORKFLOW_NAME });

export const bitbucketPrAutofixModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  buildRouter: buildPrAutofixRouter,
  register: () => { void bitbucketPrAutofixWorkflow; },
};
