/**
 * Shared platform configuration — single source of truth for infra-level values.
 * All values come from environment variables (set in .env for local dev).
 * Functions are used for runtime-read values to ensure dotenv.config() runs first.
 * Workflow-specific constants (queue names, workflow names) live inside each
 * workflow module, NOT here.
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

export function getPoolMax(): number {
  return parseInt(process.env.DB_POOL_MAX ?? "10", 10);
}

// ── LLM ───────────────────────────────────────────────────────────────────────
export function getModel(): string {
  return required("GOOGLE_MODEL");
}
