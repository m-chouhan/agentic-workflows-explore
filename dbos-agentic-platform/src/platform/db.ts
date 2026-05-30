import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { getDatabaseUrl, getPoolMax } from "./config";

let _pool: Pool | undefined;
let _schemaApplied = false;

// schema.sql is one level up from platform/ (src/schema.sql).
const SCHEMA_PATH = path.join(__dirname, "..", "schema.sql");

export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: getDatabaseUrl(), max: getPoolMax() });
  return _pool;
}

export async function ensureSchema(): Promise<void> {
  if (_schemaApplied) return;
  try {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
    await getPool().query(schema);
    _schemaApplied = true;
  } catch (err) {
    _schemaApplied = false;
    throw new Error(`Failed to apply schema from ${SCHEMA_PATH}: ${(err as Error).message}`);
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _schemaApplied = false;
  }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params);
  return rows[0];
}
