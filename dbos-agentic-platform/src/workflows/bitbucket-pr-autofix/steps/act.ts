import { triggerPrPipeline } from "../../../platform/bitbucket";
import { rebasePr } from "../../../platform/rovodev";
import type { TriageDecision } from "../../../platform/rovodev";
import type { FailingRenovatePr } from "./discover";
import type { PrOutcome } from "../schemas";

// DBOS step body (wrapped by the workflow, one per PR). Carries out the triage
// decision: retrigger the PR pipeline, ask Rovo Dev to rebase, or just flag.
export async function actOnPr(
  repo: string,
  pr: FailingRenovatePr,
  decision: TriageDecision,
): Promise<PrOutcome> {
  const outcome: PrOutcome = {
    prId: pr.prId, title: pr.title, url: pr.url,
    decision: decision.decision, confidence: decision.confidence, reason: decision.reason,
    pipelineUuid: null, rebaseOutput: null,
  };

  if (decision.decision === "retrigger") {
    const pipeline = await triggerPrPipeline(repo, {
      id: pr.prId, sourceBranch: pr.sourceBranch, destBranch: pr.destBranch,
      commitHash: pr.commitHash, destCommitHash: pr.destCommitHash,
    });
    outcome.pipelineUuid = pipeline.uuid;
  } else if (decision.decision === "rebase") {
    outcome.rebaseOutput = await rebasePr({
      repo, prId: pr.prId, sourceBranch: pr.sourceBranch, destBranch: pr.destBranch,
    });
  }

  return outcome;
}
