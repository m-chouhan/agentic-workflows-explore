export const QUEUE_NAME = "bitbucket-pr-autofix-queue";
export const WORKFLOW_NAME = "bitbucketPrAutofix";

// Build states that mark a PR as failing — i.e. worth retriggering.
export const FAILED_BUILD_STATES = new Set(["FAILED", "STOPPED"]);

// Max failing PRs to triage per run.
export const MAX_TRIAGE_PRS = 10;
