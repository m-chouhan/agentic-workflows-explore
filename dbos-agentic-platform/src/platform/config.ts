// These are functions, not top-level constants, so loadEnv() has already run before values are read.
// Workflow-specific constants (queue names, workflow names) live in each workflow module's constants.ts.

import * as dotenv from "dotenv";

/**
 * Load environment from the single `.env` file. Call once at process startup,
 * before any config getter runs.
 *
 * The app ONLY ever knows about `.env`. Choosing which environment to run is a
 * deployment concern: copy the desired source into place first, e.g.
 *   cp .env.local .env   (local dev)
 *   cp .env.stg   .env   (staging)
 *   cp .env.prod  .env   (production)
 * Values already in process.env (e.g. injected by Docker) are never overwritten.
 */
export function loadEnv(): void {
  dotenv.config();
}

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
