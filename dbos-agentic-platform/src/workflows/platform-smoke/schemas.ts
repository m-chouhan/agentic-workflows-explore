// Plain TS types — the smoke workflow is a deterministic platform canary.

export interface SmokeResult {
  workflowId: string;
  repo: string;
  // The single PR we pulled (any state), or null if the repo has none.
  prId: number | null;
  prState: string;
  persisted: boolean;
  status: "completed";
}
