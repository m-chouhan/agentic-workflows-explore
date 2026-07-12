# InstEnv Deployment Runbook — dbos-agentic-platform

**Environment:** Atlassian Instant Environment (AWS EC2, Amazon Linux 2)  
**Instance IP:** `10.229.150.85` (private — requires Atlassian VPN)  
**Instance ID:** `i-00369de49e48fc045`  
**SSH alias:** `instenv-media` (see `~/.ssh/config`)

---

## SSH Access

### Prerequisites (one-time)

1. Go to **go/instenv-ui → SSH Keys** → Generate Key → download the `.pem` file
2. Copy key and set permissions:
   ```bash
   cp ~/Downloads/instenv-generated-key-XXXXX.pem ~/.ssh/
   chmod 400 ~/.ssh/instenv-generated-key-XXXXX.pem
   ```
3. Add to `~/.ssh/config`:
   ```
   Host instenv-media
       HostName 10.229.150.85
       User ec2-user
       IdentityFile ~/.ssh/instenv-generated-key-XXXXX.pem
       StrictHostKeyChecking no
   ```
4. In **InstEnv UI → your environment → `...` → Add SSH keys to environment** — wait for task to complete (≈ 1 min)
5. Add key to local SSH agent (required on macOS Sequoia — OpenSSH 10.x fails without it):
   ```bash
   ssh-add ~/.ssh/instenv-generated-key-XXXXX.pem
   ```

> **Note:** The instance is Amazon Linux 2 (not Ubuntu), so the user is `ec2-user`, not `ubuntu`.

### Test SSH

```bash
ssh instenv-media "echo ok && whoami"
```

---

## What We Actually Did (First Run — Jun 16 2026)

This is a log of the exact steps taken to validate the stack end-to-end on this InstEnv.

1. Generated SSH key in InstEnv UI → downloaded `.pem` → triggered "Add SSH keys to environment" (≈1 min)
2. Hit `Permission denied (publickey)` — root cause: macOS Sequoia OpenSSH 10.x cannot load RSA `.pem` directly (`type -1`). Fix: `ssh-add` the key to the agent first.
3. Hit `ubuntu@... Permission denied` — root cause: InstEnv runs Amazon Linux 2, user is `ec2-user` not `ubuntu`. The Rovo docs say "use ubuntu for Ubuntu" but this instance is Amazon Linux.
4. Installed Docker Compose (not pre-installed on the instance): `sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose`
5. Built image locally: `docker build --platform linux/amd64 -t agentic-platform:latest .` (~68s on Apple Silicon)
6. Exported: `docker save agentic-platform:latest | gzip > /tmp/agentic-platform.tar.gz` → 111 MB
7. Copied `.env` (local dev tokens) and `docker-compose.prod.yml` to EC2 via `scp`
8. `docker load` + `docker-compose up -d` → all 3 containers healthy in ~12s
9. `curl http://localhost:3002/healthz` → `{"ok":true}` ✅
10. Probed the InstEnv-provisioned `instenv-db` postgres container — found a clean `atldb` database with superuser `atldbuser`

**Result:** Stack runs. The self-hosted `agentic-postgres` container is redundant — the InstEnv already provides a managed Postgres.

---

## Right Way Forward

**Do not self-host Postgres.** The InstEnv provisions a managed Postgres container (`instenv-db`) automatically. Use it.

### InstEnv-provided DB details

| | |
|---|---|
| Container | `instenv-db` |
| Host (from EC2) | `localhost` or `172.17.0.x` (bridge network) |
| Port | `5432` |
| User | `atldbuser` |
| Password | `_Sdu1AmekrQy9fPyShL2Xqs4` (generated per env) |
| Database | `atldb` (empty, ready to use) |

> The password is unique per InstEnv instance. Check it with: `docker inspect instenv-db | grep POSTGRES_PASSWORD`

### Changes needed to use InstEnv DB

1. **Remove the `postgres` service from `docker-compose.prod.yml`** — no need to run our own container.
2. **Update network config** — worker and app-server should use `network_mode: host` or connect via the EC2's host IP rather than a Docker bridge network, since `instenv-db` is on the default bridge, not our `agentic-net`.
3. **`.env` on EC2 should point at the InstEnv DB:**
   ```
   PGHOST=172.17.0.1    # Docker host gateway, or use host networking
   PGPORT=5432
   PGUSER=atldbuser
   PGPASSWORD=<from docker inspect instenv-db>
   PGDATABASE=atldb
   ```
4. **DBOS system DB** will be auto-created as `atldb_dbos_sys` on first `DBOS.launch()` — no manual migration needed.

### Proper deployment flow (Bitbucket-based)

Once the code is in a Bitbucket repo:

1. Push code to `main` branch in company Bitbucket workspace
2. Bitbucket Pipelines builds the image and deploys via `scp` + SSH to the InstEnv EC2
3. Secrets (tokens, API keys) live in Bitbucket repo variables — injected into `.env` by the pipeline, never committed
4. The InstEnv DB is used as-is — no Postgres container in the compose file
5. Only `worker` and `app-server` containers are deployed

See **Option B** below for the full `bitbucket-pipelines.yml`.

---

## Option A — Dirty Hack (manual image export)

Use this to quickly verify the stack runs. No CI, no Bitbucket, no repo setup needed.

### Step 1 — Build image locally (linux/amd64)

```bash
cd dbos-agentic-platform
docker build --platform linux/amd64 -t agentic-platform:latest .
```

> Takes ~3-5 min on Apple Silicon (cross-platform emulation via Rosetta/QEMU).

### Step 2 — Export and transfer to EC2

```bash
docker save agentic-platform:latest | gzip > /tmp/agentic-platform.tar.gz
scp /tmp/agentic-platform.tar.gz instenv-media:~/
scp docker-compose.prod.yml instenv-media:~/
```

