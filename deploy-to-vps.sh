#!/bin/bash
# ============================================================
# 工大圈子 - 本地一键部署到 VPS
# ============================================================
# 在本地 Git Bash / WSL / Mac Terminal 中运行
# 用法：./deploy-to-vps.sh
# ============================================================

set -e

# ============ 在这里填你的配置 ============
VPS_USER="root"
VPS_IP="YOUR_VPS_IP"
VPS_DIR="/opt/hit-circle"
# ==========================================

echo "====================================="
echo "  工大圈子 - 部署到 VPS"
echo "====================================="

# 检查配置
if [ "$VPS_IP" = "YOUR_VPS_IP" ]; then
  echo "[错误] 请先编辑本文件，填入 VPS_IP"
  exit 1
fi

# 检查 env.js 是否已配置 prod
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ENV_FILE="$SCRIPT_DIR/client/src/config/env.js"
if grep -q "YOUR_VPS_IP" "$ENV_FILE"; then
  echo "[错误] client/src/config/env.js 中的 prod 配置还未修改"
  echo "       请把 YOUR_VPS_IP 替换为实际 IP: $VPS_IP"
  exit 1
fi

# 检查 CURRENT 是否为 prod
if ! grep -q "CURRENT = 'prod'" "$ENV_FILE"; then
  echo "[警告] client/src/config/env.js 中 CURRENT 不是 'prod'"
  read -p "是否继续？(y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 步骤 1：构建 H5
echo ""
echo "[1/4] 构建 H5 前端..."
cd "$SCRIPT_DIR/client"
npm run build:h5
echo "[完成] H5 构建成功"

# 步骤 2：在 VPS 上创建目录
echo ""
echo "[2/4] 在 VPS 上创建目录..."
ssh "$VPS_USER@$VPS_IP" "mkdir -p $VPS_DIR/server $VPS_DIR/client/h5"

# 步骤 3：上传文件
echo ""
echo "[3/4] 上传文件到 VPS..."
echo "  上传后端..."
scp -r "$SCRIPT_DIR/server/src" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"
scp -r "$SCRIPT_DIR/server/admin" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"
scp -r "$SCRIPT_DIR/server/deploy" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"
scp "$SCRIPT_DIR/server/package.json" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"
scp "$SCRIPT_DIR/server/package-lock.json" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"
scp "$SCRIPT_DIR/server/.env.example" "$VPS_USER@$VPS_IP:$VPS_DIR/server/"

echo "  上传 H5 前端..."
scp -r "$SCRIPT_DIR/client/dist/build/h5/"* "$VPS_USER@$VPS_IP:$VPS_DIR/client/h5/"
echo "[完成] 文件上传成功"

# 步骤 4：在 VPS 上执行安装
echo ""
echo "[4/4] 在 VPS 上执行安装..."
ssh "$VPS_USER@$VPS_IP" "cd $VPS_DIR/server/deploy && chmod +x install.sh setup-nginx.sh"
ssh -t "$VPS_USER@$VPS_IP" "sudo $VPS_DIR/server/deploy/install.sh"
echo "[完成] 安装脚本执行成功"

echo ""
echo "====================================="
echo "  文件上传和环境安装完成！"
echo "====================================="
echo ""
echo "现在需要在 VPS 上手动完成最后几步："
echo ""
echo "  ssh $VPS_USER@$VPS_IP"
echo ""
echo "  # 1. 配置后端 .env"
echo "  cd $VPS_DIR/server"
echo "  cp .env.example .env"
echo "  nano .env"
echo ""
echo "  # 2. 启动后端"
echo "  pm2 start deploy/ecosystem.config.js"
echo "  pm2 save && pm2 startup"
echo ""
echo "  # 3. 配置并启动 Nginx"
echo "  cd $VPS_DIR/server/deploy"
echo "  cp deploy.conf.example deploy.conf"
echo "  nano deploy.conf"
echo "  sudo ./setup-nginx.sh"
echo ""
echo "  # 4. 验证"
echo "  curl -k https://$VPS_IP/api/health"
echo ""
