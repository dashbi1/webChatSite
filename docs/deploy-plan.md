# 部署方案 - 工大圈子 VPS 全栈部署

## 目标

一台 Ubuntu 22.04 VPS，同时对 Chrome 浏览器和 Android APK 提供服务。

```
Chrome 浏览器                  Android APK
     │                             │
     └──────────┬──────────────────┘
                ↓
         https://VPS_IP
                ↓
    ┌──── Nginx (443) ─────┐
    │                       │
    │  80 → 301 重定向 443  │
    │                       │
    ├── /              → H5 静态文件（uni-app build 产物）
    ├── /api/*         → Node.js:3000（Express REST API）
    ├── /socket.io/*   → Node.js:3000（WebSocket 实时聊天）
    └── /ADMIN_PATH/*  → Node.js:3000（管理后台）
                ↓
          Supabase Cloud（PostgreSQL + Storage）
```

## 关键说明

### 文件上传

当前代码中，头像和帖子图片/视频实际上传到 **Supabase Storage**（云端），不是 VPS 本地磁盘。
这对部署反而是好事 —— 不用担心 VPS 磁盘空间和文件备份问题。
`server/uploads/` 目录目前未被使用，无需特殊配置。

### 一个后端服务两种客户端

后端是标准 REST API + Socket.io，不区分客户端类型。Chrome 和 APK 用完全相同的 API 地址：
- Chrome：用户打开 `https://VPS_IP`，Nginx 返回 H5 页面，页面内的 JS 请求 `https://VPS_IP/api/*`
- APK：打包时 `env.js` 写死 `https://VPS_IP`，APK 内的 WebView 请求同样的地址

---

## 一、需要改动的文件

### 1.1 前端配置 `client/src/config/env.js`

**改动内容：** 把 `prod` 配置改为 HTTPS，并明确注释配置方法。

```js
prod: {
  // ⚠️ 部署前必改：换成你的 VPS 公网 IP
  API_BASE: 'https://YOUR_VPS_IP/api',
  SOCKET_URL: 'https://YOUR_VPS_IP',
},
```

**配置项：**
| 需要改的地方 | 说明 |
|---|---|
| `YOUR_VPS_IP` | VPS 公网 IP，如 `123.45.67.89` |
| `CURRENT` | 部署时改为 `'prod'` |

### 1.2 后端环境变量 `server/.env`

**无需改代码**，部署时在 VPS 上创建 `.env` 文件即可。

**配置项：**
| 变量 | 说明 | 示例 |
|---|---|---|
| `SUPABASE_URL` | Supabase 项目 URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥 | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务密钥 | `eyJ...` |
| `JWT_SECRET` | JWT 签名密钥（至少 32 位随机字符串） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | 后端监听端口（Nginx 反向代理的目标） | `3000` |
| `ADMIN_PATH` | 管理后台隐藏路径 | `console-k8m2x7` |

### 1.3 Nginx 配置 `server/deploy/nginx.conf.example`

**改动内容：** 重写为完整的 HTTPS 配置，包含：
- 80 端口 → 301 重定向到 443
- 443 端口 HTTPS，使用 IP 证书
- H5 静态文件托管（`location /`）
- API 反向代理（`location /api/`）
- WebSocket 代理（`location /socket.io/`）
- 管理后台代理（`location /ADMIN_PATH/`）

**配置项：**
| 需要改的地方 | 说明 |
|---|---|
| `YOUR_VPS_IP` | VPS 公网 IP |
| `SSL_CERT_PATH` | SSL 证书文件路径，如 `/etc/ssl/certs/server.pem` |
| `SSL_KEY_PATH` | SSL 私钥文件路径，如 `/etc/ssl/private/server.key` |
| `ADMIN_PATH` | 与 `.env` 中的 `ADMIN_PATH` 保持一致 |
| `H5_ROOT_PATH` | H5 构建产物的路径，默认 `/opt/hit-circle/client/dist/build/h5` |

### 1.4 部署脚本 `server/deploy/install.sh`

**改动内容：** 现有脚本基本可用，但缺少前端 H5 的构建和部署步骤。补充：
- 提示用户配置 Nginx 中的 SSL 证书路径
- 提示用户构建和上传 H5 前端

### 1.5 新增文件：部署配置模板 `server/deploy/deploy.conf.example`

集中管理所有可配置项，部署时只需改这一个文件，然后用脚本自动替换到各处。

```bash
# ============ 部署配置 ============
VPS_IP=YOUR_VPS_IP
BACKEND_PORT=3000
SSL_CERT_PATH=/path/to/cert.pem
SSL_KEY_PATH=/path/to/key.pem
ADMIN_PATH=console-k8m2x7
H5_ROOT_PATH=/opt/hit-circle/client/h5
CLIENT_MAX_BODY_SIZE=30M
```

---

## 二、部署流程（按顺序执行）

### 步骤 1：本地 - 修改前端配置并构建 H5

```bash
# 1. 编辑 client/src/config/env.js
#    把 prod.API_BASE 和 prod.SOCKET_URL 里的 YOUR_VPS_IP 改成实际 IP
#    把 CURRENT 改为 'prod'

# 2. 构建 H5
cd client
npm run build:h5
# 产物在 client/dist/build/h5/
```

### 步骤 2：本地 - 上传代码到 VPS

```bash
# 上传整个项目（或分开上传 server/ 和 H5 产物）
scp -r . user@VPS_IP:/opt/hit-circle/

# 或者只传必要的部分：
scp -r server user@VPS_IP:/opt/hit-circle/server/
scp -r client/dist/build/h5 user@VPS_IP:/opt/hit-circle/client/h5/
```

### 步骤 3：VPS - 运行安装脚本

