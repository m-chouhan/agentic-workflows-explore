-- Business-data schema (SQLite)
-- Read-side: sales (one row per order line)
-- Write-side: sales_insights (one row per analysis run)

CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date    TEXT    NOT NULL,           -- ISO yyyy-mm-dd
  product       TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  region        TEXT    NOT NULL,
  units         INTEGER NOT NULL,
  unit_price    REAL    NOT NULL,
  revenue       REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales(order_date);
CREATE INDEX IF NOT EXISTS idx_sales_product  ON sales(product);

CREATE TABLE IF NOT EXISTS sales_insights (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     TEXT    NOT NULL UNIQUE,
  year            INTEGER NOT NULL,
  generated_at    TEXT    NOT NULL,         -- ISO timestamp
  total_revenue   REAL    NOT NULL,
  total_units     INTEGER NOT NULL,
  top_product     TEXT    NOT NULL,
  top_region      TEXT    NOT NULL,
  summary         TEXT    NOT NULL,         -- agent narrative
  insights_json   TEXT    NOT NULL          -- structured insights blob
);
