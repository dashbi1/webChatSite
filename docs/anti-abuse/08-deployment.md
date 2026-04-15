# 08 — 部署与配置手册

> 本文档集中所有**外部配置步骤**：Upstash Redis、Cloudflare Turnstile、APK Release Keystore、Nginx 配置检查、环境变量总清单。
> 按 Phase 实施顺序引用。

---

## 目录

- [A. Phase 1 前的配置](#a-phase-1-前的配置)
  - [A.1 Upstash Redis 账号注册与创建 Database](#a1-upstash-redis-账号注册与创建-database)
  - [A.2 Cloudflare Turnstile 申请 Site](#a2-cloudflare-turnstile-申请-site)
  - [A.3 Nginx 真实 IP 配置检查](#a3-nginx-真实-ip-配置检查)
- [B. Phase 2 前的配置](#b-phase-2-前的配置)
  - [B.1 Android Release Keystore 生成](#b1-android-release-keystore-生成)
  - [B.2 APK 签名 SHA256 提取](#b2-apk-签名-sha256-提取)
  - [B.3 APK HMAC 密钥生成与注入](#b3-apk-hmac-密钥生成与注入)
- [C. 环境变量总清单](#c-环境变量总清单)
- [D. Cloudflare DNS / Origin 证书复查](#d-cloudflare-dns--origin-证书复查)
- [E. 部署流程 & PM2 重启](#e-部署流程--pm2-重启)
- [F. 回滚策略](#f-回滚策略)

---

## A. Phase 1 前的配置

### A.1 Upstash Redis 账号注册与创建 Database

1. 打开 [https://upstash.com/](https://upstash.com/)
2. 点右上角 "Sign Up" → 用 Google 或 GitHub 登录（免费）
3. 进入控制台点 **Create Database**
4. 配置：
   - **Name**：`hit-circle-ratelimit`
   - **Type**：Global（读延迟更低）或 Regional（更便宜，就近即可）
   - **Region**：**Tokyo (Japan)** 最靠近你 VPS
   - **Eviction**：`allkeys-lru`（限流场景够用）
   - **TLS**：默认开启
5. 点 **Create**
6. 进入新建的 database 详情页，切到 **REST API** tab
7. 复制：
   - `UPSTASH_REDIS_REST_URL`（形如 `https://tokyo-xxx.upstash.io`）
   - `UPSTASH_REDIS_REST_TOKEN`
8. 填到 VPS 的 `/opt/hit-circle/server/.env`：
   ```
   UPSTASH_REDIS_REST_URL=https://tokyo-xxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AbcDefGhi123...
   ```

**免费额度**：10k 命令/天，足够日活 100 × 20 动作 × 2 次 Redis 调用 = 4k/天，2.5 倍富余。

**验证连通性**：
```bash
curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  $UPSTASH_REDIS_REST_URL/set/test/hello
curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  $UPSTASH_REDIS_REST_URL/get/test
# 应返回 {"result":"hello"}
```

---

### A.2 Cloudflare Turnstile 申请 Site

1. 登录 Cloudflare Dashboard
2. 左侧菜单 → **Turnstile**
3. 点 **Add site**
4. 填：
   - **Site name**：`hit-circle`
   - **Hostname**：
     - `www.yourdomain.com`
     - `app.yourdomain.com`
     - `localhost`（本地开发）
   - **Widget mode**：**Managed**（最推荐，CF 自动判断用户是否需要交互）
   - **Pre-clearance for this site**：关闭（默认）
5. 点 **Create**
6. 获得 **Site Key** 和 **Secret Key**
7. 填到 `.env`：
   ```
   # server/.env
   TURNSTILE_SECRET_KEY=0x4AAAAAXXXXXXXXX
   ```
   ```
   # client/.env（或 client/src/config/env.js）
   VITE_TURNSTILE_SITE_KEY=0x4AAAAAXXXXXXXXX
   ```

**测试用 Site Key**（开发阶段用，永远通过验证）：
```
# 永远成功
1x00000000000000000000AA
# 永远失败
2x00000000000000000000AB
# 永远无人机器人挑战
3x00000000000000000000FF
```

官方文档：https://developers.cloudflare.com/turnstile/troubleshooting/testing/

---

### A.3 Nginx 真实 IP 配置检查

#### A.3.1 查看现状

在 VPS 上：
```bash
cat /opt/hit-circle/server/deploy/nginx.conf.example
cat /opt/hit-circle/server/deploy/nginx.split.conf.example
grep -r "set_real_ip_from" /etc/nginx/
```

#### A.3.2 三种模式的配置要求

**ip 模式**：无需额外配置（直接用 $remote_addr）。

**cloudflare / cloudflare-split 模式**：nginx 配置里必须有：

```nginx
# CF 官方 IPv4 列表（定期更新：https://www.cloudflare.com/ips-v4/）
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;

# CF IPv6
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;
real_ip_recursive on;

# 传给 Node.js
location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

#### A.3.3 验证配置生效

**VPS 上测试**：
```bash
# 正常 CF 请求（在自己的机器）
curl https://app.yourdomain.com/api/health
# 查 pm2 日志应看到真实客户端 IP

# 模拟攻击：直连 VPS 伪造 CF-Connecting-IP
curl -k -H "CF-Connecting-IP: 1.2.3.4" -H "Host: app.yourdomain.com" https://VPS_IP/api/health
# pm2 日志里的 IP 应该是**你的机器 IP**（不是 1.2.3.4）
# 说明 set_real_ip_from 生效，伪造无效
```

#### A.3.4 维护

CF 官方 IP 段**约每季度更新一次**。加入 `server/deploy/update-cf-ips.sh`（可选）：

```bash
#!/bin/bash
# 从 CF 官方拉最新 IPv4 段
curl -s https://www.cloudflare.com/ips-v4/ > /tmp/cf-ips-v4.txt
curl -s https://www.cloudflare.com/ips-v6/ > /tmp/cf-ips-v6.txt
# 生成 nginx 片段（需手动合并到 nginx.conf）
awk '{print "set_real_ip_from "$1";"}' /tmp/cf-ips-v4.txt
awk '{print "set_real_ip_from "$1";"}' /tmp/cf-ips-v6.txt
```

Phase 1 实施时也可以加一个管理员可见提醒："距上次 CF IP 列表更新超过 90 天"。

---

## B. Phase 2 前的配置

### B.1 Android Release Keystore 生成

⚠️ **keystore 一旦丢失，所有装过 APK 的用户永远无法覆盖更新**。必须备份。

本地机器上（Android Studio 或命令行）：

```bash
# 进入存放位置（建议项目外的安全目录）
cd ~/.android-keystores/

keytool -genkey -v \
  -keystore hit-circle-release.keystore \
  -alias hit-circle \
  -keyalg RSA \
  -keysize 2048 \
  -validity 36500

# 会交互问：
#   Enter keystore password:       ← 输入密码（至少 6 位），**牢记**
#   Re-enter new password:         ← 再次
#   What is your first and last name?  你的名字或团队名
#   What is the name of your organizational unit?
#   What is the name of your organization?
#   What is the name of your City or Locality?
#   What is the name of your State or Province?
#   What is the two-letter country code?       CN
#   Is correct? (yes/no): yes
#   Enter key password for <hit-circle>
#     (RETURN if same as keystore password):  直接回车
```

**保管**：
- `hit-circle-release.keystore` 备份到 1Password / Bitwarden / 加密 U 盘
- 密码也保存到密码管理器
- **禁止**提交到 git

### B.2 APK 签名 SHA256 提取

#### 方法 1：从 keystore 直接读

```bash
keytool -list -v \
  -keystore ~/.android-keystores/hit-circle-release.keystore \
  -alias hit-circle

# 输出找 "Certificate fingerprints:" 段：
#   SHA1: AB:CD:EF:...
#   SHA256: 12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0

# 复制 SHA256 那行，去掉冒号转小写：
# 1234567890abcdef...
```

#### 方法 2：从已签名 APK 读

```bash
# 前提：有 Android SDK build-tools
apksigner verify --print-certs hit-circle-release.apk

# 输出：
#   Signer #1 certificate DN: CN=...
#   Signer #1 certificate SHA-256 digest: 1234567890abcdef...
```

#### 方法 3：Gradle signingReport（可同时看 debug 和 release）

```bash
cd client/android
./gradlew signingReport

# 输出两组（Variant: debug 和 Variant: release）
# SHA-256 行就是要的
```

**存储到 `.env`**（多个签名用逗号分隔）：
```
ALLOWED_APK_SIGNATURES=1234567890abcdef...,abcdef1234567890...
```

支持多个：如果未来换 keystore 或有 debug 签名也想放行，可加逗号。

### B.3 APK HMAC 密钥生成与注入

#### 生成

```bash
openssl rand -hex 32
# 输出：a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
```

#### 注入后端

```
# server/.env
APK_HMAC_SECRET=a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
```

#### 注入 APK（构建时）

```properties
# client/android/gradle.properties（**不要**提交到 git）
APK_HMAC_SECRET=a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
```

```gradle
// client/android/app/build.gradle
android {
    defaultConfig {
        buildConfigField "String", "APK_HMAC_SECRET", "\"${project.APK_HMAC_SECRET}\""
    }
}
```

**注意**：
- 同一密钥**必须同时存在于后端 .env 和 APK gradle.properties**
- 密钥**不要**频繁更换（换了后老版本 APK 全部失效 → 用户会被 +45 分）
- 新版 APK 发布前，**先更新后端 .env 为"旧密钥 + 新密钥"都接受**，然后发新 APK，24 小时后再移除旧密钥（防老用户还没升级）

**旧密钥兼容的后端代码**：
```js
// server/src/middleware/apkSignature.js
const allowedHmacSecrets = (process.env.APK_HMAC_SECRETS || process.env.APK_HMAC_SECRET).split(',');
for (const secret of allowedHmacSecrets) {
  const expected = crypto.createHmac('sha256', secret).update(...).digest('hex');
  if (expected === hmac) return 'valid';
}
return 'hmac_mismatch';
```

#### 添加 .gitignore

```gitignore
# client/android/.gitignore 补充
gradle.properties

# .gitignore 根目录补充
hit-circle-release.keystore
*.keystore
```

---

## C. 环境变量总清单

### server/.env（完整）

```bash
# === 已有（保留） ===
NODE_ENV=production
PORT=3000
JWT_SECRET=...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
RESEND_API_KEY=...
RESEND_FROM_EMAIL=noreply@mail.yourdomain.com
ADMIN_PATH=console-k8m2x7
# ...

# === Phase 1 新增 ===
UPSTASH_REDIS_REST_URL=https://tokyo-xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
TURNSTILE_SECRET_KEY=0x4AAAAAXXXXXXXXX

# === Phase 2 新增 ===
ALLOWED_APK_SIGNATURES=1234567890abcdef...,abcdef1234567890...
APK_HMAC_SECRET=a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
# 可选：多密钥兼容
# APK_HMAC_SECRETS=新密钥,旧密钥
IPAPI_FIELDS=asn,as,country,hosting,proxy  # ip-api.com 查询字段

# === Phase 3 无新增 ===
# === Phase 4 无新增 ===
```

### client/src/config/env.js（补充）

```js
export const envConfig = {
  prod: {
    // 已有
    APK_API_HOST: 'https://app.yourdomain.com',
    WEB_FALLBACK_HOST: 'https://www.yourdomain.com',
    // Phase 1 新增（通过 Vite 定义 or 直接填）
    TURNSTILE_SITE_KEY: '0x4AAAAAXXXXXXXXX',
  },
  // ...
};
```

### client/android/gradle.properties（**不提交 git**）

```properties
APK_HMAC_SECRET=a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
```

---

## D. Cloudflare DNS / Origin 证书复查

确保现有 cloudflare-split 模式已配好：

- [ ] DNS：`www.yourdomain.com` 和 `app.yourdomain.com` 都是 🟠 Proxied
- [ ] SSL/TLS → Overview：**Full (strict)** 模式
- [ ] SSL/TLS → Origin Server：有 `*.yourdomain.com` 通配或两个子域都覆盖的 Origin Certificate
- [ ] Origin 证书已部署到 VPS `/etc/ssl/cloudflare/origin.pem` 和 `.key`
- [ ] **Turnstile** 添加 site（见 A.2）

**Phase 1 新增的 CF 配置**（可选但推荐）：

Cloudflare → 左侧 Security → **WAF Rate Limiting**（Free 版每月 10k 免费规则触发）：
- Rule：`(http.request.uri.path eq "/api/auth/send-code")`
- Action：Block
- Rate：10 requests / 1 minute per IP

这是**后端限流之外的第二道防线**（在 CF 层挡住，请求连你 VPS 都不到）。

---

## E. 部署流程 & PM2 重启

### E.1 Phase 1 部署步骤

```bash
# 本地
git checkout feat/anti-abuse-phase1
# ... 完成所有改动
git commit -am "feat(anti-abuse-phase1): ..."
git push origin feat/anti-abuse-phase1

# 一键部署脚本（已有）
./deploy-to-vps.sh

# 或手动
scp -r server/src server/deploy user@VPS_IP:/opt/hit-circle/server/
scp client/dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/
ssh user@VPS_IP
cd /opt/hit-circle/server

# 1. 新增依赖
npm install --production

# 2. 填 .env（参考 C 节）
nano .env

# 3. 执行数据库迁移
psql ... -f ../database/migrations/anti_abuse_phase1.sql
# 或在 Supabase Dashboard → SQL Editor 粘贴运行

# 4. 重启 PM2
pm2 restart hit-circle

# 5. 看日志
pm2 logs hit-circle --lines 50
```

### E.2 Phase 2 额外步骤

```bash
# 除了 Phase 1 的步骤，还需要：

# 1. 首次：生成 keystore（见 B.1），提取 SHA256（见 B.2）
# 2. 填 .env 加 ALLOWED_APK_SIGNATURES + APK_HMAC_SECRET

# 3. 改 client/android/gradle.properties 加 APK_HMAC_SECRET

# 4. 前端：
cd client
npm install  # 新增 @fingerprintjs/fingerprintjs
npm run build:h5
scp -r dist/build/h5/* user@VPS_IP:/opt/hit-circle/client/h5/

# 5. APK 重新打包（必须）：
npx cap sync android
# Android Studio → Build → Generate Signed Bundle / APK → 选 release keystore
# 拿到 app-release.apk 分发

# 6. 后端：
pm2 restart hit-circle
```

### E.3 Phase 3 / 4 同 E.1（无外部配置变化）

---

## F. 回滚策略（各 Phase）

### 通用快速回滚
```bash
ssh user@VPS_IP "cd /opt/hit-circle && git log --oneline -5"
git revert <commit>
# 或
git checkout <last-good-commit> -- server/src/
pm2 restart hit-circle
```

### Phase 级别回滚

| Phase | 紧急回滚 |
|-------|----------|
| **Phase 1** | 切系统为 observe 模式 + 关 Turnstile middleware（env `TURNSTILE_ENABLED=false` 临时） |
| **Phase 2** | `UPDATE risk_rules SET enabled=false;`（所有规则禁用）|
| **Phase 3** | 切 observe 模式：`UPDATE system_config SET value='"observe"' WHERE key='risk_enforcement_mode';` |
| **Phase 4** | 关 cron：`pm2 stop hit-circle-cron`（如果单独进程）/ 或直接注释 cron schedule |

### 数据库回滚

每个 phase 迁移 SQL 应附带 `-- ROLLBACK:` 注释块，列出回退语句（不自动执行）。

**回滚的黄金法则**：优先切开关关功能，**不要轻易 DROP TABLE**（数据宝贵）。

---

## G. 常见问题

### G.1 Upstash Redis 连不通
- 检查 `UPSTASH_REDIS_REST_URL` 是否正确（https:// 开头）
- 测试 curl（A.1 最后验证步骤）
- Node 版本 >= 18（@upstash/redis 需要 fetch）

### G.2 Turnstile widget 不显示
- 浏览器 F12 Console 看有无错误
- 确认 `VITE_TURNSTILE_SITE_KEY` 已填且前端 build 用的是 prod env
- hostname 在 Turnstile site 配置的列表里（包括 localhost 调试）

### G.3 APK 签名总是校验失败
- 检查本地 `keytool -list -v` 的 SHA256 是否和 `.env` 的 `ALLOWED_APK_SIGNATURES` 一致（注意去掉冒号 + 小写）
- 确认 gradle.properties 的 HMAC 和 .env 的 HMAC 完全相同
- 时间戳漂移：客户端时间要准（手机系统时间不准会导致 +5 分钟窗口不够）

### G.4 真实 IP 仍拿到 CF IP
- 确认 Nginx 已 reload：`sudo nginx -s reload`
- 确认 `set_real_ip_from` 白名单包含当前 CF IP 段（定期更新）
- `tcpdump` 看 CF-Connecting-IP 是否到达 VPS

### G.5 cron 任务不执行
- `pm2 logs hit-circle | grep cron` 看输出
- 确认 node-cron schedule 字符串对（5 段）
- 进程是否崩溃：`pm2 status`

---

**完成 Phase 4 后，整个反滥用系统部署完毕。** 请把本文档和 [README.md](./README.md) 收藏作为长期运维参考。
