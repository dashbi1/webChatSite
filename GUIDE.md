# 工大圈子 - 部署与使用指南

---

## 目录

- [A. VPS 部署（让 Chrome 和 APK 都能用）](#a-vps-部署)
- [B. Chrome 浏览器使用](#b-chrome-浏览器使用)
- [C. 生成 Android APK](#c-生成-android-apk)
- [D. 日后更新代码](#d-日后更新代码)
- [E. 故障排查](#e-故障排查)

---

## A. VPS 部署

### 前提条件

- 一台 Ubuntu 22.04 VPS，有公网 IP
- VPS 上已有 HTTPS 证书（证书文件 + 私钥文件）
- 本地已安装 Node.js、npm
- 本地能 SSH 到 VPS

### 总览

```
你的电脑（本地）                        VPS（云服务器）
┌─────────────────┐                ┌──────────────────────────────┐
│ 1. 改 env.js    │                │  Nginx (443)                 │
│ 2. npm run      │   scp 上传     │    ├── / → H5 静态文件        │
│    build:h5     │ ──────────→    │    ├── /api → Node.js:3000   │
│ 3. 上传到 VPS   │                │    └── /socket.io → WS:3000  │
└─────────────────┘                │                              │
                                   │  PM2 → Node.js (Express)     │
                                   │    └── → Supabase Cloud      │
                                   └──────────────────────────────┘
```

---

### 第 1 步：改前端配置

**文件**：`client/src/config/env.js`

改两处：

```js
// 1. 把 prod 里的 YOUR_VPS_IP 换成你的 VPS 真实 IP
prod: {
  API_BASE: 'https://123.45.67.89/api',     // ← 改这里
  SOCKET_URL: 'https://123.45.67.89',       // ← 改这里
},

// 2. 把 CURRENT 改为 'prod'
const CURRENT = 'prod';                      // ← 改这里
```

---

### 第 2 步：构建 H5 前端

```bash
cd client
npm run build:h5
```

成功后产物在 `client/dist/build/h5/` 目录。

---

### 第 3 步：上传到 VPS

**方式 A：用部署脚本（推荐）**

```bash
# 1. 编辑脚本，填入 VPS_USER 和 VPS_IP
nano deploy-to-vps.sh

# 2. 运行（在 Git Bash 或 WSL 中）
chmod +x deploy-to-vps.sh
./deploy-to-vps.sh
```

脚本会自动构建 H5、上传后端 + 前端、在 VPS 上运行安装脚本。

**方式 B：手动上传**

```bash
# 在 VPS 上创建目录
ssh user@VPS_IP "mkdir -p /opt/hit-circle/server /opt/hit-circle/client/h5"

# 上传后端
scp -r server/src server/admin server/deploy server/package.json server/package-lock.json server/.env.example user@VPS_IP:/opt/hit-circle/server/

# 上传 H5 前端
scp -r client/dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
```

---

### 第 4 步：VPS 上运行安装脚本

```bash
ssh user@VPS_IP

cd /opt/hit-circle/server/deploy
chmod +x install.sh setup-nginx.sh
sudo ./install.sh
```

这会自动安装 Node.js 20、PM2、Nginx、UFW 防火墙。

---

### 第 5 步：配置后端 .env

**文件**：VPS 上的 `/opt/hit-circle/server/.env`

```bash
cd /opt/hit-circle/server
cp .env.example .env
nano .env
```

填入以下内容（从你本地的 `server/.env` 复制密钥）：

```
SUPABASE_URL=https://izhoqfrlilziwlgzcduq.supabase.co
SUPABASE_ANON_KEY=你的anon_key
SUPABASE_SERVICE_ROLE_KEY=你的service_role_key
JWT_SECRET=一个长随机字符串
PORT=3000
ADMIN_PATH=console-k8m2x7
```

> `JWT_SECRET` 生成方法：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

### 第 6 步：启动后端

```bash
cd /opt/hit-circle/server
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
```

`pm2 startup` 会输出一行命令，**复制那行命令再执行一次**，这样 VPS 重启后后端会自动启动。

验证后端：

```bash
curl http://localhost:3000/api/health
# 应返回 {"status":"ok","time":"..."}
```

---

### 第 7 步：配置 Nginx

**文件**：VPS 上的 `/opt/hit-circle/server/deploy/deploy.conf`

```bash
cd /opt/hit-circle/server/deploy
cp deploy.conf.example deploy.conf
nano deploy.conf
```

需要改的项：

```bash
VPS_IP=123.45.67.89              # ← 你的 VPS 公网 IP
SSL_CERT_PATH=/path/to/cert.pem  # ← 你的 SSL 证书文件路径
SSL_KEY_PATH=/path/to/key.pem    # ← 你的 SSL 私钥文件路径
```

其余项保持默认即可。然后运行：

```bash
sudo ./setup-nginx.sh
```

脚本会自动生成 Nginx 配置、启用站点、测试并重载。

---

### 第 8 步：验证

```bash
# 在 VPS 上测试
curl -k https://127.0.0.1/api/health

# 在本地电脑浏览器打开
https://你的VPS_IP
```

看到登录页面就说明部署成功了。

---

### 快速回顾：你改了什么、运行了什么

| 步骤 | 在哪里 | 改了什么 / 运行什么 |
|------|--------|---------------------|
| 1 | 本地 | 改 `client/src/config/env.js`：prod IP + CURRENT='prod' |
| 2 | 本地 | 运行 `cd client && npm run build:h5` |
| 3 | 本地 | 运行 `./deploy-to-vps.sh` 或手动 scp |
| 4 | VPS | 运行 `sudo ./install.sh` |
| 5 | VPS | 改 `/opt/hit-circle/server/.env`：填 Supabase 密钥 |
| 6 | VPS | 运行 `pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup` |
| 7 | VPS | 改 `deploy.conf`：填 VPS_IP + SSL 路径，然后 `sudo ./setup-nginx.sh` |
| 8 | 浏览器 | 打开 `https://VPS_IP` 验证 |

---

## B. Chrome 浏览器使用

部署完成后：

1. 打开 Chrome，地址栏输入 `https://你的VPS_IP`
2. 如果浏览器提示证书不受信任，点"高级" → "继续前往"
3. 看到登录页，用已有账号登录或注册新账号
4. 所有功能正常：发帖、聊天、添加好友、通知、管理后台

**管理后台**：`https://你的VPS_IP/console-k8m2x7`（管理员账号 13800000001 / test123）

**添加到桌面快捷方式**：Chrome 右上角三点菜单 → "更多工具" → "创建快捷方式" → 勾选"在窗口中打开"

---

## C. 生成 Android APK

### 前提条件

- 已安装 Android Studio
- 项目的 `dev/android` 分支已合并到 main（或切换到该分支）

### 总览

```
client/ 目录下操作
  1. 改 env.js（同 VPS 部署一样）
  2. npm run build:h5
  3. npx cap sync android
  4. Android Studio 打开 client/android/ → Build APK
```

---

### 第 1 步：确认分支

APK 构建依赖 Capacitor，相关文件在 `dev/android` 分支。确保你在正确的分支：

```bash
# 方式 A：切换到 dev/android 分支
git checkout dev/android

# 方式 B：如果已合并到 main，直接在 main 上操作
```

---

### 第 2 步：改前端配置

**文件**：`client/src/config/env.js`

和 VPS 部署一样，把 prod 配置改成你的 VPS IP，CURRENT 改为 `'prod'`。

```js
prod: {
  API_BASE: 'https://123.45.67.89/api',
  SOCKET_URL: 'https://123.45.67.89',
},

const CURRENT = 'prod';
```

---

### 第 3 步：构建 H5 并同步到 Android 项目

```bash
cd client
npm run build:h5
npx cap sync android
```

`cap sync` 会把 `dist/build/h5/` 的内容复制到 `client/android/app/src/main/assets/public/`。

---

### 第 4 步：用 Android Studio 构建 APK

1. 打开 Android Studio
2. `File → Open` → 选择 `client/android` 目录
3. 等 Gradle Sync 完成（右下角进度条跑完）
4. 菜单 `Build → Build Bundle(s) / APK(s) → Build APK(s)`
5. 构建完成后，右下角弹出 `locate` 链接，点击打开 APK 所在文件夹

**APK 位置**：`client/android/app/build/outputs/apk/debug/app-debug.apk`

---

### 第 5 步：安装到手机

把 `app-debug.apk` 传到手机，安装即可：
- USB 线连电脑：`adb install app-debug.apk`
- 或发微信/QQ 给自己，手机上点击安装
- 手机需开启"允许安装未知来源应用"

---

### 快速回顾：你改了什么、运行了什么

| 步骤 | 目录 | 操作 |
|------|------|------|
| 1 | 项目根目录 | `git checkout dev/android`（如需要） |
| 2 | `client/src/config/` | 改 `env.js`：prod IP + CURRENT='prod' |
| 3 | `client/` | 运行 `npm run build:h5` |
| 4 | `client/` | 运行 `npx cap sync android` |
| 5 | Android Studio | 打开 `client/android/`，Build → Build APK |
| 6 | 手机 | 安装 `app-debug.apk` |

---

### VPS IP 变了怎么办？

1. 改 `client/src/config/env.js` 中 prod 的 IP
2. 重新执行第 3~6 步（构建 → sync → Build APK → 安装）

---

## D. 日后更新代码

### 只改了后端

```bash
# 上传新的后端代码到 VPS
scp -r server/src/* user@VPS_IP:/opt/hit-circle/server/src/

# 在 VPS 上重启
ssh user@VPS_IP "cd /opt/hit-circle/server && npm install --production && pm2 restart hit-circle"
```

### 只改了前端（Chrome 网页版）

```bash
# 本地构建
cd client && npm run build:h5

# 上传到 VPS（Nginx 直接生效，不用重启）
scp -r client/dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
```

### 改了前端（需要更新 APK）

```bash
cd client
npm run build:h5
npx cap sync android
# 然后 Android Studio Build APK，重新安装到手机
```

---

## E. 故障排查

| 问题 | 检查方法 |
|------|----------|
| Chrome 打不开 | VPS 上 `sudo systemctl status nginx` |
| 页面白屏 / 404 | H5 文件是否上传到了正确目录：`ls /opt/hit-circle/client/h5/index.html` |
| 登录失败 / API 报错 | VPS 上 `pm2 logs hit-circle` 看后端日志 |
| 实时聊天不工作 | VPS 上 `pm2 logs hit-circle` 看 socket 相关日志 |
| 上传图片失败 | 检查 Supabase Storage 配额，和 Nginx 的 `client_max_body_size` |
| APK 打不开 / 白屏 | `env.js` 的 IP 是否正确，VPS 后端是否在跑 |
| APK 网络错误 | HTTPS 证书问题，或手机网络不通 VPS |
| Nginx 启动失败 | `sudo nginx -t` 查看配置错误 |
| PM2 没有自动启动 | 重新执行 `pm2 save && pm2 startup` |
