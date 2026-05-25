# Contabo Deployment Runbook — Agentic Platform

> Captures the full deployment + verification flow done on 2026-05-26.
> For ongoing DBOS/SDK notes see `AGENTS.md` at the repo root.

---

## Infrastructure

| Item | Value |
|---|---|
| Server | Contabo VPS `62.171.183.99` (Ubuntu 24.04) |
| SSH alias | `contabo-agentic` → `~/.ssh/config` → key `~/.ssh/contabo_agentic` |
| App directory | `/opt/agentic-platform/` |
| App server port | `3002` (maps to container port 3000) |
| Domain | `agents.mchouhan.co.in` (A record → `62.171.183.99`) |
| SSL | Let's Encrypt via Certbot, auto-renews, expires 2026-08-23 |
| Nginx config | `/etc/nginx/sites-available/agentic-platform.conf` (symlinked to sites-enabled) |

## Containers (docker ps)

```
agentic-app-server   0.0.0.0:3002->3000/tcp   Express + DBOSClient (enqueues workflows)
agentic-worker       3000/tcp (internal)       DBOS.launch() + workflow runners
agentic-postgres     5432/tcp (internal)       Postgres 16 — business data + DBOS sys state
```

---

## One-Time Setup (already done — for reference if box is rebuilt)

### 1. DNS
Add A record at domain registrar (GoDaddy):
```
Type: A  |  Name: agents  |  Value: 62.171.183.99  |  TTL: 600
```
Verify: `dig agents.mchouhan.co.in`

### 2. Box setup
The CI docker deploy workflow runs `cloud/box-setup.sh` idempotently on every deploy.
For a fresh box, trigger a deploy or run manually:
```bash
scp cloud/box-setup.sh root@62.171.183.99:~/box-setup.sh
ssh contabo-agentic "bash ~/box-setup.sh"
```
Installs: Docker, Docker Compose plugin, Nginx, Certbot, UFW (ports 22/80/443/3002).

### 3. Nginx config (fully CI-managed)
Pushing any change to `cloud/nginx/agentic-platform.conf` on `main` triggers
`deploy-agentic-nginx.yml` which SCPs, symlinks, and reloads nginx automatically.
The first deploy was done via CI — no manual SCP was needed.

To deploy manually (e.g. CI is broken):
```bash
scp cloud/nginx/agentic-platform.conf root@62.171.183.99:/etc/nginx/sites-available/
ssh contabo-agentic "ln -sf /etc/nginx/sites-available/agentic-platform.conf \
  /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"
```

### 4. SSL (one-time, manual — Certbot auto-renews after)
```bash
ssh contabo-agentic "certbot --nginx -d agents.mchouhan.co.in \
  --non-interactive --agree-tos -m mchouhanofficial@gmail.com"
```
Certbot modifies the nginx config in-place to add the HTTPS block + HTTP→HTTPS redirect.
Auto-renewal is scheduled via systemd timer — verify: `systemctl list-timers | grep certbot`

---

## CI/CD Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-agentic-docker.yml` | push to `main` touching `dbos-agentic-platform/src/**`, `Dockerfile`, `docker-compose.prod.yml`, `cloud/box-setup.sh` | Runs box-setup.sh, builds image, deploys to Contabo, health checks |
| `deploy-agentic-nginx.yml` | push to `main` touching `cloud/nginx/agentic-platform.conf` | SCPs config, reloads nginx, health checks |

**GitHub Secrets required** (`m-chouhan/agentic-workflows-explore`):

| Secret | Value |
|---|---|
| `CLOUD_SSH_KEY` | Contents of `~/.ssh/contabo_agentic` |
| `CLOUD_IP` | `62.171.183.99` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key |
| `GOOGLE_MODEL` | `gemini-2.5-flash` (optional) |

---

## Verification Checklist

Run these after any deploy to confirm everything is healthy:

```bash
# 1. HTTPS health check
curl https://agents.mchouhan.co.in/healthz
# Expected: {"ok":true,"ts":"..."}

# 2. HTTP → HTTPS redirect
curl -I http://agents.mchouhan.co.in/healthz
# Expected: 301 Moved Permanently → Location: https://...

# 3. Trigger analyze workflow
curl -s -X POST https://agents.mchouhan.co.in/workflow/analyze \
  -H "Content-Type: application/json" \
  -d '{"year": 2024}'
# Expected: {"workflowId":"...","status":"ENQUEUED","pollUrl":"..."}

# 4. Poll result
curl -s https://agents.mchouhan.co.in/workflow/analyze/<workflowId>
# Expected: {"status":"SUCCESS","result":{...}} within ~10s

# 5. Trigger vuln scan (real data)
curl -s -X POST https://agents.mchouhan.co.in/workflow/scan \
  -H "Content-Type: application/json" \
  -d '{"repo": "m-chouhan/agentic-workflows-explore", "branch": "main"}'
# Expected: 202 ENQUEUED — poll after ~30-60s for SUCCESS

# 6. Check container logs
ssh contabo-agentic "docker logs agentic-worker --tail 30"
# Expected: ✓ scanAndFix done / ✓ analyzeYear done
```

## Full Chain (via portfolio proxy)

Once `my-portfolio` backend is redeployed:
```bash
curl -X POST https://mchouhan.co.in/api/workflow/analyze \
  -H "Content-Type: application/json" \
  -d '{"year": 2024}'
# Routes: nginx(DO) → portfolio backend /api/workflow/* → agents.mchouhan.co.in/workflow/*
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl https://agents.mchouhan.co.in` hangs | Nginx not running | `ssh contabo-agentic "systemctl status nginx"` |
| 502 Bad Gateway | App container down | `ssh contabo-agentic "docker ps && docker logs agentic-app-server"` |
| Workflow stays PENDING | Worker not running | `ssh contabo-agentic "docker logs agentic-worker --tail 20"` |
| `Cannot POST /api/workflow/...` on mchouhan.co.in | Portfolio backend stale image | Trigger `my-portfolio` docker deploy via `workflow_dispatch` |
| Cert expired | Certbot renewal failed | `ssh contabo-agentic "certbot renew --dry-run"` |
