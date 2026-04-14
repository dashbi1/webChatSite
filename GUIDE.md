# 工大圈子 - 部署与使用指南

---

## 部署模式选择

本项目支持三种部署模式，首次部署前需要决定用哪种：

| 模式 | 用户访问方式 | 何时选择 |
|------|------------|----------|
| **ip 模式** | `https://VPS_IP` | 没有域名，或者只是个人自用 |
| **cloudflare 模式**（单域名） | `https://yourdomain.com` | 有域名，但只用一个子域名 |
| **cloudflare-split 模式**（双子域名） | 浏览器 `https://www.xxx`<br>APK 用 `https://app.xxx` | **推荐**：浏览器和 APK 走不同入口，前端运行时自动切换 |

三种模式在 `deploy.conf` 里的 `DEPLOY_MODE` 一键切换，日后想换随时换。

> **split 模式特点**：
> - `www.yourdomain.com` → H5 + API + Socket.io + 管理后台（浏览器全家桶）
> - `app.yourdomain.com` → 仅 API + Socket.io（APK 专用，其他路径 301 到 www）
> - H5 里的 API 调用会**运行时判断**：浏览器同源调用 www/api（无 CORS），APK 走 app/api
> - 浏览器用户 URL 栏永远是 `www.xxx`，品牌感更清爽

---

## 目录

