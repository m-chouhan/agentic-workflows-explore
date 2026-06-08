import { Pool } from "pg";
import * as fs from "fs";
import { getDatabaseUrl, getPoolMax } from "./config";

let _pool: Pool | undefined;
const _appliedSchemas = new Set<string>();

export function getPool(): Pool {
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: getDatabaseUrl(), max: getPoolMax() });
  return _pool;
}

// Stable bigint key for the cross-process DDL mutex. Any constant works as long as
// every process that runs ensureSchema() uses the same value.
const SCHEMA_LOCK_KEY = 4242_4242;

async function withSchemaLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    // Acquire: block until no other process holds the schema lock
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    
    // Process: run the critical section
    return await fn();
  } finally {
    // Release: always unlock, even on errors
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// Each workflow module owns its schema.sql and passes its path here.
// Idempotent in two ways:
//   1. Per-process:  _appliedSchemas skips re-running the same file in the same process.
//   2. Cross-process: withSchemaLock serializes DDL across server + worker so they
//      don't race on CREATE INDEX IF NOT EXISTS (which is not atomic in Postgres).
export async function ensureSchema(schemaPaths: string[]): Promise<void> {
  const pending = schemaPaths.filter((p) => !_appliedSchemas.has(p));
  if (pending.length === 0) return;

  await withSchemaLock(async () => {
    for (const schemaPath of pending) {
      if (_appliedSchemas.has(schemaPath)) continue; // raced inside this process
      const schema = fs.readFileSync(schemaPath, "utf8");
      await getPool().query(schema);
      _appliedSchemas.add(schemaPath);
    }
  });
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
    _appliedSchemas.clear();
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
