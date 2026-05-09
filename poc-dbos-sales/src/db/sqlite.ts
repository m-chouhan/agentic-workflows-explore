import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/sales.db";

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(SQLITE_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // Bootstrap schema (idempotent).
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  _db.exec(schema);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}
