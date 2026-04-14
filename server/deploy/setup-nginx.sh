#!/bin/bash
# 根据 deploy.conf 自动生成并安装 Nginx 配置
# 用法：sudo ./setup-nginx.sh
#
# 注意：本脚本仅操作 Nginx 配置，不会修改 UFW 防火墙、不会重启其他服务。
#       你在 VPS 上手动放行的端口（如 2219 / 3x-ui 面板 / 代理节点端口）不受影响。

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONF_FILE="$SCRIPT_DIR/deploy.conf"
SINGLE_TEMPLATE="$SCRIPT_DIR/nginx.conf.example"
SPLIT_TEMPLATE="$SCRIPT_DIR/nginx.split.conf.example"
OUTPUT="/etc/nginx/sites-available/hit-circle"

if [ ! -f "$CONF_FILE" ]; then
  echo "[错误] 未找到 $CONF_FILE"
  echo "请先执行: cp deploy.conf.example deploy.conf 并填入实际配置"
  exit 1
fi

source "$CONF_FILE"

DEPLOY_MODE="${DEPLOY_MODE:-ip}"

# 兼容旧字段：VPS_IP → SERVER_NAME
if [ -z "$SERVER_NAME" ] && [ -n "$VPS_IP" ]; then
  SERVER_NAME="$VPS_IP"
fi

# ---------- 模式校验 ----------
case "$DEPLOY_MODE" in
  ip|cloudflare|cloudflare-split) ;;
  *)
    echo "[错误] DEPLOY_MODE 必须是 ip / cloudflare / cloudflare-split，当前: $DEPLOY_MODE"
    exit 1
    ;;
esac

# ---------- 证书校验 ----------
if [ "$SSL_CERT_PATH" = "/path/to/cert.pem" ] || [ -z "$SSL_CERT_PATH" ]; then
  echo "[错误] 请在 deploy.conf 中设置 SSL_CERT_PATH"
  exit 1
fi
if [ "$SSL_KEY_PATH" = "/path/to/key.pem" ] || [ -z "$SSL_KEY_PATH" ]; then
  echo "[错误] 请在 deploy.conf 中设置 SSL_KEY_PATH"
  exit 1
fi
if [ ! -f "$SSL_CERT_PATH" ]; then
  echo "[错误] 证书文件不存在: $SSL_CERT_PATH"
  exit 1
fi
if [ ! -f "$SSL_KEY_PATH" ]; then
  echo "[错误] 私钥文件不存在: $SSL_KEY_PATH"
  exit 1
fi

# ---------- H5 目录提示 ----------
if [ ! -d "$H5_ROOT_PATH" ]; then
  echo "[警告] H5 目录不存在: $H5_ROOT_PATH（请确保已上传前端构建产物）"
fi

# ---------- 按模式分流 ----------
if [ "$DEPLOY_MODE" = "cloudflare-split" ]; then
  # 双子域名模式
  if [ -z "$WEB_SERVER_NAME" ] || [ "$WEB_SERVER_NAME" = "www.yourdomain.com" ]; then
    echo "[错误] DEPLOY_MODE=cloudflare-split 需要设置 WEB_SERVER_NAME"
    exit 1
  fi
  if [ -z "$API_SERVER_NAME" ] || [ "$API_SERVER_NAME" = "app.yourdomain.com" ]; then
    echo "[错误] DEPLOY_MODE=cloudflare-split 需要设置 API_SERVER_NAME"
    exit 1
  fi

  echo "====================================="
  echo "  Nginx 配置生成（split 模式）"
  echo "====================================="
  echo "  部署模式:          $DEPLOY_MODE"
  echo "  www 入口:          $WEB_SERVER_NAME"
  echo "  app 入口:          $API_SERVER_NAME"
  echo "  后端端口:          $BACKEND_PORT"
  echo "  SSL 证书:          $SSL_CERT_PATH"
  echo "  SSL 私钥:          $SSL_KEY_PATH"
  echo "  管理路径:          $ADMIN_PATH"
  echo "  H5 目录:           $H5_ROOT_PATH"
  echo "  上传限制:          $CLIENT_MAX_BODY_SIZE"
  echo "====================================="

  cp "$SPLIT_TEMPLATE" "$OUTPUT"

  sed -i "s|WEB_SERVER_NAME_PLACEHOLDER|$WEB_SERVER_NAME|g" "$OUTPUT"
  sed -i "s|API_SERVER_NAME_PLACEHOLDER|$API_SERVER_NAME|g" "$OUTPUT"
  sed -i "s|127.0.0.1:3000|127.0.0.1:$BACKEND_PORT|g" "$OUTPUT"
  sed -i "s|SSL_CERT_PATH|$SSL_CERT_PATH|g" "$OUTPUT"
  sed -i "s|SSL_KEY_PATH|$SSL_KEY_PATH|g" "$OUTPUT"
  sed -i "s|ADMIN_PATH|$ADMIN_PATH|g" "$OUTPUT"
  sed -i "s|H5_ROOT_PATH|$H5_ROOT_PATH|g" "$OUTPUT"
  sed -i "s|client_max_body_size 30M|client_max_body_size $CLIENT_MAX_BODY_SIZE|g" "$OUTPUT"

  # split 模式默认启用 CF real_ip（两个 server 块都要）
  sed -i '/#CF_REAL_IP_START/,/#CF_REAL_IP_END/ { /#CF_REAL_IP_/! s/^    # /    / }' "$OUTPUT"
  echo "[完成] 已启用 Cloudflare real_ip 配置（两个 server 块）"

