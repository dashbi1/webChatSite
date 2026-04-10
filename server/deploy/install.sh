#!/bin/bash
# 工大圈子 后端一键安装脚本
# 适用：Ubuntu 22.04 LTS / Debian 12
# 用法：sudo ./install.sh

set -e

echo "==================================="
echo "  工大圈子后端 - 一键安装脚本"
echo "==================================="

# 检查是否 root 权限
if [ "$EUID" -ne 0 ]; then
  echo "请用 sudo 运行: sudo ./install.sh"
  exit 1
fi

# 获取项目根目录（deploy 的上级目录）
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SERVER_DIR="$( dirname "$SCRIPT_DIR" )"
echo "[info] 服务器目录: $SERVER_DIR"

# 1. 更新系统
echo ""
echo "[1/6] 更新系统包列表..."
apt update -y

# 2. 安装 Node.js 20 LTS
echo ""
echo "[2/6] 安装 Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
else
  echo "Node.js 已安装: $(node -v)"
fi

# 3. 安装 PM2
echo ""
echo "[3/6] 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
else
  echo "PM2 已安装: $(pm2 -v)"
fi

# 4. 安装 Nginx
echo ""
echo "[4/6] 安装 Nginx..."
if ! command -v nginx &> /dev/null; then
  apt install -y nginx
  systemctl enable nginx
  systemctl start nginx
else
  echo "Nginx 已安装"
fi

# 5. 安装项目依赖
echo ""
echo "[5/6] 安装 Node 依赖..."
cd "$SERVER_DIR"
if [ -f "package.json" ]; then
  npm install --production
else
  echo "[warn] 未找到 package.json，跳过"
fi

# 6. 配置 UFW 防火墙
echo ""
echo "[6/6] 配置 UFW 防火墙..."
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "y" | ufw enable || true
  ufw status
else
  apt install -y ufw
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  echo "y" | ufw enable || true
fi

echo ""
echo "==================================="
echo "  安装完成！"
echo "==================================="
echo ""
echo "接下来的步骤："
echo ""
echo "1. 配置 .env 文件:"
echo "   cd $SERVER_DIR"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "2. 启动服务:"
echo "   pm2 start deploy/ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup  # 按提示执行命令"
echo ""
echo "3. 配置 Nginx:"
echo "   sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/hit-circle"
echo "   sudo nano /etc/nginx/sites-available/hit-circle  # 改 server_name"
echo "   sudo ln -s /etc/nginx/sites-available/hit-circle /etc/nginx/sites-enabled/"
echo "   sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "4. (可选) 配置 HTTPS:"
echo "   sudo apt install certbot python3-certbot-nginx -y"
echo "   sudo certbot --nginx -d yourdomain.com"
echo ""
