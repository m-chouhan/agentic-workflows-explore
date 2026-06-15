// Plain TS types — this workflow is a deterministic discover-and-retrigger pass.

export interface Retrigger {
  prId: number;
  url: string;
  sourceBranch: string;
  buildState: string;          // the failing state we observed
  pipelineUuid: string | null; // set when the retrigger succeeds
  pipelineUrl: string | null;
  triggered: boolean;
  error: string | null;
}

export interface AutofixResult {
  workflowId: string;
  repo: string;
  totalFailing: number;
  triggered: number;           // how many retriggers succeeded
  retriggers: Retrigger[];
  status: "completed";
}
