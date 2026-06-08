#!/usr/bin/env bash
# Stop the local Docker stack (keeps postgres volume).
# Use --wipe to also drop the postgres volume (destroys all workflow history).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--wipe" ]]; then
  echo "▶ Stopping stack AND wiping postgres volume..."
  docker compose down -v
else
  echo "▶ Stopping stack (postgres data preserved)..."
  docker compose down
fi
