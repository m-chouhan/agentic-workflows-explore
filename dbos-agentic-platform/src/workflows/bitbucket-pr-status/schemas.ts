// Plain TS types — this workflow is a deterministic fetch (no LLM output to validate).
import type { BitbucketPullRequest } from "../../platform/bitbucket";

export interface PrWithBuild extends BitbucketPullRequest {
  buildState: string;
  buildUrl: string | null;
}

export interface PrStatusResult {
  workflowId: string;
  repo: string;
  totalPrs: number;
  failedCount: number;
  prs: PrWithBuild[];
  status: "completed" | "failed";
}
