#!/bin/bash
# Idempotent box bootstrap — safe to run on every deploy.
set -e

echo "=== Box Setup ==="

# Wait for any background apt/dpkg process to finish (unattended-upgrades, etc.)
echo "Waiting for apt lock..."
systemctl stop unattended-upgrades 2>/dev/null || true
while lsof /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend 2>/dev/null | grep -q apt; do
    sleep 3
done
apt-get update -q

echo "[1/7] Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh && rm get-docker.sh
    echo "  installed: $(docker --version)"
else
    echo "  already installed: $(docker --version)"
fi

echo "[2/7] Docker Compose..."
if ! docker compose version &> /dev/null; then
    apt-get install -y -q docker-compose-plugin
    echo "  installed: $(docker compose version)"
else
    echo "  already installed: $(docker compose version)"
fi

echo "[3/7] Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y -q nginx
    systemctl enable nginx
    echo "  installed: $(nginx -v 2>&1)"
else
    echo "  already installed: $(nginx -v 2>&1)"
fi

echo "[4/7] Certbot..."
if ! command -v certbot &> /dev/null; then
    apt-get install -y -q certbot python3-certbot-nginx
    echo "  installed"
else
    echo "  already installed"
fi

echo "[5/7] Firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp  > /dev/null 2>&1 || true
    ufw allow 80/tcp  > /dev/null 2>&1 || true
    ufw allow 443/tcp > /dev/null 2>&1 || true
    ufw allow 3002/tcp > /dev/null 2>&1 || true
    ufw --force enable > /dev/null 2>&1 || true
    echo "  ports 22/80/443/3002 open"
fi

echo "[6/7] SSH hardening..."
# Ubuntu 24.04 cloud-init ships override files that re-enable PasswordAuthentication
# and disable PubkeyAuthentication on every reboot — wipe them all, use one file.
rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf \
      /etc/ssh/sshd_config.d/99-cloud-init.conf \
      /etc/ssh/sshd_config.d/99-fix.conf
echo "PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin prohibit-password" > /etc/ssh/sshd_config.d/99-hardening.conf
systemctl restart ssh
echo "  SSH hardened — password auth disabled, key auth only"

echo "[7/7] fail2ban..."
if ! command -v fail2ban-client &> /dev/null; then
    apt-get install -y -q fail2ban
    echo "  installed"
else
    echo "  already installed"
fi
systemctl enable fail2ban
systemctl start fail2ban
echo "  fail2ban active"

mkdir -p /opt/agentic-platform /opt/n8n-risk-agent /etc/nginx/sites-available /etc/nginx/sites-enabled

echo ""
echo "=== Box Setup complete ==="
echo "Verify SSH: sshd -T | grep -E 'passwordauthentication|pubkeyauthentication|permitrootlogin'"
echo "Verify fail2ban: systemctl status fail2ban | grep Active:"
