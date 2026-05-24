#!/bin/bash
# box-setup.sh — idempotent bootstrap for any Ubuntu/Debian VPS.
# Safe to run on every deploy; each step is guarded so re-runs are no-ops.
# Works on DigitalOcean, Contabo, AWS, Hetzner, etc.
set -e

echo "=== Box Setup ==="

# 1. Update system packages
echo "[1/6] Updating system packages..."
apt-get update -q
apt-get upgrade -y -q

# 2. Install Docker
echo "[2/6] Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "  installed: $(docker --version)"
else
    echo "  already installed: $(docker --version)"
fi

# 3. Install Docker Compose plugin
echo "[3/6] Docker Compose..."
if ! docker compose version &> /dev/null; then
    apt-get install -y -q docker-compose-plugin
    echo "  installed: $(docker compose version)"
else
    echo "  already installed: $(docker compose version)"
fi

# 4. Install Nginx
echo "[4/6] Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y -q nginx
    systemctl enable nginx
    echo "  installed: $(nginx -v 2>&1)"
else
    echo "  already installed: $(nginx -v 2>&1)"
fi

# 5. Install Certbot
echo "[5/6] Certbot..."
if ! command -v certbot &> /dev/null; then
    apt-get install -y -q certbot python3-certbot-nginx
    echo "  installed"
else
    echo "  already installed"
fi

# 6. Firewall
echo "[6/6] Firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp  > /dev/null 2>&1 || true
    ufw allow 80/tcp  > /dev/null 2>&1 || true
    ufw allow 443/tcp > /dev/null 2>&1 || true
    ufw --force enable > /dev/null 2>&1 || true
    echo "  ports 22/80/443 open"
fi

# Ensure app + nginx dirs exist
mkdir -p /opt/agentic-platform
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

echo "=== Box Setup complete ==="
