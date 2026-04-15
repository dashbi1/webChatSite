# Phase 1 手动测试清单（用户验收用）

> 本清单在 Phase 1 代码部署到 VPS 后**人工跑一遍**。
> 每项打勾即表示通过，全部通过后方可进入 Phase 2。

---

## 前置：外部账号准备

### 1. Upstash Redis 注册与配置

- [ ] 打开 <https://upstash.com/>，Google/GitHub 登录
- [ ] 点 **Create Database**：
  - Name: `hit-circle-ratelimit`
  - Type: Regional（或 Global）
  - Region: **Tokyo (Japan)**
  - TLS: 保持默认 On
- [ ] 在 database 详情页 **REST API** tab：
  - 复制 **UPSTASH_REDIS_REST_URL**
  - 复制 **UPSTASH_REDIS_REST_TOKEN**
- [ ] 命令行快速连通性测试：
  ```bash
  curl -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
    $UPSTASH_REDIS_REST_URL/set/test/hello
  # 应返回 {"result":"OK"}
  ```

### 2. Cloudflare Turnstile Site 申请

- [ ] 登录 Cloudflare Dashboard → 左侧 **Turnstile**
- [ ] 点 **Add site**：
  - Site name: `hit-circle`
  - Widget mode: **Managed**
  - Hostnames 填：
    - `www.agent666.xyz`
    - `app.agent666.xyz`
    - `localhost`（Capacitor WebView / 本地开发）
- [ ] 创建后复制 **Site Key** 和 **Secret Key**

### 3. Nginx 配置复查（cloudflare-split 模式）

- [ ] SSH 到 VPS，查看 `/etc/nginx/` 下当前运行的配置
- [ ] 确认 `set_real_ip_from` 包含 CF 官方 IP 段（参见 `docs/anti-abuse/08-deployment.md` 第 A.3 节）
- [ ] 确认 `real_ip_header CF-Connecting-IP;` 存在
- [ ] 确认 `proxy_set_header X-Real-IP $remote_addr;` 存在

---

## 部署步骤

- [ ] 本地拉取代码：`git pull origin main`
- [ ] 本地构建 H5：
  ```bash
  cd client && npm run build:h5
  ```
- [ ] 一键部署到 VPS：
  ```bash
  ./deploy-to-vps.sh
  ```
- [ ] SSH 到 VPS，进入 server 目录：
  ```bash
  cd /opt/hit-circle/server
  ```
- [ ] 安装新依赖（服务端）：
  ```bash
  npm install --production
  # 应看到 added: @upstash/redis, node-cron, axios
  ```
- [ ] 编辑 `.env`，填入：
  ```
  DEPLOY_MODE=cloudflare-split
  UPSTASH_REDIS_REST_URL=<从 step 1 拿到>
  UPSTASH_REDIS_REST_TOKEN=<从 step 1 拿到>
  TURNSTILE_SECRET_KEY=<从 step 2 拿到>
  TURNSTILE_ENABLED=true
  RATE_LIMIT_ENABLED=true
  ```
- [ ] 填好前端 Site Key：编辑 `client/src/config/env.js`，把 `TURNSTILE_SITE_KEY` 改成正式值，**重新 build** 并上传（`./deploy-to-vps.sh` 再跑一次）
- [ ] 在 Supabase Dashboard → SQL Editor 粘贴运行 `database/migrations/anti_abuse_phase1.sql`
- [ ] 验证表已创建：
  ```sql
  SELECT column_name FROM information_schema.columns
    WHERE table_name='users' AND column_name IN ('risk_score','restricted_until','is_shadow_banned');
  SELECT * FROM system_config;
  -- 应看到 6 行默认配置
  ```
- [ ] 重启 PM2：
  ```bash
  pm2 restart hit-circle
  pm2 logs hit-circle --lines 50
  # 日志应看到："[disposable] loaded N domains" 和 "[cron] 1 tasks scheduled"（N 初始为 0）
  ```

---

## 功能测试

### A. Turnstile 人机验证

- [ ] 浏览器打开 `https://www.agent666.xyz/#/pages/register/index`
- [ ] 看到页面底部 Turnstile 控件（CF logo + "我不是机器人"挑战）
- [ ] 未完成 Turnstile 时，"获取验证码"按钮**禁用**
- [ ] 完成 Turnstile 后按钮**启用**
- [ ] 填邮箱点"获取验证码" → 应收到邮件（检查收件箱和垃圾箱）
- [ ] 点击后 Turnstile **自动重置**，需要再次验证才能再发

### B. IP 限流（每分钟最多 2 次验证码）

- [ ] 在同一浏览器里连续发 3 次验证码：
  - 第 1、2 次：成功
  - 第 3 次：返回 `{ success: false, error: '请求过于频繁，请稍后再试' }`
- [ ] 等 60 秒后再发 → 恢复正常

### C. 邮箱限流（每小时最多 5 次）

- [ ] 用同一邮箱 `test@gmail.com` 发 6 次（分散在 1 小时内）：
  - 前 5 次：成功
  - 第 6 次：返回 `{ error: '该邮箱请求过多，请 1 小时后再试' }`
- [ ] 备注：60 秒冷却仍然生效（verificationService 层）

### D. 注册限流（每 IP 每天最多 3 个）

- [ ] 同一 IP 用不同邮箱注册 4 次：
  - 前 3 次：成功
  - 第 4 次：POST /api/auth/register 返回 `{ error: '今日注册次数已达上限' }`

### E. 一次性邮箱黑名单

- [ ] 等 3 AM 过一次（或手动触发 `curl` 接口刷新），让 cron 把 GitHub 黑名单 (~5000+ 条) 拉到 DB
  - 手动触发方式：
    ```bash
    cd /opt/hit-circle/server
    node -e "require('./src/services/disposableEmails/updateFromGithub').updateDisposableDomains().then(r => console.log(r))"
    # 应输出 { updated: 5000+, elapsed: ~10000 }
    ```
