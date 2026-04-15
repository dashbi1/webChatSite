# 04 — Phase 1：基础设施

> **工期预估**：3-4 天
> **目标**：上线基础防御（真实 IP + 三层限流 + Turnstile + 一次性邮箱黑名单 + 协议更新），挡住 90% 的脚本攻击。
> **结束标志**：手动测试清单全通过，用户确认后进入 Phase 2。

---

## 1. 交付物

- 后端 Express 中间件栈：真实 IP 解析、Turnstile 校验、三层限流、邮箱黑名单
- Upstash Redis 集成
- Cloudflare Turnstile 前端 widget 集成
- 数据表：`users` 加列、`system_config`、`disposable_email_domains`
- Cron 任务：`updateDisposableDomains`
- 用户协议 / 隐私政策更新（新增设备指纹条款）
- 测试：单元 + 集成 + E2E + 手动清单
- 迁移脚本：`database/migrations/anti_abuse_phase1.sql`

---

## 2. 前置准备（实施前）

- [ ] 在 `upstash.com` 注册账号（Google/GitHub 登录）
- [ ] 创建 Redis Database，区域选 **Tokyo (Japan)** 或 **Singapore**
- [ ] 拿到 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`
- [ ] 在 `cloudflare.com` → 左侧 Turnstile → 添加 Site
  - Site type：Managed / Invisible / Non-interactive 三选一（推荐 **Managed**）
  - Hostname：`www.yourdomain.com`, `app.yourdomain.com`, `localhost`（开发测试）
- [ ] 拿到 `TURNSTILE_SITE_KEY`（前端用）和 `TURNSTILE_SECRET_KEY`（后端用）
- [ ] 本地 git 分支：`git checkout -b feat/anti-abuse-phase1`

---

## 3. 文件改动清单

### 3.1 新增文件

```
server/
├── src/
│   ├── utils/
│   │   └── ip.js                          # getClientIp / getClientIpCidr24
│   ├── config/
│   │   └── redis.js                       # Upstash Redis 客户端封装
│   ├── middleware/
│   │   ├── trustProxy.js                  # Express trust proxy 配置
│   │   ├── turnstile.js                   # Turnstile token 校验
│   │   └── rateLimit.js                   # 三层限流（IP / 邮箱 / 设备）
│   ├── services/
│   │   ├── whitelist/
│   │   │   └── emailDomains.js            # 邮箱白名单 + edu/edu.cn 判断
│   │   └── disposableEmails/
│   │       ├── loader.js                  # 启动时加载 + 缓存
│   │       └── updateFromGithub.js        # cron 更新
│   └── cron/
│       ├── index.js                       # cron 调度入口
│       └── updateDisposableDomains.js
database/migrations/
└── anti_abuse_phase1.sql                  # 迁移 SQL

client/
├── src/
│   ├── components/
│   │   └── TurnstileWidget.vue           # Turnstile iframe 封装
│   └── utils/
│       └── turnstile.js                   # 前端 token 获取工具

tests/
├── unit/
│   ├── ip.test.js
│   ├── turnstile.test.js
│   ├── rateLimit.test.js
│   ├── emailDomains.test.js
│   └── disposableEmails.test.js
├── integration/
│   ├── sendCode.test.js                   # 限流 + 黑名单 + Turnstile 集成
│   └── register.test.js
└── e2e/
    └── phase1-register-flow.spec.js       # Playwright
```

### 3.2 修改文件

```
server/
├── src/
│   ├── app.js                             # 加 trust proxy、挂载新中间件
│   ├── routes/
│   │   └── auth.js                        # send-code / register / reset-password 加中间件
│   └── services/
│       └── verificationService.js         # createCode 保留原有逻辑，让 rateLimit 中间件承担 IP/设备层
├── package.json                           # 加 @upstash/redis 依赖
├── .env.example                           # 加 UPSTASH_* / TURNSTILE_* 变量