else
  # 单域名模式：ip 或 cloudflare
  if [ "$SERVER_NAME" = "YOUR_VPS_IP" ] || [ -z "$SERVER_NAME" ]; then
    echo "[错误] 请在 deploy.conf 中设置 SERVER_NAME"
    exit 1
  fi

  echo "====================================="
  echo "  Nginx 配置生成（single 模式）"
  echo "====================================="
  echo "  部署模式:          $DEPLOY_MODE"
  echo "  server_name:       $SERVER_NAME"
  echo "  后端端口:          $BACKEND_PORT"
  echo "  SSL 证书:          $SSL_CERT_PATH"
  echo "  SSL 私钥:          $SSL_KEY_PATH"
  echo "  管理路径:          $ADMIN_PATH"
  echo "  H5 目录:           $H5_ROOT_PATH"
  echo "  上传限制:          $CLIENT_MAX_BODY_SIZE"
  echo "====================================="

  cp "$SINGLE_TEMPLATE" "$OUTPUT"

  sed -i "s|SERVER_NAME_PLACEHOLDER|$SERVER_NAME|g" "$OUTPUT"
  sed -i "s|127.0.0.1:3000|127.0.0.1:$BACKEND_PORT|g" "$OUTPUT"
  sed -i "s|SSL_CERT_PATH|$SSL_CERT_PATH|g" "$OUTPUT"
  sed -i "s|SSL_KEY_PATH|$SSL_KEY_PATH|g" "$OUTPUT"
  sed -i "s|ADMIN_PATH|$ADMIN_PATH|g" "$OUTPUT"
  sed -i "s|H5_ROOT_PATH|$H5_ROOT_PATH|g" "$OUTPUT"
  sed -i "s|client_max_body_size 30M|client_max_body_size $CLIENT_MAX_BODY_SIZE|g" "$OUTPUT"

  if [ "$DEPLOY_MODE" = "cloudflare" ]; then
    sed -i '/#CF_REAL_IP_START/,/#CF_REAL_IP_END/ { /#CF_REAL_IP_/! s/^    # /    / }' "$OUTPUT"
    echo "[完成] 已启用 Cloudflare real_ip 配置"
  fi
fi

echo ""
echo "[完成] Nginx 配置已写入: $OUTPUT"

if [ ! -L /etc/nginx/sites-enabled/hit-circle ]; then
  ln -s "$OUTPUT" /etc/nginx/sites-enabled/hit-circle
  echo "[完成] 已启用站点"
fi

if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  echo "[完成] 已移除 Nginx 默认站点（不影响其他服务）"
fi

nginx -t
if [ $? -eq 0 ]; then
  systemctl reload nginx
  echo "[完成] Nginx 已重载（不会影响 x-ui、防火墙等其他服务）"
  echo ""
  if [ "$DEPLOY_MODE" = "cloudflare-split" ]; then
    echo "浏览器访问：https://$WEB_SERVER_NAME"
    echo "APK 连接：  https://$API_SERVER_NAME/api"
  else
    echo "访问地址：  https://$SERVER_NAME"
  fi
else
  echo "[错误] Nginx 配置测试失败"
  exit 1
fi