### Step 3 — Prepare .env on EC2

```bash
# On your Mac — copy the template and fill in secrets
scp .env.example instenv-media:~/.env.template
```

Then SSH in and create `.env`:
```bash
ssh instenv-media
cp ~/.env.template ~/.env
# Edit with real values:
# GOOGLE_GENERATIVE_AI_API_KEY=...
# BITBUCKET_TOKEN=...
# ROVO_DEV_URL=http://host.docker.internal:4000  (if acli rovodev serve is running locally)
# ROVO_DEV_TOKEN=...
nano ~/.env
```

### Step 4 — Load image and run

```bash
ssh instenv-media
docker load -i ~/agentic-platform.tar.gz
docker-compose -f ~/docker-compose.prod.yml up -d
docker ps
docker logs agentic-worker --tail 30
docker logs agentic-app-server --tail 30
```

### Step 5 — Health check

```bash
curl http://localhost:3002/healthz
```

Or from your Mac (via SSH tunnel):
```bash
ssh -L 3002:localhost:3002 instenv-media -N &
curl http://localhost:3002/healthz
```

---

## Option B — Proper Company Setup (Bitbucket + Pipelines)

This is the right-way setup for a shared team environment.

### Prerequisites

- Bitbucket workspace + repo (e.g. `atlassian-team/agentic-platform`)
- Bitbucket Pipelines enabled on the repo
- Repository variables set (Settings → Repository variables):

| Variable | Value |
|---|---|
| `INSTENV_SSH_KEY` | private key contents (`~/.ssh/instenv-generated-key-XXXXX.pem`) |
| `INSTENV_HOST` | `10.229.150.85` |
| `INSTENV_USER` | `ec2-user` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key |
| `BITBUCKET_TOKEN` | Bitbucket access token |
| `ROVO_DEV_TOKEN` | Rovo Dev session token |

### `bitbucket-pipelines.yml` (deploy on push to `main`)

```yaml
image: docker:27

pipelines:
  branches:
    main:
      - step:
          name: Build & Deploy to InstEnv
          services:
            - docker
          script:
            # Build for linux/amd64 (EC2 is x86_64)
            - docker build --platform linux/amd64 -t agentic-platform:latest .
            - docker save agentic-platform:latest | gzip > agentic-platform.tar.gz

            # Set up SSH
            - mkdir -p ~/.ssh
            - echo "$INSTENV_SSH_KEY" > ~/.ssh/deploy_key
            - chmod 400 ~/.ssh/deploy_key
            - ssh-keyscan $INSTENV_HOST >> ~/.ssh/known_hosts

            # Transfer image + compose file
            - scp -i ~/.ssh/deploy_key agentic-platform.tar.gz $INSTENV_USER@$INSTENV_HOST:~/
            - scp -i ~/.ssh/deploy_key docker-compose.prod.yml $INSTENV_USER@$INSTENV_HOST:~/

            # Deploy on EC2
            - |
              ssh -i ~/.ssh/deploy_key $INSTENV_USER@$INSTENV_HOST << 'EOF'
                docker load -i ~/agentic-platform.tar.gz
                docker-compose -f ~/docker-compose.prod.yml down --remove-orphans
                docker-compose -f ~/docker-compose.prod.yml up -d
                docker ps
              EOF
```

### `.env` management for team use

Two options for secrets in the team setup:

**Option 1 — Repository variables (simple)**  
Inject secrets from Bitbucket repo variables into `.env` during the pipeline run, then scp to EC2.

**Option 2 — AWS Secrets Manager (proper)**  
Store secrets in AWS Secrets Manager (the InstEnv has the IAM role to read from the same account). Fetch at startup via a small init script or AWS CLI in the container entrypoint.

---

## Useful Commands Once Running

```bash
# SSH in
ssh instenv-media

# Check all containers
docker ps

# Tail logs
docker logs agentic-worker -f
docker logs agentic-app-server -f

# Check DBOS system DB for workflow status
docker exec agentic-postgres psql -U dbos -d dbos_platform_dbos_sys \
  -c "SELECT workflow_uuid, status, name FROM dbos.workflow_status ORDER BY created_at DESC LIMIT 10;"

# Restart a single service
docker-compose -f ~/docker-compose.prod.yml restart worker

# Full teardown
docker-compose -f ~/docker-compose.prod.yml down

# Full teardown including DB volume (DESTRUCTIVE — wipes all workflow state)
docker-compose -f ~/docker-compose.prod.yml down -v
```

---

## Known Issues & Notes

- **InstEnv lifetime:** Must be manually prolonged via InstEnv UI ("alive until") or it auto-terminates. Set a weekday schedule if available.
- **SSH key propagation:** After generating/uploading an SSH key in the InstEnv UI, you must explicitly trigger "Add SSH keys to environment" on the environment — it doesn't happen automatically.
- **macOS Sequoia SSH:** OpenSSH 10.x fails to load RSA `.pem` keys directly. Always `ssh-add` the key to the agent first before connecting.
- **Docker Compose:** InstEnv ships with Docker 25 but not Compose. Install once: `sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose`
- **Image transfer:** A `tar.gz` of the image is ~400-600 MB. On Atlassian VPN, scp throughput is typically 20-50 MB/s, so expect 15-30 seconds for the transfer.
- **Rovo Dev:** The `ROVO_DEV_URL` for the worker inside Docker should point to your Mac's local `acli rovodev serve` process. Use `ssh -R 4000:localhost:4000 instenv-media` to reverse-tunnel your local port 4000 into the EC2 if needed, or run `acli rovodev serve` directly on the EC2 (requires `acli` install).
