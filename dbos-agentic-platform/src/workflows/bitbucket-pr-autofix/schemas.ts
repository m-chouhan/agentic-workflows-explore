// Plain TS type. DBOS persists this as the workflow output — no business table.

export interface AutofixResult {
  workflowId: string;
  repo: string;
  triggered: boolean;          // false when no failing PR was found
  prId: number | null;
  sourceBranch: string | null;
  url: string | null;
  pipelineUuid: string | null;
}
