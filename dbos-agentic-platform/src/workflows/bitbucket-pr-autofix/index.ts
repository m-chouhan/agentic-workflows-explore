import { DBOS } from "@dbos-inc/dbos-sdk";
import type { WorkflowModule } from "../../platform/types";
import { buildPrAutofixRouter } from "./routes";
import { QUEUE_NAME, WORKFLOW_NAME, MAX_TRIAGE_PRS } from "./constants";
import { discoverFailingPrs } from "./steps/discover";
import { triagePrStep, type Triaged } from "./steps/triage";
import { actOnPr } from "./steps/act";
import type { AutofixResult, PrOutcome } from "./schemas";

// Orchestration only — each DBOS.runStep call below maps to one step body in steps/.
// discover runs once; triage and act run once per PR (own step, own memoization).
async function bitbucketPrAutofix(repo: string): Promise<AutofixResult> {
  const workflowId = DBOS.workflowID ?? `pr-autofix-${Date.now()}`;
  DBOS.logger.info(`[bb-autofix] ▶ bitbucketPrAutofix(${repo})  wfId=${workflowId}`);

  const prs = await DBOS.runStep(
    () => discoverFailingPrs(repo, MAX_TRIAGE_PRS),
    { name: "discover" },
  );
  DBOS.logger.info(`[bb-autofix] ${prs.length} failing non-major Renovate PRs to triage`);

  const triaged: Triaged[] = [];
  for (const pr of prs) {
    DBOS.logger.info(`[bb-autofix] ▶ PR #${pr.prId} "${pr.title}"  ${pr.url}`);
    const decision = await DBOS.runStep(() => triagePrStep(repo, pr), { name: `triage-${pr.prId}` });
    DBOS.logger.info(`[bb-autofix] PR #${pr.prId} → ${decision.decision} (conf=${decision.confidence})  ${decision.reason}`);
    triaged.push({ pr, decision });
  }

  const outcomes: PrOutcome[] = [];
  for (const { pr, decision } of triaged) {
    const outcome = await DBOS.runStep(() => actOnPr(repo, pr, decision), { name: `act-${pr.prId}` });
    outcomes.push(outcome);
  }

  const summary = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.decision] = (acc[o.decision] ?? 0) + 1;
    return acc;
  }, {});
  DBOS.logger.info(`[bb-autofix] ✓ done  evaluated=${outcomes.length}  ${JSON.stringify(summary)}`);

  return { workflowId, repo, evaluated: outcomes.length, outcomes };
}

const bitbucketPrAutofixWorkflow = DBOS.registerWorkflow(bitbucketPrAutofix, { name: WORKFLOW_NAME });

export const bitbucketPrAutofixModule: WorkflowModule = {
  name: WORKFLOW_NAME,
  queueName: QUEUE_NAME,
  buildRouter: buildPrAutofixRouter,
  register: () => { void bitbucketPrAutofixWorkflow; },
};
