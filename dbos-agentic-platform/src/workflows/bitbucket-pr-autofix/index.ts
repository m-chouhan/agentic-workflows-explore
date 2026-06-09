import * as path from "path";
import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import {
  triggerPipelineForBranch,
  getPipeline,
  isPipelineTerminal,
} from "../../platform/bitbucket";
import { buildPrAutofixRouter } from "./routes";
import {
  QUEUE_NAME,
  WORKFLOW_NAME,
  POLL_INTERVAL_MS,
  MAX_POLLS,
} from "./constants";
import {
  discoverFailingPrs,
  reuseFailingPrsFromStatusRun,
} from "./steps/resolveFailingPrs";
import { upsertAutofixRun, upsertAutofixAttempt } from "./steps/persist";
import type {
  AutofixInput,
  AutofixResult,
  AutofixAttempt,
  FailingPr,
} from "./schemas";

interface ResolvedFailing {
  repo: string;
  source: "discover" | "reuse";
  statusWorkflowId: string | null;
  failing: FailingPr[];
}

async function resolveFailing(input: AutofixInput): Promise<ResolvedFailing> {
  if (input.source === "discover") {
    const failing = await discoverFailingPrs(input.repo);
    return { repo: input.repo, source: "discover", statusWorkflowId: null, failing };
  }
  const { repo, failing } = await reuseFailingPrsFromStatusRun(input.statusWorkflowId);
  return { repo, source: "reuse", statusWorkflowId: input.statusWorkflowId, failing };
}

/**
 * Process a single failing PR: retrigger its pipeline, then poll until terminal
 * or MAX_POLLS reached. Each poll iteration sleeps via DBOS.sleep so the
 * workflow is durable across worker restarts.
 *
 * Step names are unique-per-PR to satisfy DBOS replay determinism in loops.
 */
async function processFailingPr(repo: string, pr: FailingPr): Promise<AutofixAttempt> {
  const base: AutofixAttempt = {
    prId: pr.id,
    prUrl: pr.url,
    sourceBranch: pr.sourceBranch,
    action: "retrigger",
    pipelineUuid: null,
    pipelineUrl: null,
    initialState: null,
    finalState: null,
    pollCount: 0,
    outcome: "failed",
    errorMessage: null,
  };

  let pipeline;
  try {
    pipeline = await DBOS.runStep(
      () => triggerPipelineForBranch(repo, pr.sourceBranch),
      { name: `trigger-${pr.id}`, retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
    );
  } catch (err) {
    base.errorMessage = `trigger failed: ${(err as Error).message}`;
    return base;
  }

  base.pipelineUuid = pipeline.uuid;
  base.pipelineUrl = pipeline.url;
  base.initialState = pipeline.state;
  base.finalState = pipeline.state;

  for (let i = 0; i < MAX_POLLS; i++) {
    if (isPipelineTerminal(base.finalState!)) break;
    await DBOS.sleep(POLL_INTERVAL_MS);
    const polled = await DBOS.runStep(
      () => getPipeline(repo, pipeline.uuid),
      { name: `poll-${pr.id}-${i}`, retriesAllowed: true, maxAttempts: 2, intervalSeconds: 3, backoffRate: 1 },
    );
    base.finalState = polled.state;
    base.pollCount = i + 1;
  }

  if (!isPipelineTerminal(base.finalState!)) {
    base.outcome = "timeout";
  } else if (base.finalState === "SUCCESSFUL") {
    base.outcome = "succeeded";
  } else {
    base.outcome = "failed";
    base.errorMessage = `pipeline ended in state ${base.finalState}`;
  }
  return base;
}

async function bitbucketPrAutofix(input: AutofixInput): Promise<AutofixResult> {
  const workflowId = DBOS.workflowID ?? `pr-autofix-${Date.now()}`;
  DBOS.logger.info(`[bb-autofix] ▶ start  wfId=${workflowId}  input=${JSON.stringify(input)}`);

  const resolved = await DBOS.runStep(() => resolveFailing(input), { name: "resolve-failing" });
  const { repo, source, statusWorkflowId, failing } = resolved;
  DBOS.logger.info(`[bb-autofix] resolved ${failing.length} failing PRs in ${repo}`);

  // Persist the initial "running" row so observers can see progress.
  await DBOS.runStep(
    () => upsertAutofixRun({
      workflowId, repo, source, statusWorkflowId,
      totalFailing: failing.length,
      attempted: 0, succeeded: 0, failed: 0, timedOut: 0, skipped: 0,
      status: "running", finishedAt: null,
    }),
    { name: "persist-run-start" },
  );

  const attempts: AutofixAttempt[] = [];
  let succeeded = 0;
  let failed = 0;
  let timedOut = 0;

  for (const pr of failing) {
    DBOS.logger.info(`[bb-autofix] ▶ PR #${pr.id} (${pr.sourceBranch})`);
    const attempt = await processFailingPr(repo, pr);
    attempts.push(attempt);

    if (attempt.outcome === "succeeded") succeeded++;
    else if (attempt.outcome === "timeout") timedOut++;
    else if (attempt.outcome === "failed") failed++;

    await DBOS.runStep(
      () => upsertAutofixAttempt(workflowId, attempt, new Date().toISOString()),
      { name: `persist-attempt-${pr.id}` },
    );

    DBOS.logger.info(
      `[bb-autofix] ✓ PR #${pr.id} outcome=${attempt.outcome} polls=${attempt.pollCount} finalState=${attempt.finalState}`,
    );
  }

  await DBOS.runStep(
    () => upsertAutofixRun({
      workflowId, repo, source, statusWorkflowId,
      totalFailing: failing.length,
      attempted: attempts.length,
      succeeded, failed, timedOut, skipped: 0,
      status: "completed",
      finishedAt: new Date().toISOString(),
    }),
    { name: "persist-run-end" },
  );

  DBOS.logger.info(
    `[bb-autofix] ✓ done  wfId=${workflowId}  attempted=${attempts.length}  ok=${succeeded}  fail=${failed}  timeout=${timedOut}`,
  );

  return {
    workflowId, repo, source, statusWorkflowId,
    totalFailing: failing.length,
    attempted: attempts.length,
    succeeded, failed, timedOut, skipped: 0,
    attempts,
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
