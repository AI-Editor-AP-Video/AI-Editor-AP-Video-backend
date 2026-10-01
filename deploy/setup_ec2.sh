#!/usr/bin/env bash
# Production Hardening & Provisioning Script for AWS EC2 Ubuntu 24.04 / 22.04 LTS
# Run this once on your fresh EC2 instance.
set -e

echo "=========================================================="
echo "🛡️  AP Editorial Backend & Worker - EC2 Hardening Setup"
echo "=========================================================="

# 1. Update OS packages
echo -e "\n[1/5] Updating OS packages..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw fail2ban

# 2. Configure 2GB Swap Memory (Guarantees Zero OOM Crashes on low-RAM EC2)
if [ ! -f /swapfile ]; then
    echo -e "\n[2/5] Creating 2GB Swap File for memory safety..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    # Lower swappiness to 10 (favor RAM, swap only when needed)
    sudo sysctl vm.swappiness=10
    echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
    echo "✅ 2GB Swap File activated."
else
    echo -e "\n[2/5] Swap file already exists. Skipping."
fi

# 3. Install Docker Engine & Docker Compose
if ! command -v docker &> /dev/null; then
    echo -e "\n[3/5] Installing Docker Engine & Compose..."
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Enable non-root docker execution
    sudo usermod -aG docker "$USER"
    sudo systemctl enable docker
    sudo systemctl start docker
    echo "✅ Docker installed."
else
    echo -e "\n[3/5] Docker already installed. Skipping."
fi

# 4. Configure Docker Global Log Rotation (Protects disk from filling up)
echo -e "\n[4/5] Enforcing global Docker log rotation limits..."
sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  }
}
EOF
sudo systemctl restart docker
echo "✅ Docker log limits enforced (max 60MB total logs)."

# 5. Create deployment directory
echo -e "\n[5/5] Initializing deployment workspace in ~/ap-backend..."
mkdir -p ~/ap-backend
cd ~/ap-backend

echo "=========================================================="
echo "🎉 EC2 Production Environment Ready!"
echo ""
echo "Quick Deployment Steps:"
echo " 1. Copy your .env and docker-compose.prod.yml to ~/ap-backend/"
echo " 2. In Cloudflare DNS, point 'api-apeditor' (Orange Cloud Proxied) to this EC2 Public IP"
echo " 3. Launch both API and Worker services:"
echo "      docker compose -f docker-compose.prod.yml up -d --build"
echo ""
echo "Useful Management Commands:"
echo " • Check container status:   docker compose -f docker-compose.prod.yml ps"
echo " • Follow API logs:          docker compose -f docker-compose.prod.yml logs -f backend-api"
echo " • Follow Worker logs:       docker compose -f docker-compose.prod.yml logs -f backend-worker"
echo " • Scale Worker instances:   docker compose -f docker-compose.prod.yml up -d --scale backend-worker=2"
echo " • Restart Worker only:      docker compose -f docker-compose.prod.yml restart backend-worker"
echo "=========================================================="
