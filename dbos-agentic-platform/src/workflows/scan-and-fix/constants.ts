export const QUEUE_NAME = "vuln-queue";
export const WORKFLOW_NAME = "scanAndFix";

// Max findings sent to the triage LLM. Full raw findings are always persisted.
// Ordered by: critical → high → medium → low, then fixable-first within each tier.
export const TRIAGE_LIMIT = 10;
