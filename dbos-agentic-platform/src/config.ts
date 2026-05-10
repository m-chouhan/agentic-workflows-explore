/**
 * Shared configuration constants.
 * Single source of truth for queue names, model defaults, and other settings
 * that are referenced across server, worker, routes, and agents.
 */

// ── Queue names ──────────────────────────────────────────────────────────────
export const ANALYSIS_QUEUE_NAME = process.env.ANALYSIS_QUEUE_NAME ?? "analysis-queue";
export const VULN_QUEUE_NAME = process.env.VULN_QUEUE_NAME ?? "vuln-queue";

// ── Workflow names (must match DBOS.registerWorkflow({ name })) ──────────────
export const ANALYZE_YEAR_WORKFLOW = "analyzeYear";
export const SCAN_AND_FIX_WORKFLOW = "scanAndFix";

// ── LLM model ────────────────────────────────────────────────────────────────
export const DEFAULT_MODEL = process.env.GOOGLE_MODEL ?? "gemini-flash-latest";

// ── Database pool ────────────────────────────────────────────────────────────
export const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? "10", 10);