client/
├── src/
│   ├── pages/
│   │   ├── register/index.vue             # 发送验证码按钮前挂 Turnstile
│   │   └── forgot-password/index.vue      # 同上
│   └── api/
│       └── auth.js                        # send-code 请求带 turnstile_token

docs/
└── user-agreement.md (或 privacy-policy.md) # 新增设备指纹条款
```

---

## 4. 关键代码骨架

### 4.1 Upstash Redis 客户端

```js
// server/src/config/redis.js
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = redis;
```

### 4.2 真实 IP 工具

```js
// server/src/utils/ip.js（内容见 03-architecture.md 第 3.3 节）
function getClientIp(req) { /* ... */ }
function getClientIpCidr24(req) { /* ... */ }
module.exports = { getClientIp, getClientIpCidr24 };
```

### 4.3 Turnstile 中间件

```js
// server/src/middleware/turnstile.js
const axios = require('axios');
const { getClientIp } = require('../utils/ip');

async function verifyTurnstile(req, res, next) {
  const token = req.body?.turnstile_token || req.headers['cf-turnstile-response'];
  if (!token) {
    return res.status(400).json({ success: false, error: '缺少人机验证' });
  }
  try {
    const { data } = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: getClientIp(req),
      },
      { timeout: 5000 }
    );
    if (!data.success) {
      return res.status(400).json({ success: false, error: '人机验证失败' });
    }
    next();
  } catch (err) {
    console.error('[turnstile] verify error:', err.message);
    return res.status(500).json({ success: false, error: '人机验证服务异常' });
  }
}

module.exports = { verifyTurnstile };
```

### 4.4 三层限流中间件

```js
// server/src/middleware/rateLimit.js
const redis = require('../config/redis');
const { getClientIp } = require('../utils/ip');

// 通用滑动窗口
async function slidingWindowCheck(key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const clearBefore = now - windowSec;
  // Upstash 不支持完整的滑动窗口脚本，但 INCR + EXPIRE 实现固定窗口足够
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count <= limit;
}

// 发送验证码限流：同 IP 每分钟最多 2 次
function rateLimitSendCode() {
  return async (req, res, next) => {
    const ip = getClientIp(req);
    const email = req.body?.email?.toLowerCase();
    // 同 IP 每分钟 2 次
    const ok1 = await slidingWindowCheck(`rl:send:ip:${ip}:60s`, 2, 60);
    if (!ok1) return res.status(429).json({ success: false, error: '请求过于频繁，请稍后再试' });
    // 同邮箱每小时 5 次
    if (email) {
      const ok2 = await slidingWindowCheck(`rl:send:email:${email}:1h`, 5, 3600);
      if (!ok2) return res.status(429).json({ success: false, error: '该邮箱请求过多，请 1 小时后再试' });
    }
    next();
  };
}

// 注册限流：同 IP 每天最多 3 个注册
function rateLimitRegister() {
  return async (req, res, next) => {
    const ip = getClientIp(req);
    const ok = await slidingWindowCheck(`rl:register:ip:${ip}:1d`, 3, 86400);
    if (!ok) return res.status(429).json({ success: false, error: '今日注册次数已达上限' });
    next();
  };
}

module.exports = { rateLimitSendCode, rateLimitRegister };
```

### 4.5 邮箱白名单 / 黑名单

```js
// server/src/services/whitelist/emailDomains.js
const WHITELIST = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'qq.com', '163.com', '126.com', 'foxmail.com',
  'sina.com', 'sina.cn', 'yahoo.com', 'yahoo.cn', 'icloud.com',
]);

function isEduDomain(domain) {
  return domain.endsWith('.edu') || domain.endsWith('.edu.cn');
}

function getDomain(email) {
  return email?.split('@')[1]?.toLowerCase();
}

function isWhitelistedDomain(email) {
  const d = getDomain(email);
  return d ? (WHITELIST.has(d) || isEduDomain(d)) : false;
}

module.exports = { isWhitelistedDomain, isEduDomain, getDomain };
```

```js
// server/src/services/disposableEmails/loader.js
const supabase = require('../../config/supabase');

