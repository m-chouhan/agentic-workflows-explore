export const QUEUE_NAME = "bitbucket-pr-autofix-queue";
export const WORKFLOW_NAME = "bitbucketPrAutofix";

// Polling cadence for retriggered pipelines. Tuned for typical CI: 30s between
// polls, ~15 min hard ceiling. The loop sleeps via DBOS.sleep so it survives
// worker restarts without holding resources.
export const POLL_INTERVAL_MS = 30_000;
export const MAX_POLLS = 30;

// Build states that we consider a "failing PR" worth retriggering.
export const FAILED_BUILD_STATES = new Set(["FAILED", "STOPPED"]);
