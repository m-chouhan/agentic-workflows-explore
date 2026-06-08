#!/usr/bin/env bash
# Tail Docker logs for one or all services.
# Usage:  ./scripts/logs.sh [service]   (worker | app-server | postgres)
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  docker compose logs -f --tail=50
else
  docker compose logs -f --tail=100 "$SERVICE"
fi
