#!/usr/bin/env bash
# Start the local Docker stack (postgres + worker + app-server) and wait for healthz.
# Usage:  ./scripts/run-local.sh [--rebuild]
set -euo pipefail

cd "$(dirname "$0")/.."

REBUILD=""
if [[ "${1:-}" == "--rebuild" ]]; then
  REBUILD="--build"
  echo "▶ Rebuilding images..."
fi

if [[ ! -f .env ]]; then
  echo "⚠ .env not found — copy .env.example to .env and fill in secrets."
  exit 1
fi

echo "▶ Starting Docker stack..."
docker compose up -d $REBUILD

echo "▶ Waiting for /healthz on http://localhost:3002 ..."
for i in {1..30}; do
  if curl -sf http://localhost:3002/healthz >/dev/null 2>&1; then
    echo "✓ app-server ready"
    echo ""
    docker compose ps
    echo ""
    echo "▶ Tail logs:   ./scripts/logs.sh [worker|app-server|postgres]"
    echo "▶ Run e2e:     ./scripts/e2e/test-bitbucket-pr-status.sh"
    exit 0
  fi
  sleep 1
done

echo "✗ app-server did not become healthy in 30s"
docker compose logs --tail=40 app-server worker
exit 1
