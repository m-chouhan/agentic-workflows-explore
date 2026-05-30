-- Business-data schema (Postgres)
-- Business tables share the same database as DBOS system state.
-- NOTE: kept as a single shared file for now; will split into per-workflow
-- fragments in a later iteration (see knowledge/platform-architecture-refactor-plan).

-- ═══════════════════════════════════════════════════════════════════
-- Vulnerability scan-and-fix tables
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS scan_results (
  id              SERIAL PRIMARY KEY,
  workflow_id     TEXT    NOT NULL UNIQUE,
  repo            TEXT    NOT NULL,
  branch          TEXT    NOT NULL DEFAULT 'main',
  scanned_at      TEXT    NOT NULL,         -- ISO timestamp
  total_findings  INTEGER NOT NULL DEFAULT 0,
  blocker_count   INTEGER NOT NULL DEFAULT 0,
  triage_json     TEXT,                     -- TriageResult (nullable until triage step runs)
  findings_json   TEXT    NOT NULL,         -- ScanFinding[]
  status          TEXT    NOT NULL DEFAULT 'pending'  -- pending | triaged | fixing | completed | failed
);

CREATE INDEX IF NOT EXISTS idx_scan_repo ON scan_results(repo);

CREATE TABLE IF NOT EXISTS fix_attempts (
  id              SERIAL PRIMARY KEY,
  workflow_id     TEXT    NOT NULL,
  finding_id      TEXT    NOT NULL,         -- CVE or rule ID
  fix_type        TEXT    NOT NULL,         -- version-bump | code-patch | config-change
  confidence      DOUBLE PRECISION,        -- 0-1 from agent
  patch_json      TEXT,                     -- FixCandidate JSON
  pr_url          TEXT,                     -- GitHub PR URL (null until PR created)
  pr_status       TEXT    DEFAULT 'pending', -- pending | created | ci-passed | ci-failed | merged | rejected
  created_at      TEXT    NOT NULL,
  CONSTRAINT fk_fix_scan FOREIGN KEY (workflow_id) REFERENCES scan_results(workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_fix_workflow ON fix_attempts(workflow_id);
