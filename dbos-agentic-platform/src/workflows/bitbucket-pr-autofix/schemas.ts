// Plain TS types. DBOS persists AutofixResult as the workflow output — no business table.

export type { TriageDecision } from "../../platform/rovodev";

export interface AutofixResult {
  workflowId: string;
  repo: string;
  prId: number | null;
  title: string | null;
  url: string | null;
  decision: "retrigger" | "rebase" | "flag" | "no_failing_pr";
  confidence: number | null;
  reason: string | null;
  pipelineUuid: string | null;  // set when decision=retrigger and trigger succeeded
  rebaseOutput: string | null;  // set when decision=rebase (Rovo Dev response)
}
