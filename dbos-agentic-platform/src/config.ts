/**
 * Shared configuration — single source of truth.
 * All values come from environment variables (set in .env for local dev).
 * Functions are used for runtime-read values to ensure dotenv.config() runs first.
 * If a required env var is missing, we throw early with a clear message.
 */

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// ── Database ─────────────────────────────────────────────────────────────────
export function getDatabaseUrl(): string {
  const host     = required("PGHOST");
  const port     = process.env.PGPORT ?? "5432";
  const user     = required("PGUSER");
  const password = required("PGPASSWORD");
  const database = required("PGDATABASE");
  return `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;
}

// ── Queue names ──────────────────────────────────────────────────────────────
export const VULN_QUEUE_NAME = process.env.VULN_QUEUE_NAME ?? "vuln-queue";

// ── Workflow names (must match DBOS.registerWorkflow({ name })) ──────────────
export const SCAN_AND_FIX_WORKFLOW = "scanAndFix";

// ── LLM model ─────────────────────────────────────────────────────────────────
export function getModel(): string {
  return required("GOOGLE_MODEL");
}

// ── Database pool ─────────────────────────────────────────────────────────────
export function getPoolMax(): number {
  return parseInt(process.env.DB_POOL_MAX ?? "10", 10);
}
