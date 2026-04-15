# 03 — 系统架构与请求流程

> 本文描述反滥用系统的整体架构、关键组件、请求流转、真实 IP 解析、APK 签名校验和 Cron 任务。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome (H5)              APK (Capacitor)                    │
│  ├─ FingerprintJS         ├─ 自定义 Capacitor 插件          │
│  └─ Turnstile iframe      └─ BuildConfig 注入 HMAC_SECRET   │
└──────────────────┬──────────────────┬──────────────────────┘
                   │                  │
                   │   HTTPS + header │
                   │   X-Device-FP    │
                   │   X-App-Sig      │
                   │   CF-Turnstile-Response
                   ↓                  ↓
          ┌───────────────────────────────────┐
          │  Cloudflare (Free)                │
          │  ├─ Turnstile 人机验证            │
          │  └─ CF-Connecting-IP header 下发  │
          └─────────────┬─────────────────────┘
                        ↓
          ┌───────────────────────────────────┐
          │  Nginx (VPS in 日本)              │
          │  ├─ set_real_ip_from CF-IP 段     │
          │  ├─ real_ip_header CF-Connecting-IP
          │  └─ → 传 X-Real-IP 给 Node        │
          └─────────────┬─────────────────────┘
                        ↓
          ┌───────────────────────────────────────────────────┐
          │  Node.js (Express) — 中间件栈                     │
          │  ┌─────────────────────────────────────────────┐  │
          │  │ 1. trust proxy + getClientIp               │  │
          │  │ 2. Turnstile 校验（/send-code 等路由）     │  │
          │  │ 3. 限流（Upstash Redis：IP/邮箱/设备）     │  │
          │  │ 4. APK 签名校验（有 X-App-Sig 时）         │  │
          │  │ 5. 一次性邮箱黑名单                         │  │
          │  │ 6. 业务路由（auth / posts / comments）      │  │
          │  │ 7. 指纹 / IP 记录 + 规则引擎评估           │  │
          │  │ 8. 降权 / 冻结 / 封禁检查                  │  │
          │  └─────────────────────────────────────────────┘  │
          └──────────────┬────────────────────────────────────┘
                         ↓
          ┌─────────────────────────┐  ┌──────────────────────┐
          │ Supabase PG (美国区)    │  │ Upstash Redis (日本) │
          │ ├─ users + risk_*       │  │ ├─ rate_limit:ip:...│
          │ ├─ fingerprints         │  │ ├─ rate_limit:email │
          │ ├─ ip_records           │  │ └─ rate_limit:fp:...│
          │ ├─ risk_events          │  └──────────────────────┘
          │ ├─ ban_records          │
          │ ├─ account_clusters     │
          │ └─ appeals              │
          └─────────────────────────┘
                         ↑
                         │ cron (node-cron on VPS)
          ┌──────────────┴─────────────────────────────────────┐
          │  Cron 任务                                         │
          │  ├─ 每小时：孤岛簇检测                             │
          │  ├─ 每 30 分钟：指纹/IP account_count 更新         │
          │  ├─ 每 10 分钟：IP 段注册密集度检测 + 自动 IP 封   │
          │  ├─ 每日：风险分时间衰减                           │
          │  ├─ 每日：disposable_email_domains 更新            │
          │  ├─ 每日：ban_records 过期清理                     │
          │  └─ 每周：风险事件 90 天归档                       │
          └────────────────────────────────────────────────────┘
```

---

## 2. 请求全链路示例

### 2.1 注册流程（含所有防御）

```
[Step 1] 用户点"注册"页面
  → 前端加载 FingerprintJS + Turnstile widget

[Step 2] 用户填邮箱 + 密码，点"发送验证码"按钮
  前端：
    1. FingerprintJS 生成 visitorId（浏览器）OR Capacitor 插件生成指纹（APK）
    2. 等待用户过 Turnstile（免费版，大部分自动通过）
    3. POST /api/auth/send-code
       headers:
         X-Device-Fingerprint: <hash>
         X-Device-Info: <base64 json>
         X-App-Signature: <HMAC>  （仅 APK 带）
       body:
         email, purpose='register'
         turnstile_token: <token>

  后端处理链：
    ┌─ Nginx 把 CF-Connecting-IP 映射到 X-Real-IP
    ├─ Express.trust_proxy + getClientIp 拿到真实 IP
    ├─ 中间件 1：验证 Turnstile token（调 CF API）
    │   失败 → 400 { error: '人机验证失败' }
    ├─ 中间件 2：限流（Upstash Redis）
    │   同 IP 每分钟 > 2 次 OR 同邮箱每小时 > 5 次 → 429
    ├─ 中间件 3：邮箱黑名单检查
    │   匹配 disposable_email_domains → 400 { error: '请使用常用邮箱' }
    ├─ 中间件 4：APK 签名校验（仅检测到 X-App-Signature header 时）
    │   HMAC 不匹配或 SHA256 不在白名单 → 记录 +45 风险分（不拒绝当次请求）
    ├─ 路由 /send-code：
    │   - 查 users 表：purpose='register' 时邮箱已存在则拒绝
    │   - createCode（原有逻辑：60 秒内重发拦截）
    │   - sendVerificationEmail（Resend）
    │   - 返回 200 { success: true }
    └─ 指纹/IP 记录异步写入 fingerprints / ip_records 表

