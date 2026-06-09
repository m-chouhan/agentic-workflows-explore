-- bitbucket-pr-autofix workflow tables

CREATE TABLE IF NOT EXISTS pr_autofix_runs (
  id                  SERIAL PRIMARY KEY,
  workflow_id         TEXT    NOT NULL UNIQUE,
  repo                TEXT    NOT NULL,
  source              TEXT    NOT NULL,              -- discover | reuse
  status_workflow_id  TEXT,                          -- set when source = reuse
  started_at          TEXT    NOT NULL,              -- ISO timestamp
  finished_at         TEXT,                          -- ISO timestamp
  total_failing       INTEGER NOT NULL DEFAULT 0,
  attempted           INTEGER NOT NULL DEFAULT 0,
  succeeded           INTEGER NOT NULL DEFAULT 0,
  failed              INTEGER NOT NULL DEFAULT 0,
  timed_out           INTEGER NOT NULL DEFAULT 0,
  skipped             INTEGER NOT NULL DEFAULT 0,
  status              TEXT    NOT NULL DEFAULT 'running' -- running | completed | failed
);

CREATE INDEX IF NOT EXISTS idx_pr_autofix_runs_repo ON pr_autofix_runs(repo);

CREATE TABLE IF NOT EXISTS pr_autofix_attempts (
  id              SERIAL PRIMARY KEY,
  workflow_id     TEXT    NOT NULL,
  pr_id           INTEGER NOT NULL,
  pr_url          TEXT    NOT NULL,
  source_branch   TEXT    NOT NULL,
  action          TEXT    NOT NULL,                  -- retrigger | rebase | code-change
  pipeline_uuid   TEXT,
  pipeline_url    TEXT,
  initial_state   TEXT,
  final_state     TEXT,
  poll_count      INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT    NOT NULL,                  -- succeeded | failed | timeout | skipped
  error_message   TEXT,
  started_at      TEXT    NOT NULL,
  finished_at     TEXT,
  UNIQUE (workflow_id, pr_id)
);

CREATE INDEX IF NOT EXISTS idx_pr_autofix_attempts_wf ON pr_autofix_attempts(workflow_id);
