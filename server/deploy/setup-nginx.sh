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

# 验证必填项
if [ "$VPS_IP" = "YOUR_VPS_IP" ] || [ -z "$VPS_IP" ]; then
  echo "[错误] 请在 deploy.conf 中设置 VPS_IP"
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
echo "  VPS IP:       $VPS_IP"
echo "  后端端口:     $BACKEND_PORT"
echo "  SSL 证书:     $SSL_CERT_PATH"
echo "  SSL 私钥:     $SSL_KEY_PATH"
echo "  管理路径:     $ADMIN_PATH"
echo "  H5 目录:      $H5_ROOT_PATH"
echo "  上传限制:     $CLIENT_MAX_BODY_SIZE"
echo "====================================="

# 从模板生成配置
cp "$TEMPLATE" "$OUTPUT"

sed -i "s|YOUR_VPS_IP|$VPS_IP|g" "$OUTPUT"
sed -i "s|127.0.0.1:3000|127.0.0.1:$BACKEND_PORT|g" "$OUTPUT"
sed -i "s|SSL_CERT_PATH|$SSL_CERT_PATH|g" "$OUTPUT"
sed -i "s|SSL_KEY_PATH|$SSL_KEY_PATH|g" "$OUTPUT"
sed -i "s|ADMIN_PATH|$ADMIN_PATH|g" "$OUTPUT"
sed -i "s|H5_ROOT_PATH|$H5_ROOT_PATH|g" "$OUTPUT"
sed -i "s|client_max_body_size 30M|client_max_body_size $CLIENT_MAX_BODY_SIZE|g" "$OUTPUT"

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
  echo "现在可以访问: https://$VPS_IP"
else
  echo "[错误] Nginx 配置测试失败，请检查配置"
  exit 1
fi
