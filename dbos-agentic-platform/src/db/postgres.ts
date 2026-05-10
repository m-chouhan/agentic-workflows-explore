/**
 * Postgres connection pool for business data.
 * Business tables live in the same database as DBOS system state.
 * On first call to ensureSchema(), we run schema.sql to create tables if needed.
 */
import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { getDatabaseUrl, getPoolMax } from "../config";

let _pool: Pool | undefined;
let _schemaApplied = false;

export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: getDatabaseUrl(), max: getPoolMax() });
  return _pool;
}

/** Run schema.sql once to ensure all tables + indexes exist. */
export async function ensureSchema(): Promise<void> {
  if (_schemaApplied) return;
  const schemaPath = path.join(__dirname, "schema.sql");
  try {
    const schema = fs.readFileSync(schemaPath, "utf8");
    await getPool().query(schema);
    _schemaApplied = true;
  } catch (err) {
    _schemaApplied = false;
    throw new Error(`Failed to apply schema from ${schemaPath}: ${(err as Error).message}`);
  }
}

/** Graceful shutdown — drain the pool. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _schemaApplied = false;
  }
}

/** Run a parameterised query and return rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

/** Run a query and return first row or undefined. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}
