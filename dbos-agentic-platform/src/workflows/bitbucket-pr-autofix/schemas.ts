// Workflow output contract. DBOS persists AutofixResult as the workflow result
// (served by GET /workflow/pr-autofix/:id) — no business table.

export interface PrOutcome {
  prId: number;
  title: string;
  url: string;
  decision: "retrigger" | "rebase" | "flag";
  confidence: number;
  reason: string;
  pipelineUuid: string | null;  // set when decision=retrigger and trigger succeeded
  rebaseOutput: string | null;  // set when decision=rebase (Rovo Dev response)
}

export interface AutofixResult {
  workflowId: string;
  repo: string;
  evaluated: number;
  outcomes: PrOutcome[];
}
