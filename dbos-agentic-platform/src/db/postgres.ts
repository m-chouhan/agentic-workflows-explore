/**
 * Postgres connection pool — replaces SQLite singleton.
 *
 * Uses the same PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars
 * that DBOS already reads for its system database. Business data lives
 * in the SAME Postgres instance (same database), just different tables.
 *
 * On first call to getPool(), we also run schema.sql to ensure tables exist.
 */
import { Pool, PoolClient } from "pg";
import * as fs from "fs";
import * as path from "path";

let _pool: Pool | undefined;
let _schemaApplied = false;

function buildConnectionString(): string {
  const host = process.env.PGHOST ?? "localhost";
  const port = process.env.PGPORT ?? "5432";
  const user = process.env.PGUSER ?? "dbos";
  const password = process.env.PGPASSWORD ?? "dbos";
  const database = process.env.PGDATABASE ?? "dbos_sales";
  return `postgresql://${user}:${password}@${host}:${port}/${database}?connect_timeout=10&sslmode=disable`;
}

export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: buildConnectionString(), max: 10 });
  return _pool;
}

/** Run schema.sql once to ensure all tables + indexes exist. */
export async function ensureSchema(): Promise<void> {
  if (_schemaApplied) return;
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  await getPool().query(schema);
  _schemaApplied = true;
}

/** Graceful shutdown — drain the pool. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _schemaApplied = false;
  }
}

/** Convenience: run a single parameterised query and return rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

/** Convenience: run a query and return first row or undefined. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}
