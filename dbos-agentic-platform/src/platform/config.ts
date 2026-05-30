// These are functions, not top-level constants, so dotenv.config() has already run before values are read.
// Workflow-specific constants (queue names, workflow names) live in each workflow module's constants.ts.

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

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

export function getModel(): string {
  return required("GOOGLE_MODEL");
}
