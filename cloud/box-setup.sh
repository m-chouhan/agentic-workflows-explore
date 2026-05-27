#!/bin/bash
# Idempotent box bootstrap — safe to run on every deploy.
set -e

echo "=== Box Setup ==="

apt-get update -q

echo "[1/5] Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh && rm get-docker.sh
    echo "  installed: $(docker --version)"
else
    echo "  already installed: $(docker --version)"
fi

echo "[2/5] Docker Compose..."
if ! docker compose version &> /dev/null; then
    apt-get install -y -q docker-compose-plugin
    echo "  installed: $(docker compose version)"
else
    echo "  already installed: $(docker compose version)"
fi

echo "[3/5] Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y -q nginx
    systemctl enable nginx
    echo "  installed: $(nginx -v 2>&1)"
else
    echo "  already installed: $(nginx -v 2>&1)"
fi

echo "[4/5] Certbot..."
if ! command -v certbot &> /dev/null; then
    apt-get install -y -q certbot python3-certbot-nginx
    echo "  installed"
else
    echo "  already installed"
fi

echo "[5/5] Firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp  > /dev/null 2>&1 || true
    ufw allow 80/tcp  > /dev/null 2>&1 || true
    ufw allow 443/tcp > /dev/null 2>&1 || true
    ufw allow 3002/tcp > /dev/null 2>&1 || true
    ufw --force enable > /dev/null 2>&1 || true
    echo "  ports 22/80/443/3002 open"
fi

mkdir -p /opt/agentic-platform /opt/n8n-risk-agent /etc/nginx/sites-available /etc/nginx/sites-enabled

echo "=== Box Setup complete ==="
