#!/usr/bin/env bash
# start-local.sh — one-command local startup for the AI Agent Tools stack.
# Usage: ./start-local.sh [--build] [--down] [--logs]

set -euo pipefail

ENV_FILE=".env.local"

print_banner() {
  printf '\n\033[1;34m'
  echo '╔══════════════════════════════════════════════╗'
  echo '║       AI Agent Tools — Local Dev Stack       ║'
  echo '║          PR / Security Scanner               ║'
  echo '╚══════════════════════════════════════════════╝'
  printf '\033[0m\n'
}

check_env() {
  if [ ! -f "$ENV_FILE" ]; then
    printf '\033[1;33m[setup]\033[0m .env.local not found — creating from example...\n'
    cp .env.local.example "$ENV_FILE"
    printf '\033[1;31m[action required]\033[0m Edit %s and add your GOOGLE_GENERATIVE_AI_API_KEY\n' "$ENV_FILE"
    printf '  Get a free key at: https://aistudio.google.com/app/apikey\n\n'
    read -rp "Press Enter after you have set the key... " _
  fi

  if grep -q "your-google-api-key-here" "$ENV_FILE"; then
    printf '\033[1;31m[error]\033[0m GOOGLE_GENERATIVE_AI_API_KEY is not set in %s\n' "$ENV_FILE"
    printf '  Edit the file and add your real key, then re-run this script.\n'
    exit 1
  fi
}

case "${1:-start}" in
  --down)
    printf '\033[1;33m[down]\033[0m Stopping and removing containers...\n'
    docker compose --env-file "$ENV_FILE" down
    exit 0
    ;;
  --logs)
    docker compose --env-file "$ENV_FILE" logs -f
    exit 0
    ;;
  --clean)
    printf '\033[1;31m[clean]\033[0m Removing containers AND volumes (all data will be deleted)...\n'
    read -rp "Are you sure? [y/N] " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
    docker compose --env-file "$ENV_FILE" down -v
    exit 0
    ;;
esac

print_banner
check_env

BUILD_FLAG=""
if [ "${1:-}" = "--build" ]; then
  BUILD_FLAG="--build"
fi

printf '\033[1;32m[start]\033[0m Starting stack (this may take a few minutes on first run)...\n\n'

docker compose --env-file "$ENV_FILE" up $BUILD_FLAG -d

printf '\n\033[1;32m[ready]\033[0m Stack is starting. Services:\n\n'
printf '  \033[1;36m→ API Server:\033[0m          http://localhost:3002\n'
printf '  \033[1;36m→ API health check:\033[0m    http://localhost:3002/healthz\n'
printf '  \033[1;36m→ PostgreSQL:\033[0m          localhost:5432\n'
printf '\n'
printf '  Other commands:\n'
printf '    ./start-local.sh --logs    — tail all logs\n'
printf '    ./start-local.sh --down    — stop all containers\n'
printf '    ./start-local.sh --build   — rebuild images and start\n'
printf '    ./start-local.sh --clean   — remove containers + volumes\n'
printf '\n'
printf '\033[2m(schema is applied automatically by the worker/server on boot)\033[0m\n\n'