[Step 3] 用户收到邮件，填验证码 + 提交注册
  前端：POST /api/auth/register { email, code, password, nickname }
  后端：
    - 原有 verifyCode 逻辑
    - 创建 users 记录（risk_score=0）
    - 关联指纹和 IP（user_fingerprints / user_ips）
    - 触发规则评估（评估所有 registration 类规则）
      - COLD_EMAIL_DOMAIN：邮箱不在白名单 → +10
      - DEFAULT_PROFILE：昵称是"用户xxx" → +5
      - DEVICE_MULTI_ACCOUNT：设备关联 ≥ 3 账号 → +25（同时触发限流）
      - IP_CIDR24_BURST：同段 1h 注册 ≥ 5 → +30
      - ASN_DATACENTER：机房 IP → +25
      - APK_SIGNATURE_FAIL（如前面检测失败 → +45）
      - EMULATOR_OR_ROOT（如 APK 检测到） → +25
      - NO_FINGERPRINT（若无指纹 header） → +5
    - 根据最终 risk_score 决定返回：
      * < 40：正常返回 token
      * 40-70：正常返回 token，但后续请求会触发 shadow ban
      * 70-85：返回 403 { code: 'UNDER_REVIEW' }
      * 85+：返回 403 { code: 'BANNED' }（enforce 模式下）
```

### 2.2 发帖流程（含 shadow ban / 冻结检查）

```
POST /api/posts { content }
  headers: X-Device-Fingerprint, (X-App-Signature 可选)
  authenticated via JWT

后端中间件栈：
  ├─ auth middleware：拿 req.user
  ├─ 风控中间件：
  │   - 读 users.risk_score, is_shadow_banned, restricted_until, status
  │   - status='banned' → 401（JWT 应该已失效，但双保险）
  │   - risk_score >= 70 → 403 { code: 'UNDER_REVIEW' }
  │   - 发帖冷却检查：普通 2 秒，降权 30 秒
  ├─ 指纹采集 + IP 更新
  ├─ APK 签名校验（有 X-App-Sig 时）
  ├─ 路由 /posts POST：
  │   - 写 posts 表，若 is_shadow_banned 且随机 < 0.5 → shadow_ban=true
  │   - 触发规则评估：
  │     - REGISTER_QUICK_POST（注册后 < 5 分钟）
  │     - NEW_ACCOUNT_BURST（24h 内 > 5 条）
  │     - SIMHASH_SIMILAR（对比 24h 内其他新号帖子）
  │   - 返回 200
  └─ 异步更新：last_risk_event_at
```

### 2.3 列表查询（应用 shadow ban 过滤）

```
GET /api/posts?feed=timeline

后端：
  SELECT * FROM posts
  WHERE (shadow_ban = FALSE OR author_id = $currentUserId)
  ORDER BY created_at DESC
  LIMIT 20;

效果：shadow ban 用户自己能看见自己帖子，其他人看不见
```

---

## 3. 真实 IP 解析模块

### 3.1 设计目标

一套代码适配 **ip / cloudflare / cloudflare-split** 三种部署模式。

### 3.2 各模式下 IP 链路

| 模式 | 链路 | `X-Real-IP` | `CF-Connecting-IP` | `req.ip` |
|------|------|-------------|---------------------|----------|
| **ip** | 客户端 → Nginx → Node | Nginx 透传 `$remote_addr`（客户端 IP） | 无 | 127.0.0.1 |
| **cloudflare** | 客户端 → CF → Nginx → Node | **Nginx real_ip 改写为真实 IP** | CF 原始 header | 127.0.0.1 |
| **cloudflare-split** | 同 cloudflare | 同上 | 同上 | 同上 |

### 3.3 `getClientIp()` 实现

```js
// server/src/utils/ip.js
function getClientIp(req) {
  const raw =
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown';
  // 去掉 IPv4-mapped IPv6 前缀
  return typeof raw === 'string'
    ? raw.replace(/^::ffff:/, '')
    : 'unknown';
}

