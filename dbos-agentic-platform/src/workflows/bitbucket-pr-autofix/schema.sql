-- bitbucket-pr-autofix workflow: one row per discover-and-retrigger run.

CREATE TABLE IF NOT EXISTS pr_autofix_runs (
  id              SERIAL PRIMARY KEY,
  workflow_id     TEXT    NOT NULL UNIQUE,
  repo            TEXT    NOT NULL,          -- workspace/slug
  triggered_at    TEXT    NOT NULL,          -- ISO timestamp
  total_failing   INTEGER NOT NULL DEFAULT 0,
  triggered       INTEGER NOT NULL DEFAULT 0,
  retriggers_json TEXT    NOT NULL,          -- Retrigger[]
  status          TEXT    NOT NULL DEFAULT 'completed'
);

CREATE INDEX IF NOT EXISTS idx_pr_autofix_repo ON pr_autofix_runs(repo);