let cache = new Set();
let loadedAt = 0;

async function loadDisposableDomains() {
  const { data } = await supabase.from('disposable_email_domains').select('domain');
  cache = new Set((data || []).map(r => r.domain.toLowerCase()));
  loadedAt = Date.now();
}

function isDisposable(email) {
  const d = email?.split('@')[1]?.toLowerCase();
  return d ? cache.has(d) : false;
}

module.exports = { loadDisposableDomains, isDisposable };
```

### 4.6 认证路由中间件链

```js
// server/src/routes/auth.js（改动示例）
const { verifyTurnstile } = require('../middleware/turnstile');
const { rateLimitSendCode, rateLimitRegister } = require('../middleware/rateLimit');
const { isWhitelistedDomain, getDomain } = require('../services/whitelist/emailDomains');
const { isDisposable } = require('../services/disposableEmails/loader');

// 发送验证码
router.post('/send-code',
  rateLimitSendCode(),
  verifyTurnstile,
  async (req, res) => {
    const { email, purpose } = req.body;
    if (!validateEmail(email)) { /* 同现有 */ }
    // 一次性邮箱黑名单（白名单优先）
    if (!isWhitelistedDomain(email) && isDisposable(email)) {
      return res.status(400).json({ success: false, error: '请使用常用邮箱' });
    }
    // ... 原有逻辑
  }
);

// 注册
router.post('/register',
  rateLimitRegister(),
  async (req, res) => { /* ... 原有逻辑 */ }
);

// 找回密码（同 send-code 限流 + Turnstile）
router.post('/reset-password',
  rateLimitSendCode(),
  verifyTurnstile,
  async (req, res) => { /* ... */ }
);
```

### 4.7 前端 Turnstile Widget

```vue
<!-- client/src/components/TurnstileWidget.vue -->
<template>
  <div ref="turnstileRef" class="turnstile-widget" />
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
const emit = defineEmits(['success', 'error', 'expired']);
const turnstileRef = ref(null);
let widgetId = null;

onMounted(() => {
  if (!window.turnstile) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    document.head.appendChild(s);
    s.onload = render;
  } else {
    render();
  }
});

function render() {
  widgetId = window.turnstile.render(turnstileRef.value, {
    sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
    callback: (token) => emit('success', token),
    'error-callback': () => emit('error'),
    'expired-callback': () => emit('expired'),
  });
}

onBeforeUnmount(() => {
  if (widgetId !== null) window.turnstile.remove(widgetId);
});

defineExpose({
  reset: () => widgetId !== null && window.turnstile.reset(widgetId),
});
</script>
```

### 4.8 前端注册页集成

```vue
<!-- client/src/pages/register/index.vue（节选） -->
<TurnstileWidget ref="turnstileEl" @success="onTurnstileSuccess" />
<button :disabled="!turnstileToken || sending" @click="onSendCode">发送验证码</button>

<script setup>
const turnstileToken = ref('');
function onTurnstileSuccess(token) { turnstileToken.value = token; }
async function onSendCode() {
  await api.post('/auth/send-code', {
    email: email.value,
    purpose: 'register',
    turnstile_token: turnstileToken.value,
  });
  // 发送完重置 widget
  turnstileEl.value.reset();
  turnstileToken.value = '';
}
</script>
```

### 4.9 Cron 更新一次性邮箱域

```js
// server/src/cron/updateDisposableDomains.js
const cron = require('node-cron');
const axios = require('axios');
const supabase = require('../config/supabase');
const { loadDisposableDomains } = require('../services/disposableEmails/loader');

const SOURCE_URL =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/master/disposable_email_blocklist.conf';

async function update() {
  const { data } = await axios.get(SOURCE_URL, { timeout: 30000 });
  const domains = data.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
  // 批量 upsert
  const rows = domains.map(d => ({ domain: d, source: 'github:disposable-email-domains/v1' }));
  for (let i = 0; i < rows.length; i += 500) {
    await supabase.from('disposable_email_domains').upsert(rows.slice(i, i + 500), { onConflict: 'domain' });
  }
  await loadDisposableDomains();
  console.log(`[cron] disposable_email_domains updated: ${domains.length}`);
}