```bash
ssh user@VPS_IP
cd /opt/hit-circle/server/deploy
chmod +x install.sh
sudo ./install.sh
```

### 步骤 4：VPS - 配置后端 .env

```bash
cd /opt/hit-circle/server
cp .env.example .env
nano .env
# 填入 Supabase 密钥和 JWT_SECRET 等
```

### 步骤 5：VPS - 启动后端

```bash
cd /opt/hit-circle/server
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup  # 按提示执行生成的命令，实现开机自启
```

### 步骤 6：VPS - 配置 Nginx

```bash
# 1. 复制配置
sudo cp /opt/hit-circle/server/deploy/nginx.conf.example \
        /etc/nginx/sites-available/hit-circle

# 2. 编辑配置，替换以下占位符：
sudo nano /etc/nginx/sites-available/hit-circle
#    - YOUR_VPS_IP → 实际 IP
#    - SSL_CERT_PATH → 证书路径
#    - SSL_KEY_PATH → 私钥路径
#    - ADMIN_PATH → 管理后台路径（与 .env 一致）
#    - H5_ROOT_PATH → H5 产物路径

# 3. 启用并测试
sudo ln -s /etc/nginx/sites-available/hit-circle /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default  # 删除默认站点
sudo nginx -t
sudo systemctl reload nginx
```

### 步骤 7：验证

```bash
# 1. 后端健康检查
curl -k https://VPS_IP/api/health
# 应返回 {"status":"ok","time":"..."}

# 2. 打开 Chrome 访问 https://VPS_IP
#    应看到登录页面
```

---

## 三、Chrome 使用教程（给自己看）

### 首次访问

1. 打开 Chrome，地址栏输入 `https://你的VPS_IP`
2. 如果证书是自签名的，Chrome 会提示"您的连接不是私密连接"
   - 点击"高级" → "继续前往 xxx（不安全）"
   - 这只需要做一次，之后 Chrome 会记住
3. 看到登录页面，使用已有账号登录，或注册新账号

### 日常使用

- 直接访问 `https://你的VPS_IP` 即可，和普通网站一样
- 支持所有功能：发帖、聊天、添加好友、通知等
- 管理后台：`https://你的VPS_IP/console-k8m2x7`（用 admin 账号 13800000001 / test123）

### 添加到桌面（可选）

Chrome 地址栏右侧 → 三个点菜单 → "安装工大圈子"（如果支持 PWA）或"创建快捷方式" → 勾选"在窗口中打开"，这样它就像一个桌面应用。

---

## 四、Android APK 配置

和 Chrome 用同一个后端，只是 API 地址在打包时写死。

1. 编辑 `client/src/config/env.js`，确认 `prod` 配置中的 IP 正确，`CURRENT = 'prod'`
2. 构建 H5：`npm run build:h5`
3. 同步到 Android 项目：`npx cap sync android`
4. 用 Android Studio 打开 `client/android/`，Build → Build APK
5. 安装到手机

**如果 VPS IP 变了**：需要重新改 `env.js` → 重新构建 → 重新打包 APK。

---

## 五、所有可配置项汇总

| 配置项 | 文件 | 说明 |
|---|---|---|
| `VPS_IP` | `client/src/config/env.js` (prod) | 前端连接的后端地址 |
| `VPS_IP` | `nginx.conf` (server_name) | Nginx 绑定的 IP |
| `BACKEND_PORT` | `server/.env` (PORT) + `nginx.conf` (upstream) + `ecosystem.config.js` | 后端监听端口，默认 3000 |
| `SSL_CERT_PATH` | `nginx.conf` (ssl_certificate) | HTTPS 证书路径 |
| `SSL_KEY_PATH` | `nginx.conf` (ssl_certificate_key) | HTTPS 私钥路径 |
| `ADMIN_PATH` | `server/.env` + `nginx.conf` | 管理后台 URL 路径 |
| `H5_ROOT_PATH` | `nginx.conf` (root) | H5 静态文件目录 |
| `CLIENT_MAX_BODY_SIZE` | `nginx.conf` | 最大上传文件大小，默认 30M |
| `MAX_MEMORY_RESTART` | `ecosystem.config.js` | PM2 内存限制，默认 500M |
| `SUPABASE_URL` | `server/.env` | Supabase 项目地址 |
| `SUPABASE_ANON_KEY` | `server/.env` | Supabase 匿名密钥 |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/.env` | Supabase 服务密钥 |
| `JWT_SECRET` | `server/.env` | JWT 签名密钥 |

---

## 六、更新代码流程（日后改了代码后重新部署）

### 只改了后端

```bash
# VPS 上执行
cd /opt/hit-circle/server
# 上传新代码（git pull 或 scp）
npm install --production
pm2 restart hit-circle
```

### 只改了前端

```bash
# 本地执行
cd client
npm run build:h5

# 上传 H5 产物到 VPS
scp -r dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/

# VPS 上无需重启任何服务，Nginx 直接返回新文件
```

### 前后端都改了

先传后端重启 PM2，再传前端。

---

## 七、故障排查

| 问题 | 检查方法 |
|---|---|
| Chrome 打不开页面 | `sudo systemctl status nginx` 看 Nginx 是否在跑 |
| 页面打开了但登录失败 | `pm2 logs hit-circle` 看后端日志 |
| WebSocket 聊天连不上 | 检查 Nginx 配置中 `/socket.io/` 的 proxy 设置 |
| 上传图片失败 | 检查 `client_max_body_size` 和 Supabase Storage 配额 |
| APK 无法连接后端 | 确认 `env.js` 中 prod 的 IP 和 VPS 实际 IP 一致 |
| 证书过期（8天 renew） | 检查证书自动续期任务是否正常 |