function getClientIpCidr24(req) {
  const ip = getClientIp(req);
  if (ip === 'unknown' || ip.includes(':')) return null;  // 跳过 IPv6
  return ip.split('.').slice(0, 3).join('.') + '.0/24';
}

module.exports = { getClientIp, getClientIpCidr24 };
```

### 3.4 Express 配置

```js
// server/src/app.js
app.set('trust proxy', 1);  // 信任第一层代理（Nginx）
```

### 3.5 Nginx 真实 IP 配置校验

`server/deploy/nginx.split.conf.example` 应该包含：

```nginx
# CF 官方 IP 段（截至 2026 年，需每季度更新）
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
# ... 完整列表：https://www.cloudflare.com/ips-v4/
real_ip_header CF-Connecting-IP;
real_ip_recursive on;

# 传给 Node
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

**Phase 1 实施时**：
- 读 `server/deploy/nginx.split.conf.example` 和 `server/deploy/nginx.conf.example`
- 如已配置则保留；如未配置则补全
- cron 每季度拉 `cloudflare.com/ips-v4` 提醒更新（或手动维护）

---

## 4. APK 签名强校验流程

### 4.1 前提

- `.env`：
  - `ALLOWED_APK_SIGNATURES=abc123...,def456...`（逗号分隔的 SHA256 小写哈希）
  - `APK_HMAC_SECRET=<openssl rand -hex 32>`
- APK 侧：`APK_HMAC_SECRET` 通过 BuildConfig 注入（构建时 Gradle 传入）

### 4.2 APK 端生成 header（Capacitor 插件内部）

```kotlin
// Kotlin 伪代码（Capacitor 插件内）
fun generateSignatureHeader(userId: String?): String {
  val sig = PackageManager.getPackageInfo(packageName,
              PackageManager.GET_SIGNING_CERTIFICATES)
            .signingInfo.apkContentsSigners[0]
  val sigSha256 = sha256(sig.toByteArray()).toHexString()  // 明文签名哈希
  val timestamp = System.currentTimeMillis() / 1000
  val payload = "$sigSha256|$timestamp|${userId ?: ""}"
  val hmac = hmacSha256(BuildConfig.APK_HMAC_SECRET, payload).toHexString()
  return "$sigSha256|$timestamp|$hmac"  // 放到 X-App-Signature header
}
```

### 4.3 后端校验

```js
// server/src/middleware/apkSignature.js
const crypto = require('crypto');

function apkSignatureCheck(req, res, next) {
  const header = req.headers['x-app-signature'];
  if (!header) {
    // H5 请求或老版本 APK，跳过本中间件
    req.apkSignatureStatus = 'absent';
    return next();
  }
  const [sigSha256, timestamp, hmac] = header.split('|');
  const now = Math.floor(Date.now() / 1000);
  const driftSec = Math.abs(now - parseInt(timestamp, 10));
  if (driftSec > 300) {
    req.apkSignatureStatus = 'expired';
    return next();  // 不拒绝请求，由规则引擎加分
  }
  const allowed = (process.env.ALLOWED_APK_SIGNATURES || '').split(',').map(s => s.trim().toLowerCase());
  if (!allowed.includes(sigSha256.toLowerCase())) {
    req.apkSignatureStatus = 'sig_mismatch';
    return next();
  }
  const expected = crypto.createHmac('sha256', process.env.APK_HMAC_SECRET)
    .update(`${sigSha256}|${timestamp}|${req.user?.id || ''}`)
    .digest('hex');
  if (expected !== hmac) {
    req.apkSignatureStatus = 'hmac_mismatch';
    return next();
  }
  req.apkSignatureStatus = 'valid';
  next();
}
```

### 4.4 规则引擎根据状态加分

```js
// rules/apkSignatureFail.js
function evaluate(user, context) {
  if (!context.req.apkSignatureStatus) return null;
  if (context.req.apkSignatureStatus === 'valid') return null;
  if (context.req.apkSignatureStatus === 'absent') return null;  // H5
  return { triggered: true, score: rule.score };  // expired / sig_mismatch / hmac_mismatch
}
```

---

## 5. 指纹采集流程

### 5.1 浏览器端（FingerprintJS Open Source）

```js
// client/src/utils/fingerprint.js
import FingerprintJS from '@fingerprintjs/fingerprintjs';

let cachedVisitorId = null;
export async function getFingerprint() {
  if (cachedVisitorId) return cachedVisitorId;
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  cachedVisitorId = {
    hash: result.visitorId,
    details: {
      components: result.components,  // 详细分量
    },
  };
  return cachedVisitorId;
}
```

