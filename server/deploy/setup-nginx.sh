#!/bin/bash
# 根据 deploy.conf 自动生成并安装 Nginx 配置
# 用法：sudo ./setup-nginx.sh

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONF_FILE="$SCRIPT_DIR/deploy.conf"
TEMPLATE="$SCRIPT_DIR/nginx.conf.example"
OUTPUT="/etc/nginx/sites-available/hit-circle"

# 检查 deploy.conf 是否存在
if [ ! -f "$CONF_FILE" ]; then
  echo "[错误] 未找到 $CONF_FILE"
  echo "请先执行: cp deploy.conf.example deploy.conf 并填入实际配置"
  exit 1
fi

# 读取配置
source "$CONF_FILE"

# 默认值兜底
DEPLOY_MODE="${DEPLOY_MODE:-ip}"

# 兼容旧配置文件：如果用户还在用 VPS_IP，自动当作 SERVER_NAME
if [ -z "$SERVER_NAME" ] && [ -n "$VPS_IP" ]; then
  SERVER_NAME="$VPS_IP"
fi

# 验证部署模式
if [ "$DEPLOY_MODE" != "ip" ] && [ "$DEPLOY_MODE" != "cloudflare" ]; then
  echo "[错误] DEPLOY_MODE 必须是 'ip' 或 'cloudflare'，当前值: $DEPLOY_MODE"
  exit 1
fi

# 验证必填项
if [ "$SERVER_NAME" = "YOUR_VPS_IP" ] || [ -z "$SERVER_NAME" ]; then
  echo "[错误] 请在 deploy.conf 中设置 SERVER_NAME"
  if [ "$DEPLOY_MODE" = "ip" ]; then
    echo "       ip 模式请填 VPS 公网 IP"
  else
    echo "       cloudflare 模式请填 CF 代理的域名（如 app.yourdomain.com）"
  fi
  exit 1
fi

if [ "$SSL_CERT_PATH" = "/path/to/cert.pem" ] || [ -z "$SSL_CERT_PATH" ]; then
  echo "[错误] 请在 deploy.conf 中设置 SSL_CERT_PATH"
  exit 1
fi

if [ "$SSL_KEY_PATH" = "/path/to/key.pem" ] || [ -z "$SSL_KEY_PATH" ]; then
  echo "[错误] 请在 deploy.conf 中设置 SSL_KEY_PATH"
  exit 1
fi

# 检查证书文件是否存在
if [ ! -f "$SSL_CERT_PATH" ]; then
  echo "[错误] 证书文件不存在: $SSL_CERT_PATH"
  exit 1
fi

if [ ! -f "$SSL_KEY_PATH" ]; then
  echo "[错误] 私钥文件不存在: $SSL_KEY_PATH"
  exit 1
fi

# 检查 H5 目录是否存在
if [ ! -d "$H5_ROOT_PATH" ]; then
  echo "[警告] H5 目录不存在: $H5_ROOT_PATH"
  echo "请确保已上传 H5 构建产物到该目录"
fi

echo "====================================="
echo "  Nginx 配置生成"
echo "====================================="
echo "  部署模式:     $DEPLOY_MODE"
echo "  server_name:  $SERVER_NAME"
echo "  后端端口:     $BACKEND_PORT"
echo "  SSL 证书:     $SSL_CERT_PATH"
echo "  SSL 私钥:     $SSL_KEY_PATH"
echo "  管理路径:     $ADMIN_PATH"
echo "  H5 目录:      $H5_ROOT_PATH"
echo "  上传限制:     $CLIENT_MAX_BODY_SIZE"
echo "====================================="

# 从模板生成配置
cp "$TEMPLATE" "$OUTPUT"

# 替换占位符
sed -i "s|SERVER_NAME_PLACEHOLDER|$SERVER_NAME|g" "$OUTPUT"
sed -i "s|127.0.0.1:3000|127.0.0.1:$BACKEND_PORT|g" "$OUTPUT"
# SSL 路径可能含 /，用 | 作分隔符
sed -i "s|SSL_CERT_PATH|$SSL_CERT_PATH|g" "$OUTPUT"
sed -i "s|SSL_KEY_PATH|$SSL_KEY_PATH|g" "$OUTPUT"
sed -i "s|ADMIN_PATH|$ADMIN_PATH|g" "$OUTPUT"
sed -i "s|H5_ROOT_PATH|$H5_ROOT_PATH|g" "$OUTPUT"
sed -i "s|client_max_body_size 30M|client_max_body_size $CLIENT_MAX_BODY_SIZE|g" "$OUTPUT"

# Cloudflare 模式：启用 real_ip 配置块（去掉注释）
if [ "$DEPLOY_MODE" = "cloudflare" ]; then
  # 把 CF_REAL_IP_START 和 CF_REAL_IP_END 之间的注释行去掉 "# " 前缀
  # 除了标记行本身
  sed -i '/#CF_REAL_IP_START/,/#CF_REAL_IP_END/ { /#CF_REAL_IP_/! s/^    # /    / }' "$OUTPUT"
  echo "[完成] 已启用 Cloudflare real_ip 配置"
fi

echo ""
echo "[完成] Nginx 配置已写入: $OUTPUT"

# 启用站点
if [ ! -L /etc/nginx/sites-enabled/hit-circle ]; then
  ln -s "$OUTPUT" /etc/nginx/sites-enabled/hit-circle
  echo "[完成] 已启用站点"
fi

# 删除默认站点（避免冲突）
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  echo "[完成] 已移除默认站点"
fi

# 测试并重载
nginx -t
if [ $? -eq 0 ]; then
  systemctl reload nginx
  echo "[完成] Nginx 已重载"
  echo ""
  if [ "$DEPLOY_MODE" = "cloudflare" ]; then
    echo "现在可通过 https://$SERVER_NAME 访问（走 Cloudflare）"
    echo "注意：首次访问前，确保在 CF DNS 面板已配置 A 记录并开启代理（橙色云）"
  else
    echo "现在可通过 https://$SERVER_NAME 访问"
  fi
else
  echo "[错误] Nginx 配置测试失败，请检查配置"
  exit 1
fi
