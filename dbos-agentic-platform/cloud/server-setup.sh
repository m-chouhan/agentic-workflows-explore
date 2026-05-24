#!/bin/bash
set -e

echo "=== Starting Contabo Server Setup for Agentic Platform ==="

# 1. Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# 2. Install Docker
echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "Docker installed: $(docker --version)"
else
    echo "Docker already installed: $(docker --version)"
fi

# 3. Install Docker Compose plugin
echo "Installing Docker Compose..."
if ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
    echo "Docker Compose installed: $(docker compose version)"
else
    echo "Docker Compose already installed: $(docker compose version)"
fi

# 4. Install Nginx
echo "Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    apt-get install -y nginx
    systemctl enable nginx
    echo "Nginx installed: $(nginx -v 2>&1)"
else
    echo "Nginx already installed: $(nginx -v 2>&1)"
fi

# 5. Install Certbot for SSL
echo "Installing Certbot..."
if ! command -v certbot &> /dev/null; then
    apt-get install -y certbot python3-certbot-nginx
    echo "Certbot installed"
else
    echo "Certbot already installed"
fi

# 6. Configure firewall
echo "Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable || true
    echo "Firewall configured"
fi

# 7. Create app directory
mkdir -p /opt/agentic-platform
echo "App directory ready: /opt/agentic-platform"

# 8. Nginx directories
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy nginx config: scp cloud/nginx/agentic-platform.conf root@SERVER:/etc/nginx/sites-available/"
echo "2. Enable site:       ln -sf /etc/nginx/sites-available/agentic-platform.conf /etc/nginx/sites-enabled/"
echo "3. Test nginx:        nginx -t && systemctl reload nginx"
echo "4. Setup SSL:         certbot --nginx -d YOUR_DOMAIN"
echo "5. Add GitHub secrets: CLOUD_SSH_KEY, CLOUD_IP, GOOGLE_GENERATIVE_AI_API_KEY"
