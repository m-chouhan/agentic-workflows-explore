-- bitbucket-pr-status workflow tables

CREATE TABLE IF NOT EXISTS pr_status_runs (
  id            SERIAL PRIMARY KEY,
  workflow_id   TEXT    NOT NULL UNIQUE,
  repo          TEXT    NOT NULL,          -- workspace/slug
  checked_at    TEXT    NOT NULL,          -- ISO timestamp
  total_prs     INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0,
  prs_json      TEXT    NOT NULL,          -- PrWithBuild[]
  status        TEXT    NOT NULL DEFAULT 'completed'  -- completed | failed
);

CREATE INDEX IF NOT EXISTS idx_pr_status_repo ON pr_status_runs(repo);
