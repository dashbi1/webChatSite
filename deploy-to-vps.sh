#!/bin/bash
# ============================================================
# 工大圈子 - 本地一键部署到 VPS
# ============================================================
# 在本地 Git Bash / WSL / Mac Terminal 中运行
# 用法：./deploy-to-vps.sh
#
# 适用场景：
#   - SSH 以普通用户登录（不是 root）
#   - 该用户可以 sudo 提权（passwordless 或输入一次密码）
#   - 如果 sudo 需要密码，会在移动到 /opt 那一步提示输入
# ============================================================

set -e

# ============ 在这里填你的配置 ============
VPS_USER="niubi74618"           # 改成你的普通用户（如 ubuntu / deploy）。也可以保持 root
VPS_IP="104.198.91.201"
VPS_DIR="/opt/hit-circle"

# SSH 私钥路径（可选）
#   - 留空：走默认（~/.ssh/id_rsa / id_ed25519 / ssh-agent / ~/.ssh/config）
#   - 填路径：强制指定，所有 ssh/scp 自动加 -i <key>
# 示例：
#   SSH_KEY="$HOME/.ssh/id_ed25519_vps"
#   SSH_KEY="/d/keys/my-vps.pem"
SSH_KEY="$HOME/.ssh/google-vps-free-sshKey"
# ==========================================

# 判断是否需要 sudo（非 root 用户时才用）
SUDO=""
if [ "$VPS_USER" != "root" ]; then
  SUDO="sudo"
fi

# 构造 ssh/scp 的公共参数
SSH_OPTS=()
if [ -n "$SSH_KEY" ]; then
  if [ ! -f "$SSH_KEY" ]; then
    echo "[错误] 找不到 SSH 私钥: $SSH_KEY"
    exit 1
  fi
  SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi
# 压掉无害的通道警告（channel_by_id: bad id 等）
SSH_OPTS+=(-o LogLevel=ERROR)

# 远端上传暂存目录（普通用户可写）
REMOTE_STAGE="/tmp/hit-circle-deploy-$(date +%s)"

echo "====================================="
echo "  工大圈子 - 部署到 VPS"
echo "  用户: $VPS_USER@$VPS_IP"
echo "  模式: $( [ -z "$SUDO" ] && echo 'root 直接部署' || echo '普通用户 + sudo 提权' )"
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
echo "[1/5] 构建 H5 前端..."
cd "$SCRIPT_DIR/client"
npm run build:h5
echo "[完成] H5 构建成功"

# 步骤 2：在 VPS 上创建暂存目录（普通用户可写的 /tmp 下）
echo ""
echo "[2/5] 在 VPS /tmp 下创建暂存目录..."
ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_IP" "mkdir -p $REMOTE_STAGE/server $REMOTE_STAGE/client/h5"

# 步骤 3：上传文件到暂存目录
echo ""
echo "[3/5] 上传文件到 VPS 暂存目录..."
echo "  上传后端..."
scp "${SSH_OPTS[@]}" -r "$SCRIPT_DIR/server/src" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
scp "${SSH_OPTS[@]}" -r "$SCRIPT_DIR/server/admin" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
scp "${SSH_OPTS[@]}" -r "$SCRIPT_DIR/server/deploy" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/server/package.json" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/server/package-lock.json" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/server/.env.example" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"

# 如果有 jest.config.js / jest.setup.js 也上传（Phase 1 引入）
if [ -f "$SCRIPT_DIR/server/jest.config.js" ]; then
  scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/server/jest.config.js" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
fi
if [ -f "$SCRIPT_DIR/server/jest.setup.js" ]; then
  scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/server/jest.setup.js" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/"
fi

# 如果有反滥用测试目录，也上传（方便 VPS 上跑 npm run test:abuse:phase1）
if [ -d "$SCRIPT_DIR/server/tests/anti-abuse" ]; then
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_IP" "mkdir -p $REMOTE_STAGE/server/tests"
  scp "${SSH_OPTS[@]}" -r "$SCRIPT_DIR/server/tests/anti-abuse" "$VPS_USER@$VPS_IP:$REMOTE_STAGE/server/tests/"
