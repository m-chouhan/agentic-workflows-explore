// Plain TS types — this workflow is a deterministic action loop (no LLM output to validate).
import type { BitbucketPipelineState } from "../../platform/bitbucket";
import type { PrWithBuild } from "../bitbucket-pr-status/schemas";

export type AutofixInput =
  | { source: "discover"; repo: string }
  | { source: "reuse"; statusWorkflowId: string };

export type AttemptAction = "retrigger"; // future: "rebase" | "code-change"

export type AttemptOutcome =
  | "succeeded"   // pipeline completed SUCCESSFUL
  | "failed"      // pipeline completed FAILED/STOPPED/ERROR
  | "timeout"    // polled MAX_POLLS times without a terminal state
  | "skipped";    // PR was no longer failing by the time we got to it

export interface AutofixAttempt {
  prId: number;
  prUrl: string;
  sourceBranch: string;
  action: AttemptAction;
  pipelineUuid: string | null;     // null if trigger failed
  pipelineUrl: string | null;
  initialState: BitbucketPipelineState | null;
  finalState: BitbucketPipelineState | null;
  pollCount: number;
  outcome: AttemptOutcome;
  errorMessage: string | null;
}

export interface AutofixResult {
  workflowId: string;
  repo: string;
  source: "discover" | "reuse";
  statusWorkflowId: string | null;
  totalFailing: number;
  attempted: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  skipped: number;
  attempts: AutofixAttempt[];
  status: "completed" | "failed";
}

// Re-exported for convenience; the resolve step returns this shape.
export type FailingPr = PrWithBuild;
