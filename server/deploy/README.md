# 工大圈子 部署指南

## 架构

```
Chrome / APK
     ↓ HTTPS
Nginx (443)
  ├── /              → H5 静态文件
  ├── /api/*         → Node.js:3000
  ├── /socket.io/*   → Node.js:3000 (WebSocket)
  └── /ADMIN_PATH/*  → Node.js:3000
     ↓
Supabase Cloud (PostgreSQL + Storage)
```

80 端口自动 301 重定向到 443。Chrome 和 APK 共用同一个后端。

---

## 文件说明

| 文件 | 用途 |
|------|------|
| `install.sh` | 一键安装 Node.js、PM2、Nginx、UFW |
| `deploy.conf.example` | 部署配置模板（VPS IP、证书路径等） |
| `setup-nginx.sh` | 读取 deploy.conf，自动生成并安装 Nginx 配置 |
| `nginx.conf.example` | Nginx 配置模板（被 setup-nginx.sh 使用） |
| `ecosystem.config.js` | PM2 进程管理配置 |

---

## 部署步骤

### 1. 本地：构建 H5 前端

```bash
# 编辑前端配置
# client/src/config/env.js → prod 中的 YOUR_VPS_IP 改为实际 IP
# CURRENT 改为 'prod'

cd client
npm run build:h5
# 产物在 client/dist/build/h5/
```

### 2. 本地：上传到 VPS

```bash
scp -r server user@VPS_IP:/opt/hit-circle/server/
scp -r client/dist/build/h5 user@VPS_IP:/opt/hit-circle/client/h5/
```

### 3. VPS：运行安装脚本

```bash
ssh user@VPS_IP
cd /opt/hit-circle/server/deploy
chmod +x install.sh setup-nginx.sh
sudo ./install.sh
```

### 4. VPS：配置后端

```bash
cd /opt/hit-circle/server
cp .env.example .env
nano .env
# 填入 Supabase 密钥、JWT_SECRET 等
```

### 5. VPS：启动后端

```bash
cd /opt/hit-circle/server
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup  # 按提示执行生成的命令
```

### 6. VPS：配置 Nginx

```bash
cd /opt/hit-circle/server/deploy
cp deploy.conf.example deploy.conf
nano deploy.conf
# 填入：VPS_IP、SSL_CERT_PATH、SSL_KEY_PATH 等

sudo ./setup-nginx.sh
```

### 7. 验证

```bash
curl -k https://VPS_IP/api/health
# 应返回 {"status":"ok","time":"..."}

# 浏览器打开 https://VPS_IP，应看到登录页
```

---

## 可配置项

| 配置项 | 文件 | 说明 |
|--------|------|------|
| `DEPLOY_MODE` | `deploy.conf` | `ip` 或 `cloudflare`，决定是否启用 CF real_ip |
| `SERVER_NAME` | `deploy.conf` | ip 模式填 VPS IP；cloudflare 模式填域名 |
| `BACKEND_PORT` | `deploy.conf` / `.env` | 后端端口，默认 3000 |
| `SSL_CERT_PATH` | `deploy.conf` | HTTPS 证书路径（CF 模式用 Origin Certificate） |
| `SSL_KEY_PATH` | `deploy.conf` | HTTPS 私钥路径 |
| `ADMIN_PATH` | `deploy.conf` / `.env` | 管理后台 URL 路径 |
| `H5_ROOT_PATH` | `deploy.conf` | H5 静态文件目录 |
| `CLIENT_MAX_BODY_SIZE` | `deploy.conf` | 最大上传大小，默认 30M |
| `SUPABASE_URL` | `.env` | Supabase 项目地址 |
| `SUPABASE_ANON_KEY` | `.env` | Supabase 匿名密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` | Supabase 服务密钥 |
| `JWT_SECRET` | `.env` | JWT 签名密钥 |

完整部署教程（ip 模式、cloudflare 模式、APK 构建）见项目根目录的 `GUIDE.md`。

---

## 常用运维命令

```bash
# 后端
pm2 status                     # 查看状态
pm2 logs hit-circle            # 查看日志
pm2 restart hit-circle         # 重启
pm2 monit                      # 实时监控

# Nginx
sudo systemctl status nginx    # 状态
sudo nginx -t                  # 测试配置
sudo systemctl reload nginx    # 重载

# 更新后端代码
cd /opt/hit-circle/server
npm install --production
pm2 restart hit-circle

# 更新前端（本地构建后上传，无需重启）
scp -r dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
```

---

## 故障排查

| 问题 | 检查 |
|------|------|
| 打不开页面 | `sudo systemctl status nginx` |
| 登录失败 | `pm2 logs hit-circle` |
| 聊天连不上 | 检查 Nginx `/socket.io/` 配置 |
| 上传失败 | `client_max_body_size` 和 Supabase Storage 配额 |
| APK 连不上 | `env.js` 中 prod IP 是否正确 |