cron.schedule('0 3 * * *', update);  // 每日 3:00
module.exports = { update };
```

---

## 5. 迁移 SQL

完整 SQL 见 [01-database-schema.md](./01-database-schema.md) 第 1.0-1.2 节。

**执行顺序**：
1. 备份 Supabase 数据（Supabase Dashboard → Database → Backups）
2. 在 Supabase SQL Editor 运行 `anti_abuse_phase1.sql`
3. 验证：
   ```sql
   SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'risk_score';
   SELECT * FROM system_config;
   ```

---

## 6. .env 新增变量

```bash
# server/.env.example 新增
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
TURNSTILE_SECRET_KEY=0x4AAAAA...
```

```bash
# client/.env（或 client/src/config/env.js）新增
VITE_TURNSTILE_SITE_KEY=0x4AAAAA...
```

---

## 7. 用户协议更新

在 `docs/user-agreement.md`（或项目既有协议路径）新增段落：

```markdown
## 设备信息与反作弊

为保障社区安全，防止批量注册、恶意刷帖等行为，我们会在您使用本服务时采集以下设备信息用于风险识别：
- 浏览器 / 应用标识：User-Agent、屏幕分辨率、时区、语言设置等
- 设备硬件特征：浏览器 canvas / WebGL 指纹、音频指纹、硬件并发数等
- 移动端：Android ID、设备型号、系统版本、应用安装来源、是否 Root / 模拟器环境
- 网络信息：IP 地址、归属 ASN、是否属于数据中心

上述信息仅用于：
1. 识别和拦截恶意注册、垃圾发帖等滥用行为
2. 判断账号风险等级，必要时限制或封禁异常账号
3. 为安全事件提供追溯依据

我们不会将这些信息用于广告、画像或向第三方出售。
```

注册页底部加勾选框：
```html
<label><input type="checkbox" v-model="agreed" />
  我已阅读并同意 <a href="/user-agreement">《用户协议》</a> 和 <a href="/privacy">《隐私政策》</a>
