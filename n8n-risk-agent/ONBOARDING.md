# n8n Risk Agent — Onboarding (One Page)

> What this is, what's deployed, and how to operate it. For build details see `README.md`; for credential specifics see `CREDENTIALS.md`.

## What it is
An n8n workflow that monitors financial news daily, has Gemini reason over it, and proposes risk-weight changes you approve via Telegram before any DB write. Stack: n8n + Postgres + Finnhub + Gemini + Telegram.

## Where it runs (current state)
| | |
|---|---|
| Server | Contabo VPS `62.171.183.99` (Ubuntu 24.04) |
| URL | `https://n8n.mchouhan.co.in` (nginx + Let's Encrypt) |
| Internal port | n8n on `127.0.0.1:5679`, Postgres in-container |
| App dir on server | `/opt/n8n-risk-agent/` |
| SSH | `ssh contabo-agentic` (key-only, password auth disabled) |
| Image | `n8nio/n8n:1.88.0` (pinned), `postgres:16-alpine` |

## How deploys work
Push to `main` touching `n8n-risk-agent/**` → GitHub Actions [`deploy-n8n.yml`](../.github/workflows/deploy-n8n.yml):
1. Runs `cloud/box-setup.sh` (ensures Docker/nginx/fail2ban/SSH hardening)
2. Writes `.env` from GitHub Secrets
3. `scp` compose + SQL → server → `docker compose up -d`
4. Reloads nginx, health-checks `/healthz` (18×10s retries)

## Secrets (GitHub repo → Settings → Secrets → Actions)
`CLOUD_IP`, `CLOUD_SSH_KEY`, `N8N_POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `N8N_BASIC_AUTH_USER/PASSWORD`, `FINNHUB_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

- API keys are injected as env vars and referenced in nodes via `{{ $env.KEY }}` — **not** stored in n8n's UI credential store.
- `N8N_ENCRYPTION_KEY` must never change once set (or stored credentials become unreadable).

## Data persistence
- Workflows, executions, credentials live in the **Postgres named volume** — survive redeploys.
- SQL init scripts (`db/*.sql`) run **only on first boot** (empty volume), never on redeploy.
- Redeploy is safe: `docker compose down && up` keeps the volume.

## Common operations
```bash
# Open the UI
open https://n8n.mchouhan.co.in     # login with N8N_BASIC_AUTH_USER/PASSWORD

# SSH to server
ssh contabo-agentic

# Check containers / logs
cd /opt/n8n-risk-agent && docker compose -f docker-compose.prod.yml ps
docker logs n8n-risk-agent --tail 50

# Health check
curl -sf http://127.0.0.1:5679/healthz
```

## Known gotchas (learned the hard way)
- SSH lockouts on this box were caused by Ubuntu cloud-init re-enabling password auth → brute-force flooding. Fixed via `cloud/box-setup.sh` (single `99-hardening.conf` + fail2ban). See `knowledge/contabo/`.
- After a Contabo rescue boot, run `ssh-keygen -R 62.171.183.99` before reconnecting.
- Rotating `N8N_POSTGRES_PASSWORD` requires updating it inside Postgres too, or connections fail.

## What's planned (not done yet)
- Git-tracked workflow JSON (`n8n-workflows/`) + import on deploy
- Nightly `pg_dump` backup
- Staging environment (`n8n-staging.mchouhan.co.in`, port 5680, `staging` branch)

See the active deployment plan for details.
