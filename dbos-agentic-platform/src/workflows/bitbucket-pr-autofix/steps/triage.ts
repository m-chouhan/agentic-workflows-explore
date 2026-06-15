import { triagePr } from "../../../platform/rovodev";
import type { TriageDecision } from "../../../platform/rovodev";
import type { FailingRenovatePr } from "./discover";

export interface Triaged {
  pr: FailingRenovatePr;
  decision: TriageDecision;
}

// DBOS step body (wrapped by the workflow, one per PR). Hands the PR to Rovo Dev,
// which investigates the failing pipeline's steps/logs itself and returns a
// structured retrigger/rebase/flag decision.
export async function triagePrStep(repo: string, pr: FailingRenovatePr): Promise<TriageDecision> {
  return triagePr({
    repo,
    prId: pr.prId,
    title: pr.title,
    sourceBranch: pr.sourceBranch,
    destBranch: pr.destBranch,
    failingStatusKey: pr.failingStatusKey,
  });
}