- [A. 部署（ip 模式）](#a-部署ip-模式)
- [B. 部署（cloudflare 模式，单域名）](#b-部署cloudflare-模式)
- [B2. 部署（cloudflare-split 模式，推荐）](#b2-部署cloudflare-split-模式推荐)
- [C. Chrome 使用](#c-chrome-使用)
- [D. 生成 Android APK](#d-生成-android-apk)
- [E. 日后更新代码](#e-日后更新代码)
- [F. 在 ip 和 cloudflare 模式间切换](#f-在-ip-和-cloudflare-模式间切换)
- [G. 故障排查](#g-故障排查)

---

## A. 部署（ip 模式）

### 架构

```
Chrome / APK
     ↓ HTTPS
  VPS_IP
     ↓
  Nginx (443)
     ├── /              → H5 静态文件
     ├── /api/*         → Node.js:3000
     ├── /socket.io/*   → Node.js:3000 (WebSocket)
     └── /ADMIN_PATH/*  → Node.js:3000
     ↓
  Supabase Cloud
```

### 前提

- Ubuntu 22.04 VPS，有公网 IP
- VPS 上已有 HTTPS 证书（IP 或域名证书都行）
- 本地装了 Node.js、npm
- 能 SSH 到 VPS

### 第 1 步：改前端配置

**文件**：`client/src/config/env.js`

```js
prod: {
  API_BASE: 'https://123.45.67.89/api',     // 换成你的 VPS IP
  SOCKET_URL: 'https://123.45.67.89',
},

const CURRENT = 'prod';
```

### 第 2 步：本地构建 H5

```bash
cd client
npm run build:h5
```

### 第 3 步：上传到 VPS

**方式 A：一键脚本**（推荐）

```bash
# 编辑 deploy-to-vps.sh 头部，填 VPS_USER 和 VPS_IP
nano deploy-to-vps.sh

chmod +x deploy-to-vps.sh
./deploy-to-vps.sh
```

**方式 B：手动 scp**

```bash
ssh user@VPS_IP "mkdir -p /opt/hit-circle/server /opt/hit-circle/client/h5"
scp -r server/src server/admin server/deploy server/package.json server/package-lock.json server/.env.example user@VPS_IP:/opt/hit-circle/server/
scp -r client/dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
```

### 第 4 步：VPS 上运行安装脚本

```bash
ssh user@VPS_IP
cd /opt/hit-circle/server/deploy
chmod +x install.sh setup-nginx.sh
sudo ./install.sh
```

安装 Node.js 20、PM2、Nginx、UFW。

### 第 5 步：配置后端 .env

```bash
cd /opt/hit-circle/server
cp .env.example .env
nano .env
```

填入 Supabase 密钥、JWT_SECRET、PORT=3000、ADMIN_PATH 等。

### 第 6 步：启动后端

```bash
cd /opt/hit-circle/server
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup  # 按提示执行输出的那行命令
```

### 第 7 步：配置 Nginx（ip 模式）

```bash
cd /opt/hit-circle/server/deploy
cp deploy.conf.example deploy.conf
nano deploy.conf
```

**ip 模式必改字段**：

```bash
DEPLOY_MODE=ip
SERVER_NAME=123.45.67.89          # ← 你的 VPS 公网 IP
SSL_CERT_PATH=/path/to/cert.pem   # ← 证书文件
SSL_KEY_PATH=/path/to/key.pem     # ← 私钥文件
```

运行：

```bash
sudo ./setup-nginx.sh
```

### 第 8 步：别忘了放行防火墙

如果 VPS 上还跑着 3x-ui 等其他服务：

```bash
sudo ufw allow 2219/tcp    # 3x-ui 面板端口（按实际改）
sudo ufw allow 30001/tcp   # 代理节点端口（按实际改）
sudo ufw status
```

### 第 9 步：验证

```bash
curl -k https://127.0.0.1/api/health
# 返回 {"status":"ok","time":"..."}

# 浏览器打开 https://你的VPS_IP
```

---

## B. 部署（cloudflare 模式）

### 架构

```
Chrome / APK
     ↓ HTTPS
app.yourdomain.com
     ↓
  Cloudflare 边缘节点（防 DDoS、隐藏源 IP）
     ↓ HTTPS（CF Origin 证书）
  VPS → Nginx (443)
     ├── /              → H5 静态文件
     ├── /api/*         → Node.js:3000
     └── /socket.io/*   → Node.js:3000

另一路（不经 CF）：
代理客户端 / 3x-ui 面板
     ↓
proxy.yourdomain.com (灰色云 = DNS only)
     ↓
  VPS → Xray/3x-ui
```

### 前提

- 已经完成 **ip 模式**的前 6 步（后端跑起来）
- 有自己的域名
- 域名的 NS 已经改成 Cloudflare 给的

### 第 1 步：Cloudflare DNS 配置

登录 CF → 你的域名 → DNS → 加两条 A 记录：

| Name | Type | Content | Proxy |
|------|------|---------|-------|
| `app` | A | VPS_IP | 🟠 Proxied |
| `proxy` | A | VPS_IP | ⚪ DNS only |

- `app.yourdomain.com` 走 CF 代理，用户看不到 VPS 真实 IP
- `proxy.yourdomain.com` 直连 VPS，用于 3x-ui 面板和代理节点

### 第 2 步：Cloudflare SSL 配置

CF → SSL/TLS → Overview：
- 模式选 **Full (strict)**

CF → SSL/TLS → Origin Server：
- 点 **Create Certificate**
- Hostnames 写：`app.yourdomain.com`（或 `*.yourdomain.com`）
- Validity：15 years
- 生成后会给你 **Certificate**（公钥）和 **Private Key**（私钥）两块内容

### 第 3 步：把 Origin Certificate 存到 VPS

```bash
ssh user@VPS_IP
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/app.pem        # 粘贴 Certificate 内容
sudo nano /etc/ssl/cloudflare/app.key        # 粘贴 Private Key 内容
sudo chmod 600 /etc/ssl/cloudflare/app.key
```

### 第 4 步：改前端配置

**文件**：`client/src/config/env.js`

```js
prod: {
  API_BASE: 'https://app.yourdomain.com/api',
  SOCKET_URL: 'https://app.yourdomain.com',
},

const CURRENT = 'prod';
```

然后 `cd client && npm run build:h5`，把新的 H5 产物 scp 到 VPS。

### 第 5 步：改 deploy.conf，切到 cloudflare 模式

```bash
cd /opt/hit-circle/server/deploy
nano deploy.conf
```

**改这几处**：

```bash
DEPLOY_MODE=cloudflare
SERVER_NAME=app.yourdomain.com                          # ← 域名
SSL_CERT_PATH=/etc/ssl/cloudflare/app.pem               # ← CF Origin 证书
SSL_KEY_PATH=/etc/ssl/cloudflare/app.key                # ← CF Origin 私钥
```

运行：

```bash
sudo ./setup-nginx.sh
```

脚本会自动启用 CF 的 `real_ip` 配置（从 `CF-Connecting-IP` 头里拿真实客户端 IP），否则日志里全是 CF 的 IP。

### 第 6 步：3x-ui 面板 / 代理节点改用 proxy 子域名

在 3x-ui 面板里，把每个节点的 **SNI / 连接地址** 从原来的 IP 或旧域名改成 `proxy.yourdomain.com`。客户端配置同步更新。

面板访问地址也改成 `https://proxy.yourdomain.com:2219/uri`。

### 第 7 步：验证

```bash
# VPS 上测试 CF 回源这段
curl -k https://127.0.0.1/api/health --resolve 127.0.0.1:443:127.0.0.1 -H "Host: app.yourdomain.com"

# 浏览器打开 https://app.yourdomain.com
# 看到登录页说明成功
```

---

## B2. 部署（cloudflare-split 模式，推荐）

### 架构

```
浏览器用户                   APK 用户                     代理用户
   ↓                            ↓                             ↓
https://www.xxx        https://app.xxx              ppy.xxx:30001
   ↓ (CF 橙云)            ↓ (CF 橙云)                    ↓ (CF 灰云，直连)
       Cloudflare 边缘节点                              VPS → Xray
           ↓
       VPS Nginx 443
           │
           ├── server www.xxx → H5 / API / Socket.io / 管理后台
           └── server app.xxx → API / Socket.io（其他路径 301 到 www）
```

**运行时地址判断**（在 `client/src/config/env.js` 里已实现）：
- APK 里的 H5（Capacitor 环境）→ 自动用 `app.xxx/api`
- 浏览器里的 H5（访问 `www.xxx`）→ 自动用 `window.location.origin + '/api'`（即 `www.xxx/api`，同源无 CORS）

### 前提

- 已完成 A 节前 6 步（后端跑起来）
- 有域名，NS 已经改到 Cloudflare
- Cloudflare Origin Certificate **覆盖 www 和 app 两个子域名**（或用 `*.yourdomain.com` 通配符）

### 第 1 步：Cloudflare DNS

在 CF DNS 面板加三条 A 记录：

| Name | Type | Content | Proxy |
|------|------|---------|-------|
| `www` | A | VPS_IP | 🟠 Proxied |
| `app` | A | VPS_IP | 🟠 Proxied |
| `ppy` | A | VPS_IP | ⚪ DNS only |

`ppy.yourdomain.com` 是给 3x-ui 和代理节点直连用的。

### 第 2 步：确认 Origin Certificate 覆盖两个子域名

CF → SSL/TLS → Origin Server → Create Certificate，Hostnames 填：
```
www.yourdomain.com
app.yourdomain.com
```

或者一劳永逸：`*.yourdomain.com`（签发时 15 年有效期）。

把 Certificate 和 Private Key 存到 VPS：

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/origin.pem   # 粘贴 Certificate
sudo nano /etc/ssl/cloudflare/origin.key   # 粘贴 Private Key
sudo chmod 600 /etc/ssl/cloudflare/origin.key
```

### 第 3 步：改前端 env.js（一次性，不用再改）

**文件**：`client/src/config/env.js`

```js
prod: {
  APK_API_HOST: 'https://app.yourdomain.com',        // APK 走这里
  WEB_FALLBACK_HOST: 'https://www.yourdomain.com',   // 浏览器兜底
},

const CURRENT = 'prod';
```

这份 env.js **APK 和 H5 共用**，不用为了两种环境构建两次。

### 第 4 步：本地构建 H5

```bash
cd client
npm run build:h5
```

### 第 5 步：上传 H5 到 VPS

```bash
scp -r client/dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
```

### 第 6 步：改 deploy.conf，切到 split 模式

```bash
ssh user@VPS_IP
cd /opt/hit-circle/server/deploy
nano deploy.conf
```

改这几处：

```bash
DEPLOY_MODE=cloudflare-split
WEB_SERVER_NAME=www.yourdomain.com
API_SERVER_NAME=app.yourdomain.com
SSL_CERT_PATH=/etc/ssl/cloudflare/origin.pem
SSL_KEY_PATH=/etc/ssl/cloudflare/origin.key
# 其他字段保持不变
```

运行：

```bash
sudo ./setup-nginx.sh
```

脚本会：
- 用 split 模板生成两个 server 块（www + app）
- 自动启用 CF real_ip 配置
- 测试 Nginx 配置 + reload
- **不会碰 UFW 防火墙，也不会重启 x-ui 等其他服务**

### 第 7 步：3x-ui 节点指向 ppy 子域名

在 3x-ui 面板里：
- 节点的 **SNI / 伪装域名** 改为 `ppy.yourdomain.com`
- 客户端连接地址同步更新

面板访问地址：`https://ppy.yourdomain.com:2219/uri`（不经过 Nginx）

### 第 8 步：重新打包 APK

```bash
cd client
# env.js 已经在第 3 步改好了，这里直接构建
npm run build:h5
npx cap sync android
# Android Studio → Build APK → 装到手机
```

### 第 9 步：验证

```bash
# 浏览器访问 www（应看到 H5 登录页，地址栏保持 www.xxx）
https://www.yourdomain.com

# 浏览器访问 app（应被 301 跳转到 www）
https://app.yourdomain.com

# APK 打开后，打 login/发帖/收消息流程，后端日志应能看到请求来自 app.yourdomain.com
```

浏览器 DevTools Network 里你会看到：
- 打开 www.xxx 后，API 请求全部发给 `/api/*`（同域）
- 不会有跨域 OPTIONS 预检

### 后续切换

日后想换模式（比如改回单域名），只需改 `deploy.conf` 的 `DEPLOY_MODE`，重跑 `sudo ./setup-nginx.sh`。前端代码不用动 —— env.js 对 ip / 单域名 / split 三种情况都会用 `window.location.origin` 自适配（APK 始终走 APK_API_HOST）。

---

## C. Chrome 使用

### ip 模式

1. 地址栏输入 `https://VPS_IP`
2. 第一次会提示证书不受信任，点"高级" → "继续前往"
3. 登录使用

### cloudflare 模式

1. 地址栏输入 `https://app.yourdomain.com`
2. CF 的证书浏览器原生信任，不会有警告
3. 登录使用

### 管理后台

- ip 模式：`https://VPS_IP/console-k8m2x7`
- cloudflare 模式：`https://app.yourdomain.com/console-k8m2x7`

管理员账号：13800000001 / test123

---

## D. 生成 Android APK

### 流程总览

```
  client/ 目录下
    1. 改 env.js（填 prod 地址，IP 或域名）
    2. npm run build:h5
    3. npx cap sync android
    4. Android Studio 打开 client/android/ → Build APK
```

### 第 1 步：确认分支

APK 构建依赖 Capacitor，文件在 `dev/android` 分支（或已合并到 main）：

```bash
git checkout dev/android   # 或者就在 main
```

### 第 2 步：改 env.js

**文件**：`client/src/config/env.js`

- **ip 模式**：填 `https://你的VPS_IP/api`
- **cloudflare 模式**：填 `https://app.yourdomain.com/api`

```js
prod: {
  API_BASE: 'https://app.yourdomain.com/api',
  SOCKET_URL: 'https://app.yourdomain.com',
},

const CURRENT = 'prod';
```

### 第 3 步：构建 H5 并同步到 Android

```bash
cd client
npm run build:h5
npx cap sync android
```

### 第 4 步：Android Studio 构建 APK

1. 打开 Android Studio
2. `File → Open` → 选择 `client/android` 目录
3. 等 Gradle Sync 完成
4. `Build → Build Bundle(s) / APK(s) → Build APK(s)`
5. 完成后点右下角 `locate` 打开 APK 文件夹

**APK 位置**：`client/android/app/build/outputs/apk/debug/app-debug.apk`

### 第 5 步：安装到手机

- USB 线：`adb install app-debug.apk`
- 或发微信 / QQ 给自己，点开安装
- 手机需要开启"允许安装未知来源应用"

### 后端地址变了怎么办？

只要改了 `env.js` 里的 prod 地址，APK 就必须重新打包：

```bash
cd client
npm run build:h5
npx cap sync android
# Android Studio 重新 Build APK
# 手机上卸载旧版，装新版
```

---

## E. 日后更新代码

### 只改了后端

```bash
scp -r server/src/* user@VPS_IP:/opt/hit-circle/server/src/
ssh user@VPS_IP "cd /opt/hit-circle/server && npm install --production && pm2 restart hit-circle"
```

### 只改了前端（Chrome 网页版）

```bash
cd client && npm run build:h5
scp -r dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
# Nginx 直接生效，不用重启
```

### 前端改动需要同步到 APK

```bash
cd client
npm run build:h5
npx cap sync android
# Android Studio Build APK → 重新装到手机
```

---

## F. 在 ip 和 cloudflare 模式间切换

切换非常简单，**不用重装任何东西**，只改配置 + 重新生成 Nginx 即可。

### ip → cloudflare

1. 完成 [B 节第 1~3 步]：CF DNS + Origin 证书
2. 改 `client/src/config/env.js` 的 prod 地址为域名 → 重新 build:h5 → 上传 H5
3. 改 `deploy.conf`：`DEPLOY_MODE=cloudflare`，`SERVER_NAME=域名`，`SSL_CERT_PATH` 换成 CF 证书
4. `sudo ./setup-nginx.sh`
5. 重新打包 APK 装到手机

### cloudflare → ip

1. 改 `client/src/config/env.js` 的 prod 地址为 IP → 重新 build:h5 → 上传
2. 改 `deploy.conf`：`DEPLOY_MODE=ip`，`SERVER_NAME=IP`，`SSL_CERT_PATH` 换回原 IP 证书
3. `sudo ./setup-nginx.sh`
4. 重新打包 APK

### 配置项一览

| 字段 | ip 模式 | cloudflare 模式 |
|------|---------|-----------------|
| `DEPLOY_MODE` | `ip` | `cloudflare` |
| `SERVER_NAME` | VPS IP | CF 代理的域名 |
| `SSL_CERT_PATH` | IP / 旧域名证书 | CF Origin Certificate |
| `SSL_KEY_PATH` | 对应私钥 | CF Origin Private Key |

`env.js` 里的 `API_BASE` 和 `SOCKET_URL` 也要相应换成 IP 或域名。

---

## G. 故障排查

### Nginx / 网站

| 问题 | 检查 |
|------|------|
| 打不开 | `sudo systemctl status nginx`、`sudo nginx -t` |
| 白屏 / 404 | `ls /opt/hit-circle/client/h5/index.html` |
| 502 Bad Gateway | 后端没跑：`pm2 status` |

### API / 后端

| 问题 | 检查 |
|------|------|
| 登录失败 | `pm2 logs hit-circle` |
| 聊天连不上 | `pm2 logs hit-circle` 看 socket 日志 |
| 上传失败 | `client_max_body_size` + Supabase 配额 |

### Cloudflare 模式

| 问题 | 检查 |
|------|------|
| Error 521 | VPS 的 443 端口没响应，检查 Nginx 状态 |
| Error 525 | CF Origin 证书没装对，或 SSL 模式没设 Full (strict) |
| Error 526 | Origin 证书过期 / 域名不匹配 |
| 日志里全是 CF 的 IP | `real_ip` 没生效，确认 `DEPLOY_MODE=cloudflare` 再跑一次 `setup-nginx.sh` |

### APK

| 问题 | 检查 |
|------|------|
| 白屏 / 连不上 | `env.js` 中 prod 地址是否正确，VPS 后端是否在跑 |
| 网络错误 | HTTPS 证书问题，或手机网络不通 VPS |

### 代理服务冲突

| 问题 | 检查 |
|------|------|
| 3x-ui 面板打不开 | `sudo ufw status` 确认面板端口放行；`systemctl status x-ui` |
| 代理节点不工作 | 节点端口防火墙放行；3x-ui 面板里节点配置的 SNI / 地址 |

### 切回来检查（重要）

每次跑完 `setup-nginx.sh` 后务必：
1. `sudo nginx -t`（脚本也会自动跑）
2. 浏览器实际访问一次，看首页能不能加载
3. 登录 + 发一条消息，看 WebSocket 工作正常