fi

echo "  上传 H5 前端..."
scp "${SSH_OPTS[@]}" -r "$SCRIPT_DIR/client/dist/build/h5/"* "$VPS_USER@$VPS_IP:$REMOTE_STAGE/client/h5/"
echo "[完成] 文件上传成功"

# 步骤 4：sudo 把文件从暂存目录同步到 /opt
# 使用 rsync --exclude=.env 以**保护已部署的 .env 不被覆盖**
# 使用 rsync --exclude=node_modules 避免清空依赖（Node.js 服务重启后会重新 npm install）
echo ""
echo "[4/5] 同步文件到 $VPS_DIR（使用 rsync，保护 .env）..."
if [ -n "$SUDO" ]; then
  echo "       ↓ 接下来可能会提示输入 sudo 密码"
fi

ssh "${SSH_OPTS[@]}" -t "$VPS_USER@$VPS_IP" "
  set -e
  $SUDO mkdir -p $VPS_DIR/server $VPS_DIR/client/h5

  # 后端：同步所有文件到 /opt/hit-circle/server，但保护 .env 和 node_modules
  $SUDO rsync -a --exclude='.env' --exclude='node_modules' \
      $REMOTE_STAGE/server/ $VPS_DIR/server/

  # H5 前端：完全同步（--delete 清理老的静态文件，避免残留）
  $SUDO rsync -a --delete $REMOTE_STAGE/client/h5/ $VPS_DIR/client/h5/

  # 清理暂存目录
  rm -rf $REMOTE_STAGE

  # 确保 deploy 脚本可执行
  $SUDO chmod +x $VPS_DIR/server/deploy/install.sh $VPS_DIR/server/deploy/setup-nginx.sh 2>/dev/null || true
"
echo "[完成] 文件同步成功"

# 步骤 5：在 VPS 上执行安装（仅首次部署需要；已安装时 install.sh 应该是幂等的）
echo ""
echo "[5/5] 是否在 VPS 上运行 install.sh 安装 Node/PM2/Nginx？"
echo "      （如果已经装过，可以跳过，等会手动 pm2 restart hit-circle 即可）"
# 无 TTY / 被后台化时 read 会失败；用 || true + 默认值兜底，避免 set -e 误杀脚本
REPLY=""
read -p "运行 install.sh？(y/N) " -n 1 -r || REPLY=""
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  ssh "${SSH_OPTS[@]}" -t "$VPS_USER@$VPS_IP" "$SUDO $VPS_DIR/server/deploy/install.sh"
  echo "[完成] 安装脚本执行成功"
else
  echo "[跳过] 未运行 install.sh"
fi

echo ""
echo "====================================="
echo "  文件上传完成！"
echo "====================================="
echo ""
echo "现在需要在 VPS 上手动完成的事："
echo ""
echo "  ssh $VPS_USER@$VPS_IP"
echo ""
echo "  # 如果是**首次部署**，配置 .env"
echo "  cd $VPS_DIR/server"
echo "  $SUDO cp .env.example .env"
echo "  $SUDO nano .env   # 填入 Supabase / Resend / Upstash / Turnstile 等密钥"
echo ""
echo "  # 装/更新依赖（Phase 1 后新增了 @upstash/redis / node-cron / axios）"
echo "  cd $VPS_DIR/server && $SUDO npm install --omit=dev"
echo ""
echo "  # 启动或重启后端"
echo "  $SUDO pm2 restart hit-circle || $SUDO pm2 start $VPS_DIR/server/deploy/ecosystem.config.js"
echo "  $SUDO pm2 save"
echo ""
echo "  # 首次部署还需配置 Nginx"
echo "  cd $VPS_DIR/server/deploy"
echo "  $SUDO cp deploy.conf.example deploy.conf"
echo "  $SUDO nano deploy.conf"
echo "  $SUDO ./setup-nginx.sh"
echo ""
echo "  # 验证"
echo "  curl -k https://$VPS_IP/api/health"
echo ""
