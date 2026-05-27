-- Creates the n8n_state database for n8n's internal workflow/execution storage.
-- Runs once on first Postgres container start (docker-entrypoint-initdb.d).
-- Uses Postgres for n8n state so workflow definitions survive volume wipes.
CREATE DATABASE n8n_state;