### 5.2 APK 端（Capacitor 自定义插件）

插件返回：
```js
{
  hash: 'sha256(components...)',
  platform: 'android',
  details: {
    androidId: '...',
    model: 'Pixel 7',
    osVersion: '34',
    installer: 'com.android.vending',  // Google Play / adb / 其他
    isRooted: false,
    isEmulator: false,
    apkSigSha256: '...',  // 用于后端校验白名单（和 X-App-Signature 一致）
  },
}
```

### 5.3 axios 拦截器（自动加 header）

```js
// client/src/api/request.js
import axios from 'axios';
import { getFingerprint } from '@/utils/fingerprint';
import { getApkSignatureHeader } from '@/utils/apkSignature';

const api = axios.create({ baseURL: env.API_BASE });

api.interceptors.request.use(async (config) => {
  try {
    const fp = await getFingerprint();
    config.headers['X-Device-Fingerprint'] = fp.hash;
    config.headers['X-Device-Info'] = btoa(JSON.stringify(fp.details));
    // 仅 APK 端才生成
    const apkHeader = await getApkSignatureHeader(config.headers.Authorization);
    if (apkHeader) config.headers['X-App-Signature'] = apkHeader;
  } catch (e) {
    // 指纹采集失败不阻塞请求
  }
  return config;
});
```

### 5.4 后端记录

```js
// server/src/services/fingerprint/recordFingerprint.js
async function recordFingerprint(req, userId) {
  const hash = req.headers['x-device-fingerprint'];
  if (!hash) return { absent: true };
  const infoRaw = req.headers['x-device-info'];
  const details = infoRaw ? JSON.parse(Buffer.from(infoRaw, 'base64').toString()) : {};
  const platform = req.headers['x-app-signature'] ? 'android' : 'web';

  // Upsert fingerprint
  await supabase.rpc('upsert_fingerprint', { p_hash: hash, p_platform: platform, p_details: details });
  // Upsert user_fingerprints 关联
  await supabase.rpc('upsert_user_fingerprint', { p_user_id: userId, p_fingerprint_hash: hash });
  return { absent: false, hash };
}
```

---

## 6. Cron 任务列表

### 6.1 任务时刻表（node-cron 或 PM2 cron 重启方式）

| Cron 表达式 | 任务 | Phase | 文件 |
|-------------|------|-------|------|
| `*/10 * * * *` | IP /24 段注册密集检测 + 自动 IP 封 | 3 | `server/src/cron/ipBurstCheck.js` |
| `*/30 * * * *` | 更新 fingerprints / ip_records 的 account_count | 2 | `server/src/cron/updateAccountCounts.js` |
| `0 * * * *` | 孤岛簇检测 | 4 | `server/src/cron/isolatedIslandDetect.js` |
| `0 2 * * *` | 每日凌晨 2 点：风险分时间衰减 | 4 | `server/src/cron/decayRiskScore.js` |
| `0 3 * * *` | 每日凌晨 3 点：disposable_email_domains 更新 | 1 | `server/src/cron/updateDisposableDomains.js` |
| `0 4 * * *` | 每日凌晨 4 点：ban_records 过期清理 | 3 | `server/src/cron/expireBans.js` |
| `0 5 * * 0` | 每周日凌晨 5 点：风险事件 90 天归档 | 4 | `server/src/cron/archiveRiskEvents.js` |

### 6.2 Cron 容错

- 每个 cron 任务用 `try/catch` 包裹，失败不崩溃
- 关键任务写 `cron_runs(task, started_at, finished_at, status, error)` 表（可选）
- 使用 `node-cron` 库（轻量无依赖）或 `pm2-cron` 配置

---

## 7. 管理员后台集成点

现有 `server/admin/` 目录下扩展：
- `/admin/risk-rules` - 规则配置页
- `/admin/clusters` - 账号簇视图
- `/admin/appeals` - 申诉处理
- `/admin/risk-events` - 风险事件日志
- `/admin/config` - 全局开关（observe/enforce 等）

所有页面需要 `req.user.role === 'admin'` 保护。

---

## 8. 监控与告警（Phase 4 可扩展）

建议（非必须）：
- **活跃报警**：1h 内有 > 10 个账号达到 85+ → 邮件通知管理员
- **异常率**：Turnstile 校验失败率 > 30% → 可能被攻击
- **Cron 健康**：cron 未按时启动 > 2 小时 → 邮件告警

Phase 4 完成后可以考虑接入 Uptime-kuma 或简单 email 告警。

---

**下一步**：读 [04-phase1-infrastructure.md](./04-phase1-infrastructure.md) 开始 Phase 1 实施。