- [ ] 用 `test@mailinator.com` 注册 → "请使用常用邮箱"
- [ ] 用 `test@10minutemail.com` 注册 → "请使用常用邮箱"

### F. 邮箱白名单豁免

- [ ] 用 `student@hit.edu.cn` 发验证码 → 正常通过
- [ ] 用 `user@gmail.com` / `user@qq.com` / `user@163.com` → 正常通过
- [ ] 即使**将 gmail.com 手动插入** disposable_email_domains 表（`INSERT INTO disposable_email_domains (domain, source) VALUES ('gmail.com', 'test');`），gmail 用户仍能注册（白名单优先级高于黑名单）
  - 测试后记得删除：`DELETE FROM disposable_email_domains WHERE domain='gmail.com';`

### G. 真实 IP 解析（cloudflare-split 模式）

- [ ] 通过 Cloudflare 正常访问：
  ```bash
  curl https://www.agent666.xyz/api/health
  ```
  然后 `pm2 logs hit-circle` 查看日志——应看到**真实客户端 IP**（非 CF 的 IP、非 127.0.0.1）
- [ ] 模拟直连 VPS 伪造 header：
  ```bash
  curl -k -H "CF-Connecting-IP: 1.2.3.4" -H "Host: app.agent666.xyz" https://<VPS_IP>/api/health
  ```
  日志里的 IP 应是**你机器的真实 IP**，不是 `1.2.3.4`（Nginx 的 `set_real_ip_from` 白名单拒绝了伪造值）

### H. Turnstile 生产性

- [ ] 发请求时手动篡改 `turnstile_token`（用 DevTools Network → 改 Request Body）：
  ```json
  { "turnstile_token": "FORGED", "email": "test@gmail.com", "purpose": "register" }
  ```
  应返回 `{ error: '人机验证失败，请重新校验' }`
- [ ] 完全不带 token：`{ "email": ..., "purpose": "register" }`
  应返回 `{ error: '缺少人机验证' }`

### I. 重置密码限流（新增防暴力枚举）

- [ ] 同一 IP 连续调用 `POST /api/auth/reset-password` 11 次（验证码随便填）：
  - 前 10 次：返回"验证码错误"或类似业务错误
  - 第 11 次：返回 `{ error: '尝试次数过多，请 10 分钟后再试' }`

### J. 写保护触发器（风控字段）

- [ ] 用 anon key / 登录态 JWT 尝试：
  ```sql
  -- 模拟用户自己改自己的 risk_score（需要伪造 auth.uid()）
  -- 或通过 Supabase client 的 anon key UPDATE users SET risk_score=0 WHERE id='xxx'
  ```
  应返回错误：`Cannot modify risk-related fields from client`
- [ ] 管理员直接在 SQL Editor 执行：
  ```sql
  UPDATE users SET risk_score = 0 WHERE email = 'your-test@example.com';
  ```
  应**成功**（trigger 识别到无 JWT claims，放行）

---

## 回归测试（保证没破坏现有功能）

- [ ] 已注册用户正常登录
- [ ] 登录后可发帖、评论、私聊、点赞、加好友
- [ ] 管理员后台可访问
- [ ] 手动测试一次完整"注册 → 登录 → 发帖"流程无异常

---

## 观察期（可选但推荐）

- [ ] 连续观察 VPS 日志 24 小时：`pm2 logs hit-circle`
- [ ] 无以下异常：
  - `[turnstile] verify error`（偶发网络抖动可忽略，持续告警说明 CF API 配置问题）
  - `[rateLimit] error`（如持续出现，检查 Upstash 额度和连通性）
  - `[disposable] load error`
- [ ] Upstash 控制台查看命令数：一天 < 5k 为正常

---

## 完成判定

**全部勾完**即可进入 **Phase 2**。
如果某一项不通过，先查：
1. `docs/anti-abuse/08-deployment.md` 故障排查章节
2. VPS 上的 `pm2 logs hit-circle`
3. Nginx 配置：`sudo nginx -T | grep -E 'set_real_ip_from|real_ip_header|X-Real-IP'`

---

## 已完成 Phase 1 的交付物（给记忆）

| 类别 | 文件/组件 |
|------|-----------|
| 数据库 | `database/migrations/anti_abuse_phase1.sql` — users 加 5 列、system_config、disposable_email_domains、风控字段写保护 trigger |
| 后端 utils | `src/utils/ip.js` — 支持 ip/cloudflare 双模式真实 IP 解析 |
| 后端 config | `src/config/redis.js` — Upstash Redis 封装 + noop fallback |
| 后端 middleware | `src/middleware/turnstile.js`、`src/middleware/rateLimit.js`（4 层：sendCode/register/resetPassword） |
| 后端 services | `src/services/whitelist/emailDomains.js`、`src/services/disposableEmails/{loader,updateFromGithub}.js` |
| 后端 cron | `src/cron/index.js` — 调度 updateDisposableDomains（每日 3:00） |
| 后端 routes | `src/routes/auth.js` — send-code / register / reset-password 挂中间件链 |
| 后端 app | `src/app.js` — trust proxy + 启动加载黑名单 + 启动 cron |
| 前端 component | `client/src/components/TurnstileWidget.vue` |
| 前端 pages | register / forgot-password 集成 Turnstile |
| 前端 config | `env.js` 加 `TURNSTILE_SITE_KEY` |
| 测试 | `server/tests/anti-abuse/phase1/` — 5 单元 + 1 集成文件，**72 用例全通过** |
| 文档 | `.env.example` 新增所有变量说明 |
