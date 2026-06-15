-- platform-smoke workflow table.
-- One row per smoke run; proves the durable path can write to Postgres.

CREATE TABLE IF NOT EXISTS platform_smoke_runs (
  id           SERIAL PRIMARY KEY,
  workflow_id  TEXT    NOT NULL UNIQUE,
  repo         TEXT    NOT NULL,
  pr_id        INTEGER,                 -- null if repo has no PRs
  pr_state     TEXT    NOT NULL,        -- e.g. OPEN | MERGED | NONE
  checked_at   TEXT    NOT NULL         -- ISO timestamp
);

CREATE INDEX IF NOT EXISTS idx_platform_smoke_repo ON platform_smoke_runs(repo);
