# 邮箱认证改造方案

把注册/登录从"手机号+密码+固定验证码 123456"改成"邮箱+密码+真实 Resend 邮件验证码"，并新增忘记密码功能。

---

## 1. 技术栈与依赖

| 项 | 选择 |
|---|---|
| 邮件服务 | Resend（测试期用 `onboarding@resend.dev`，上线换 `noreply@agent666.xyz`） |
| 验证码存储 | PostgreSQL 新表 `email_verifications`（非内存，支持多进程扩展） |
| 验证码格式 | 6 位纯数字，10 分钟过期 |
| 防滥用 | 同一邮箱 60 秒内只能请求 1 次 |
| 发送方式 | `fetch` 调 Resend HTTP API（无需额外 SDK，减少依赖） |

**新增 npm 依赖**：无。Node 18+ 内置 `fetch`，已有的 `bcryptjs` + `jsonwebtoken` 继续用。

---

## 2. 数据库迁移

### 2.1 新建迁移文件 `database/migration_email_auth.sql`

```sql
-- ============ users 表改造 ============
-- 加 email 列（先允许 NULL，后面 backfill 完再设 NOT NULL）
ALTER TABLE users ADD COLUMN email VARCHAR(255);

-- phone 从 NOT NULL 改为可空
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- 迁移现有测试账号
UPDATE users SET email = 'admin@test.local' WHERE phone = '13800000001';
UPDATE users SET email = 'user1@test.local' WHERE phone = '13800000002';
UPDATE users SET email = 'user2@test.local' WHERE phone = '13800000003';
UPDATE users SET email = 'user3@test.local' WHERE phone = '13800000004';
-- 其他没有 email 的老账号兜底（避免 NOT NULL 迁移失败）
UPDATE users SET email = CONCAT('legacy_', id, '@test.local') WHERE email IS NULL;

-- 设为 NOT NULL + UNIQUE
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
CREATE INDEX idx_users_email ON users(email);

-- ============ 验证码表 ============
CREATE TABLE email_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('register', 'reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_verifications_lookup
    ON email_verifications(email, purpose, created_at DESC);

-- 定期清理过期的旧记录（可选，不做也不影响功能）
-- DELETE FROM email_verifications WHERE created_at < NOW() - INTERVAL '7 days';
```

### 2.2 更新 `database/schema.sql`

把上面的改动直接并入 schema.sql 作为新人部署的基础 schema（未来全新部署用新的 schema，不需要跑 migration）。

### 2.3 执行方式

在 Supabase 控制台 SQL Editor 贴 SQL 跑一次。

---

## 3. 后端改造（server/）

### 3.1 新增 `server/src/services/emailService.js`

```js
// 封装 Resend API 调用
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.EMAIL_FROM || '工大圈子 <onboarding@resend.dev>';

async function sendVerificationEmail(email, code, purpose) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

  const isRegister = purpose === 'register';
  const subject = isRegister
    ? '【工大圈子】您的注册验证码'
    : '【工大圈子】您的重置密码验证码';

  const body =
    `你好，\n\n` +
    `你的${isRegister ? '注册' : '重置密码'}验证码是：${code}\n\n` +
    `请在 10 分钟内使用，过期请重新获取。\n` +
    `如非本人操作，请忽略此邮件。\n\n` +
    `——工大圈子`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: email, subject, text: body }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error: ${res.status} ${errText}`);
  }
}

module.exports = { sendVerificationEmail };
```

### 3.2 新增 `server/src/services/verificationService.js`

```js
// 生成 / 校验 / 限流
const supabase = require('../config/supabase');

const CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 秒

