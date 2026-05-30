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

// Each workflow module owns its schema.sql and passes its path here.
// Idempotent: a path is only applied once per process lifetime.
export async function ensureSchema(schemaPaths: string[]): Promise<void> {
  for (const schemaPath of schemaPaths) {
    if (_appliedSchemas.has(schemaPath)) continue;
    try {
      const schema = fs.readFileSync(schemaPath, "utf8");
      await getPool().query(schema);
      _appliedSchemas.add(schemaPath);
    } catch (err) {
      throw new Error(`Failed to apply schema from ${schemaPath}: ${(err as Error).message}`);
    }
  }
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