</label>
```
未勾选时"发送验证码"按钮禁用。

---

## 8. Phase 1 测试清单

### 8.1 自动化测试

#### 单元测试（Jest）
- [ ] `ip.test.js`：getClientIp 正确优先级（X-Real-IP > CF-Connecting-IP > req.ip），IPv6 前缀去除
- [ ] `turnstile.test.js`：mock CF API，成功/失败/超时三种场景
- [ ] `rateLimit.test.js`：mock Redis，滑动窗口计数正确
- [ ] `emailDomains.test.js`：白名单匹配、edu/edu.cn 匹配、普通域名不匹配
- [ ] `disposableEmails.test.js`：mailinator.com 在黑名单、gmail 不在

#### 集成测试（Jest + supertest）
- [ ] POST /api/auth/send-code 无 turnstile_token → 400
- [ ] POST /api/auth/send-code turnstile 失败 → 400
- [ ] POST /api/auth/send-code 连续 3 次（同 IP）→ 第 3 次 429
- [ ] POST /api/auth/send-code mailinator.com 邮箱 → 400
- [ ] POST /api/auth/send-code student@hit.edu.cn → 200（edu 白名单放行）
- [ ] POST /api/auth/register 连续 4 次同 IP → 第 4 次 429

#### E2E 测试（Playwright）
- [ ] `phase1-register-flow.spec.js`：
  1. 访问 /register
  2. 填邮箱，Turnstile 通过（测试用 CF 的 always-passes siteKey）
  3. 点发送验证码 → 看到"验证码已发送"提示
  4. 连续点第 3 次 → 看到"请求过于频繁"
  5. 用 `mailinator.com` 邮箱重试 → 看到"请使用常用邮箱"

### 8.2 手动测试清单（VPS 上跑，不通过不进 Phase 2）

**IP / 限流**
- [ ] 在 VPS 日志中观察一次注册请求：`pm2 logs hit-circle` 应看到真实 IP（不是 127.0.0.1 或 CF IP）
- [ ] 浏览器连续点"发送验证码" 3 次，第 3 次应返回 429（每分钟最多 2 次）
- [ ] 用同邮箱请求验证码 6 次（分布在 1 小时内），第 6 次应返回"该邮箱请求过多"
- [ ] 用不同邮箱同一 IP 注册 4 次，第 4 次应被拒

**Turnstile**
- [ ] 打开注册页，应看到 CF Turnstile 控件
- [ ] 不通过 Turnstile 点发送验证码 → "缺少人机验证"
- [ ] 用浏览器开发者工具篡改 turnstile_token → "人机验证失败"

**邮箱黑白名单**
- [ ] 用 `test@mailinator.com` 注册 → 被拒（"请使用常用邮箱"）
- [ ] 用 `student@hit.edu.cn` 注册 → 通过（edu.cn 白名单）
- [ ] 用 `user@gmail.com` 注册 → 通过（白名单）
- [ ] 用 `user@somerandomdomain.xyz` 注册 → 通过（非黑名单也非白名单，但 Phase 2 会加 +10 风险分）

**CF 真实 IP（仅 cloudflare/split 模式验证）**
- [ ] 通过 Cloudflare 访问，VPS 后端日志的 IP 应为**真实客户端 IP**
- [ ] 模拟攻击者直连 VPS IP 并带伪造 `CF-Connecting-IP: 1.2.3.4` header
  - Nginx 应忽略伪造值（因为 `set_real_ip_from` 白名单）
  - 验证方式：`curl -k -H "CF-Connecting-IP: 1.2.3.4" https://VPS_IP/api/health`，查 `pm2 logs`

**Cron**
- [ ] 手动触发 `node -e "require('./src/cron/updateDisposableDomains').update()"`，应成功拉取并写入数据库
- [ ] 查询 `SELECT COUNT(*) FROM disposable_email_domains` 应 > 1000 行

**用户协议**
- [ ] 注册页底部有协议勾选框
- [ ] 未勾选时"发送验证码"按钮禁用
- [ ] 点击协议链接可跳转到协议页面
- [ ] 协议页面包含"设备信息与反作弊"章节

### 8.3 回归测试（不破坏现有功能）

- [ ] 已注册用户能正常登录
- [ ] 已有帖子 / 评论 / 私聊功能正常
- [ ] 管理员后台可正常访问
- [ ] PM2 重启后所有服务正常（`pm2 logs` 无错误）

---

## 9. 完成标志

- 所有自动化测试通过（`npm test` 绿）
- 所有手动测试清单全通过
- 代码经过 **code-reviewer** 代理审查（`CLAUDE.md` 要求）
- 提交 commit：`feat(anti-abuse-phase1): rate limiting + Turnstile + disposable email blacklist`
- 推送到 VPS 并观察 1 小时，无异常日志
- 用户手动确认后，`git checkout -b feat/anti-abuse-phase2` 进入 Phase 2

---

## 10. 回滚策略

如果 Phase 1 上线后出现严重问题（大量误拦、服务不稳定）：

1. `git revert` 本次提交 + 重新部署前端 H5
2. Supabase 执行：
   ```sql
   -- 回滚 users 新列（保留数据不可删，只撤列）
   ALTER TABLE users DROP COLUMN risk_score, DROP COLUMN restricted_until, ...;
   DROP TABLE system_config;
   DROP TABLE disposable_email_domains;
   ```
3. Nginx 无需改动（配置兼容新老代码）

**更温和**：保留代码，但把 `system_config.risk_enforcement_mode` 改为 `observe` + 把限流阈值放宽 10 倍。

---

**下一步**：Phase 1 完成后，进入 [05-phase2-fingerprint-scoring.md](./05-phase2-fingerprint-scoring.md)。