async function createCode(email, purpose) {
  // 限流：检查最近一次发送时间
  const { data: last } = await supabase
    .from('email_verifications')
    .select('created_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last) {
    const elapsedMs = Date.now() - new Date(last.created_at).getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      const secondsLeft = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      const err = new Error(`请 ${secondsLeft} 秒后再试`);
      err.code = 'RATE_LIMITED';
      throw err;
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const { error } = await supabase
    .from('email_verifications')
    .insert({ email, code, purpose, expires_at: expiresAt });

  if (error) throw new Error('验证码创建失败');
  return code;
}

async function verifyCode(email, code, purpose) {
  const { data } = await supabase
    .from('email_verifications')
    .select('id, code, expires_at, used_at')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { ok: false, reason: '验证码不存在，请先获取' };
  if (data.used_at) return { ok: false, reason: '验证码已使用，请重新获取' };
  if (new Date(data.expires_at).getTime() < Date.now())
    return { ok: false, reason: '验证码已过期，请重新获取' };
  if (data.code !== code) return { ok: false, reason: '验证码不正确' };

  // 标记已使用
  await supabase
    .from('email_verifications')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { ok: true };
}

module.exports = { createCode, verifyCode };
```

### 3.3 重写 `server/src/routes/auth.js`

删掉：内存 `verificationCodes` Map、手机号校验、旧的 register/login。

接口签名：

| Method | Path | Body | 说明 |
|--------|------|------|------|
| POST | `/api/auth/send-code` | `{ email, purpose: 'register'\|'reset' }` | 生成验证码并发邮件 |
| POST | `/api/auth/register` | `{ email, password, code, nickname? }` | 注册账号 |
| POST | `/api/auth/login` | `{ email, password }` | 登录 |
| POST | `/api/auth/reset-password` | `{ email, code, newPassword }` | 重置密码 |
| PUT | `/api/auth/change-password` | `{ oldPassword, newPassword }` | 登录态下改密（**保留不动**） |

JWT payload 改动：`{ id, email, role }`（把 `phone` 换成 `email`）。

注册流程里的 `nickname` 默认值：`用户${email.split('@')[0].slice(0, 8)}`。

### 3.4 更新 `server/.env.example`

新增：
```
# Resend API Key（https://resend.com 注册后获取，格式 re_xxx）
RESEND_API_KEY=re_your_api_key_here

# 发件人地址
#   测试期用: 工大圈子 <onboarding@resend.dev>
#   上线后用: 工大圈子 <noreply@agent666.xyz>（需在 Resend 验证域名）
EMAIL_FROM=工大圈子 <onboarding@resend.dev>
```

### 3.5 JWT middleware 不用改

`server/src/middleware/auth.js` 里用的是 `req.user.id`，不读 `phone`，所以**不动**。

---

## 4. 前端改造（client/）

### 4.1 `client/src/api/auth.js`

```js
import { post } from './request';

export const sendCode = (email, purpose) => post('/auth/send-code', { email, purpose });
export const register = (data) => post('/auth/register', data);
export const login = (data) => post('/auth/login', data);
export const resetPassword = (data) => post('/auth/reset-password', data);
```

### 4.2 `client/src/pages/login/index.vue`

- 所有"手机号"字样改为"邮箱"
- `phone` 字段改为 `email`
- 加邮箱格式校验
- 新增"忘记密码？"链接，跳转 `/pages/forgot-password/index`
- 新增"还没有账号？注册"链接

### 4.3 `client/src/pages/register/index.vue`

- 字段：`email`、`password`、`code`、`nickname`（可选）
- 格式校验：
  - email：标准 RFC email 正则
  - password：至少 6 位
  - code：6 位数字
- "发送验证码"按钮点击后：
  - 校验邮箱格式
  - 调 `sendCode(email, 'register')`
  - 按钮改为灰色"60s 后重试"，倒计时
  - 60 秒后恢复

### 4.4 新增 `client/src/pages/forgot-password/index.vue`

两步表单：

**Step 1**：输入邮箱 → 点击"发送验证码" → 调 `sendCode(email, 'reset')`
**Step 2**：输入验证码 + 新密码 → 点击"重置" → 调 `resetPassword({email, code, newPassword})` → 成功后跳回登录页

### 4.5 `client/src/pages.json`

加上 forgot-password 的页面注册。

### 4.6 其他 UI 检查点

全局搜索 `phone` 字段引用、"手机号"文案，确保：
- 个人资料页不显示 phone（或改为显示 email）
- 管理员后台用户列表若显示 phone，加上 email 列

---

## 5. 完整文件清单

**新增**：
```
database/migration_email_auth.sql
server/src/services/emailService.js
server/src/services/verificationService.js
client/src/pages/forgot-password/index.vue
```

**修改**：
```
database/schema.sql                        # 并入 email 相关改动
server/src/routes/auth.js                  # 全量重写
server/.env.example                        # 加 RESEND_API_KEY / EMAIL_FROM
client/src/api/auth.js                     # 加 resetPassword，signature 改 email
client/src/pages/login/index.vue           # phone → email + 忘记密码链接
client/src/pages/register/index.vue        # phone → email + 发送验证码倒计时
client/src/pages.json                      # 注册 forgot-password 页面
```

**删除**：无（`phone` 字段在 DB 保留）

---

## 6. 部署顺序

1. 在 Resend 注册账号，创建 API key
2. VPS 的 `/opt/hit-circle/server/.env` 加 `RESEND_API_KEY`、`EMAIL_FROM`
3. Supabase SQL Editor 跑 `database/migration_email_auth.sql`
4. 部署后端代码 → `pm2 restart hit-circle`
5. 本地 `npm run build:h5` → scp 到 VPS 的 H5 目录
6. 本地 `npx cap sync android` → Android Studio 重新打 APK → 装手机
7. 用 admin@test.local / test123 登录验证
8. 用真实邮箱（比如你的 Gmail）注册一个新账号，检查邮件送达

---

## 7. 验证 checklist

- [ ] 注册：输入邮箱 → 点发送 → 60s 内重复点被拒 → 邮箱收到 6 位码 → 填写码+密码 → 注册成功 → 自动登录跳首页
- [ ] 登录：邮箱+密码 → 成功 → 错误密码返回"邮箱或密码不正确"
- [ ] 忘记密码：输邮箱 → 收重置码 → 设新密码 → 用新密码能登录
- [ ] 验证码过期（>10 分钟）无法使用
- [ ] 验证码一次性（用过的不能重用）
- [ ] admin@test.local 能正常登录管理后台
- [ ] APK 安装新版本后，旧手机号登录返回 400（预期，因为接口改了）
- [ ] 发帖、评论、聊天、好友等功能**不受影响**（因为只改了认证层）

---

## 8. 风险与回滚

| 风险 | 应对 |
|------|------|
| Resend 邮件进垃圾箱 | 让用户检查垃圾箱；上线时配好 SPF/DKIM/DMARC |
| 迁移后遗留老账号 | `legacy_<uuid>@test.local` 兜底邮箱，老账号仍能被引用（虽然登录不了） |
| 旧 APK 无法登录 | 公告提示用户升级；旧 APK 用户数不多（100 人以内） |
| Resend API key 泄露 | `.env` 不入库，已有 `.gitignore` 保护 |
| DB 迁移失败 | SQL 都是幂等的加列/加约束；失败可手动回滚 `DROP COLUMN email` / `DROP TABLE email_verifications` |

---

## 9. 时间预估

| 阶段 | 时长 |
|------|------|
| DB migration 写+测 | 15 min |
| 后端 service + routes | 45 min |
| 前端 3 个页面改+新增 | 60 min |
| 联调 + 验证 | 30 min |
| APK 打包上机测试 | 15 min |
| **合计** | ~2.5 小时 |

---

## 10. 确认后的执行流程

1. 你看完这个 Plan，确认或提修改意见
2. 我按阶段写代码：DB → 后端 → 前端 → APK 重建
3. 每阶段写完提交一个 commit
4. 全部做完后，你在 VPS 上走一遍 [第 6 节] 部署流程
