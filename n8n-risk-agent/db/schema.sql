-- ═══════════════════════════════════════════════════════════════════
-- Risk Factor Agent — Postgres Schema
-- Database: risk_factor (separate from dbos-agentic-platform DB)
-- ═══════════════════════════════════════════════════════════════════

-- ── Feature Weights ───────────────────────────────────────────────
-- The agent reads all rows, reasons over news, and suggests changes.
-- Humans approve/reject via Telegram before any UPDATE happens.
CREATE TABLE IF NOT EXISTS feature_weights (
  id            SERIAL PRIMARY KEY,
  feature       TEXT    NOT NULL UNIQUE,   -- e.g. 'country:UAE', 'industry:Oil'
  category      TEXT    NOT NULL,          -- 'country' | 'industry' | 'sector' | 'macro'
  weight        INTEGER NOT NULL           -- 0 (safest) → 10 (riskiest)
                CHECK (weight >= 0 AND weight <= 10),
  description   TEXT,                      -- human-readable note on why this weight
  last_reviewed DATE    DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fw_category ON feature_weights(category);

-- ── Agent Memory ──────────────────────────────────────────────────
-- One row per feature per daily run.
-- Next run reads last 14 days → injected into LLM prompt.
-- Prevents duplicate suggestions; enables trend-aware reasoning.
CREATE TABLE IF NOT EXISTS agent_memory (
  id                SERIAL PRIMARY KEY,
  run_date          DATE    NOT NULL DEFAULT CURRENT_DATE,
  feature           TEXT    NOT NULL,      -- matches feature_weights.feature
  news_summary      TEXT,                  -- key news snippet that triggered reasoning
  news_sources      TEXT,                  -- JSON array of source URLs
  reasoning         TEXT    NOT NULL,      -- why agent suggested the change
  suggested_weight  INTEGER NOT NULL
                    CHECK (suggested_weight >= 0 AND suggested_weight <= 10),
  confidence        TEXT    NOT NULL       -- 'low' | 'medium' | 'high'
                    CHECK (confidence IN ('low', 'medium', 'high')),
  approved          BOOLEAN DEFAULT NULL,  -- NULL = pending, TRUE = approved, FALSE = rejected
  approved_weight   INTEGER,              -- final value written to feature_weights (if approved)
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_am_run_date ON agent_memory(run_date);
CREATE INDEX IF NOT EXISTS idx_am_feature  ON agent_memory(feature);

-- ── Weight Changelog ──────────────────────────────────────────────
-- Audit trail: every write to feature_weights logs here.
-- Answers "why did this weight change?" months later.
CREATE TABLE IF NOT EXISTS weight_changelog (
  id              SERIAL PRIMARY KEY,
  feature         TEXT    NOT NULL,
  previous_weight INTEGER NOT NULL,
  new_weight      INTEGER NOT NULL,
  news_source     TEXT,                   -- URL that triggered this change
  run_date        DATE    NOT NULL,
  memory_id       INTEGER REFERENCES agent_memory(id),
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wc_feature ON weight_changelog(feature);

-- ── Auto-update updated_at on feature_weights ─────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_feature_weights_updated_at ON feature_weights;
CREATE TRIGGER update_feature_weights_updated_at
  BEFORE UPDATE ON feature_weights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
