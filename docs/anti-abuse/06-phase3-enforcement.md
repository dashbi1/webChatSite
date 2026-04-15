# 06 — Phase 3：降权执行、账号簇、批量封、申诉框架

> **工期预估**：3-4 天
> **目标**：让风险分真正"有用"——触发 shadow ban / 冻结 / 封禁，管理员能看账号簇视图并批量封禁，搭建申诉骨架（前端占位）。
> **结束标志**：手动测试清单全通过，用户确认后进入 Phase 4。

---

## 1. 交付物

- **降权执行层**：shadow ban 过滤 + 冻结拒绝 + 自动封禁
- **前端冻结提示**：顶部 banner + 点击动作 toast
- **管理员后台新增页面**：
  - 账号簇视图（按指纹 / IP / 行为聚类分组）
  - 批量封禁 UI（预览确认机制）
  - 风险事件日志查询
  - 全局开关（observe / enforce / appeals_enabled）
- **申诉框架**：
  - 后端 API（`/api/appeals`）完整可用
  - 前端按钮占位（点击提示"功能开发中"）
  - `appeals_enabled` feature flag 控制（默认 false）
- **自动 IP 封**：cron 每 10 分钟检查 IP /24 段注册密集度
- **数据表**：ban_records / account_clusters / appeals
- **测试**：单元 + 集成 + E2E + 手动清单
- **迁移脚本**：`database/migrations/anti_abuse_phase3.sql`

---

## 2. 前置准备

- [ ] `git checkout -b feat/anti-abuse-phase3`
- [ ] 确认 Phase 2 的 risk_score / risk_events 正常运转

---

## 3. 文件改动清单

### 3.1 新增文件

```
server/
├── src/
│   ├── middleware/
│   │   ├── riskEnforcer.js                # 降权/冻结/封禁的中间件
│   │   └── shadowBanFilter.js             # 查询结果的 shadow ban 过滤辅助
│   ├── services/
│   │   ├── enforcement/
│   │   │   ├── applyEnforcement.js        # 根据 risk_score 更新 users 状态
│   │   │   ├── shadowBan.js               # 发帖 / 评论时判断是否 shadow
│   │   │   └── banRecord.js               # 写 ban_records + 级联动作
│   │   ├── cluster/
│   │   │   ├── fingerprintCluster.js      # 按指纹分组
│   │   │   ├── ipCluster.js               # 按 /24 段分组
│   │   │   └── index.js                   # 统一查询接口
│   │   └── appeals/
│   │       └── appealService.js           # 申诉 CRUD + 限流
│   ├── routes/
│   │   ├── appeals.js                     # 用户申诉 API
│   │   └── admin/
│   │       ├── clusters.js                # 账号簇 API
│   │       ├── bulkBan.js                 # 批量封禁 API
│   │       ├── appeals.js                 # 管理员处理申诉
│   │       └── riskEvents.js              # 风险事件日志
│   └── cron/
│       └── ipBurstCheck.js                # 每 10 分钟 IP 段封禁检查
├── admin/
│   ├── clusters/                          # 账号簇视图
│   ├── bulk-ban/                          # 批量封禁
│   ├── appeals/                           # 申诉处理
│   ├── risk-events/                       # 风险事件日志
│   └── config/                            # 全局开关
database/migrations/
└── anti_abuse_phase3.sql

client/
├── src/
│   ├── components/
│   │   └── RiskBanner.vue                 # 顶部 banner 提示"审核中"
│   ├── pages/
│   │   └── appeals/
│   │       └── index.vue                  # 申诉页面（占位）
│   └── api/
│       └── appeals.js                     # 申诉接口封装
```

### 3.2 修改文件

```
server/
├── src/
│   ├── app.js                             # 挂载 riskEnforcer 中间件
│   └── routes/
│       ├── posts.js                       # GET 列表过滤 shadow，POST 检查冻结
│       ├── comments.js                    # 同上
│       ├── likes.js                       # 降权用户点赞不计数
│       ├── messages.js                    # 冻结用户不能发私聊
│       └── friendships.js                 # 冻结用户不能发好友申请

client/
├── src/
│   ├── App.vue                            # 全局挂 RiskBanner
│   ├── pages/
│   │   ├── index/index.vue                # 发帖按钮点击检查 toast
│   │   └── ... (私聊 / 评论等同理)
│   └── stores/
│       └── user.js                        # 存 restricted_until / under_review 状态
```

---

## 4. 关键逻辑

### 4.1 降权等级计算（核心）

```js
// server/src/services/enforcement/applyEnforcement.js
const supabase = require('../../config/supabase');
const { isWhitelistedDomain } = require('../whitelist/emailDomains');

/**
 * 根据 user.risk_score 计算应该处于什么级别，并更新 DB
 * 可应管理员手动触发 or scoreStore.applyScoreDelta 自动触发
 */
async function applyEnforcement(user) {
  const score = user.risk_score;
  const isWhitelist = isWhitelistedDomain(user.email);

  let updates = {
    is_shadow_banned: false,
    shadow_ban_until: null,
    restricted_until: null,
  };
  let newStatus = user.status;

  if (score >= 85 && !isWhitelist) {
    newStatus = 'banned';
    await createBanRecord('user', user.id, 'auto_score', '风险分 >= 85 自动封禁');
  } else if (score >= 70) {
    // 冻结：设 restricted_until = 7 天后
    updates.restricted_until = new Date(Date.now() + 7 * 86400 * 1000);
  } else if (score >= 40) {
    // 降权：shadow ban
    updates.is_shadow_banned = true;
    updates.shadow_ban_until = new Date(Date.now() + 14 * 86400 * 1000);
  }
  // score < 40：清理降权状态（上面默认值已处理）

  await supabase.from('users').update({ ...updates, status: newStatus }).eq('id', user.id);
  return { score, level: scoreToLevel(score), enforced: newStatus === 'banned' };
}

function scoreToLevel(s) {
  if (s >= 85) return 'banned';
  if (s >= 70) return 'frozen';
  if (s >= 40) return 'restricted';
  return 'normal';
}

module.exports = { applyEnforcement, scoreToLevel };
```

### 4.2 风控中间件（每个关键动作前执行）

```js
// server/src/middleware/riskEnforcer.js
const supabase = require('../config/supabase');

const FROZEN_ACTIONS = new Set(['post_create', 'comment_create', 'message_send', 'friend_request']);

async function riskEnforcer(req, res, next) {
  if (!req.user) return next();
  // 取最新状态（JWT 里的可能过时）
  const { data: user } = await supabase
    .from('users')
    .select('id, status, risk_score, restricted_until, is_shadow_banned, shadow_ban_until')
    .eq('id', req.user.id)
    .single();
  if (!user) return res.status(401).json({ success: false, error: '用户不存在' });

  // 封禁
  if (user.status === 'banned') {
    return res.status(403).json({ success: false, code: 'BANNED', error: '账号已被封禁' });
  }

  // 冻结（70-85）
  const now = new Date();
  const isFrozen = user.restricted_until && new Date(user.restricted_until) > now;
  req.user.isFrozen = isFrozen;
  req.user.isShadowBanned = user.is_shadow_banned &&
                            user.shadow_ban_until &&
                            new Date(user.shadow_ban_until) > now;
  req.user.riskScore = user.risk_score;

  // 对冻结用户拦截关键动作
  const action = req.body?._action || req.route?.path;
  if (isFrozen && isFrozenBlockedAction(req)) {
    return res.status(403).json({
      success: false,
      code: 'UNDER_REVIEW',
      error: '账号审核中，暂时无法进行此操作',
    });
  }
  next();
}

function isFrozenBlockedAction(req) {
  // 根据路由判断
  const p = req.originalUrl;
  if (req.method === 'POST' && p.startsWith('/api/posts')) return true;
  if (req.method === 'POST' && p.startsWith('/api/comments')) return true;
  if (req.method === 'POST' && p.startsWith('/api/messages')) return true;
  if (req.method === 'POST' && p.startsWith('/api/friendships')) return true;
  return false;
}

module.exports = { riskEnforcer };
```

### 4.3 Shadow Ban 写入 + 查询过滤

```js
// server/src/services/enforcement/shadowBan.js
function shouldShadowPost(user, sampleRate = 0.5) {
  if (!user.isShadowBanned) return false;
  return Math.random() < sampleRate;
}

module.exports = { shouldShadowPost };
```

```js
// server/src/routes/posts.js（发帖时）
const shadow = shouldShadowPost(req.user);
await supabase.from('posts').insert({
  author_id: req.user.id,
  content,
  media_urls,
  shadow_ban: shadow,  // ← 新字段
});
```

**Schema 补充**（挪到 Phase 3 迁移）：
```sql
ALTER TABLE posts ADD COLUMN shadow_ban BOOLEAN DEFAULT FALSE;
ALTER TABLE comments ADD COLUMN shadow_ban BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_posts_shadow ON posts(shadow_ban) WHERE shadow_ban = FALSE;
```

```js
// server/src/routes/posts.js（查询时）
// GET /api/posts （timeline）
const currentUserId = req.user?.id;
const { data } = await supabase.rpc('get_timeline_posts', {
  current_user_id: currentUserId,
  limit: 20,
  offset: 0,
});
// 或用 Supabase filter：
// .or(`shadow_ban.eq.false,author_id.eq.${currentUserId}`)
```

**SQL 函数**（迁移脚本里创建）：
```sql
CREATE OR REPLACE FUNCTION get_timeline_posts(
  current_user_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS SETOF posts AS $$
  SELECT * FROM posts
  WHERE (shadow_ban = FALSE OR author_id = current_user_id)
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$ LANGUAGE SQL STABLE;
```

### 4.4 账号簇视图（后端）

```js
// server/src/services/cluster/fingerprintCluster.js
async function listFingerprintClusters({ minAccounts = 3, limit = 50 } = {}) {
  const { data } = await supabase.rpc('list_fingerprint_clusters', {
    p_min_accounts: minAccounts,
    p_limit: limit,
  });
  return data;  // [{ fingerprint_id, account_count, account_ids, platform, last_seen_at }]
}
```

```sql
-- 迁移里创建
CREATE OR REPLACE FUNCTION list_fingerprint_clusters(p_min_accounts INT, p_limit INT)
RETURNS TABLE(fingerprint_id UUID, account_count INT, account_ids UUID[], platform VARCHAR, last_seen_at TIMESTAMPTZ) AS $$
  SELECT f.id, f.account_count, array_agg(uf.user_id), f.platform, f.last_seen_at
  FROM fingerprints f
  JOIN user_fingerprints uf ON uf.fingerprint_id = f.id
  WHERE f.account_count >= p_min_accounts
  GROUP BY f.id
  ORDER BY f.account_count DESC, f.last_seen_at DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;
```

### 4.5 批量封禁 API

```js
// server/src/routes/admin/bulkBan.js
router.post('/preview', adminOnly, async (req, res) => {
  const { mode, params } = req.body;  // mode: 'score_gt' | 'same_ip_recent' | 'keyword' | 'cluster_fingerprint'
  const { data: users } = await findCandidates(mode, params);
  res.json({ success: true, data: { count: users.length, users } });
});

router.post('/execute', adminOnly, async (req, res) => {
  const { mode, params, reason } = req.body;
  const { data: users } = await findCandidates(mode, params);
  const results = [];
  for (const u of users) {
    await supabase.from('users').update({ status: 'banned' }).eq('id', u.id);
    await supabase.from('ban_records').insert({
      target_type: 'user',
      target_id: u.id,
      ban_type: `bulk_${mode}`,
      reason: reason || `批量封禁：${mode}`,
      created_by: req.user.id,
    });
    results.push(u.id);
  }
  res.json({ success: true, banned_count: results.length });
});

async function findCandidates(mode, params) {
  if (mode === 'score_gt') {
    return supabase.from('users').select('id, email').gte('risk_score', params.threshold);
  }
  if (mode === 'same_ip_recent') {
    return supabase.rpc('users_same_ip_within_hours', { p_ip: params.ip, p_hours: params.hours });
  }
  if (mode === 'keyword') {
    const { data } = await supabase.from('posts').select('author_id')
      .textSearch('content', params.keyword).limit(200);
    const userIds = [...new Set((data || []).map(r => r.author_id))];
    return supabase.from('users').select('id, email').in('id', userIds);
  }
  if (mode === 'cluster_fingerprint') {
    return supabase.rpc('users_by_fingerprint_cluster', { p_fingerprint_id: params.fingerprint_id });
  }
  return { data: [] };
}
```

### 4.6 申诉 API（前端占位 + 后端可用）

```js
// server/src/routes/appeals.js
const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');
const { getSystemConfig } = require('../services/config');

const router = express.Router();

// 提交申诉
router.post('/', authMiddleware, async (req, res) => {
  // feature flag 检查
  const enabled = await getSystemConfig('appeals_enabled');
  if (!enabled) {
    return res.status(503).json({
      success: false,
      code: 'COMING_SOON',
      error: '申诉功能正在开发中，敬请期待',
    });
  }
  // 7 天内不超过 3 次
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { count } = await supabase.from('appeals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .gte('created_at', since);
  if (count >= 3) {
    return res.status(429).json({ success: false, error: '7 天内申诉次数已达上限' });
  }
  const { contact_email, reason, evidence_urls } = req.body;
  if (!reason || reason.length < 10) {
    return res.status(400).json({ success: false, error: '请详细描述申诉理由（至少 10 字）' });
  }
  const { data } = await supabase.from('appeals').insert({
    user_id: req.user.id,
    contact_email,
    reason,
    evidence_urls: evidence_urls || [],
  }).select().single();
  res.json({ success: true, data });
});

// 查询自己的申诉列表
router.get('/my', authMiddleware, async (req, res) => {
  const { data } = await supabase.from('appeals')
    .select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json({ success: true, data });
});

module.exports = router;
```

### 4.7 前端冻结提示

```vue
<!-- client/src/components/RiskBanner.vue -->
<template>
  <div v-if="isFrozen" class="risk-banner">
    <span>您的账号正在审核中，暂时无法发帖、发私聊或发好友申请</span>
    <a @click="openAppeal">申诉</a>
  </div>
</template>
<script setup>
import { computed } from 'vue';
import { useUserStore } from '@/stores/user';
const user = useUserStore();
const isFrozen = computed(() => user.restrictedUntil && new Date(user.restrictedUntil) > new Date());
function openAppeal() { uni.navigateTo({ url: '/pages/appeals/index' }); }
</script>
<style scoped>
.risk-banner {
  position: sticky; top: 0; z-index: 999;
  background: #fff3cd; color: #856404;
  padding: 12px 16px; font-size: 14px;
  border-bottom: 1px solid #ffeaa7;
}
.risk-banner a { color: #0056b3; margin-left: 8px; }
</style>
```

```js
// client/src/api/request.js（改造拦截器）
axios.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.data?.code === 'UNDER_REVIEW') {
      uni.showToast({ title: '账号审核中，暂时无法进行此操作', icon: 'none' });
    }
    if (err.response?.data?.code === 'COMING_SOON') {
      uni.showToast({ title: '功能开发中，敬请期待', icon: 'none' });
    }
    return Promise.reject(err);
  }
);
```

```vue
<!-- client/src/pages/appeals/index.vue（占位） -->
<template>
  <view class="appeals-page">
    <view class="form">
      <textarea v-model="reason" placeholder="请详细描述申诉理由" />
      <input v-model="email" placeholder="联系邮箱" />
      <button @click="submit">提交申诉</button>
    </view>
  </view>
</template>
<script setup>
import { ref } from 'vue';
import { submitAppeal } from '@/api/appeals';
const reason = ref('');
const email = ref('');
async function submit() {
  try {
    await submitAppeal({ reason: reason.value, contact_email: email.value });
    uni.showToast({ title: '申诉已提交', icon: 'success' });
  } catch (e) {
    // 如果后端 feature flag 关：code=COMING_SOON，拦截器自动弹 toast
    // 未来开启后该流程自动可用
  }
}
</script>
```

### 4.8 Cron：IP 段注册密集度

```js
// server/src/cron/ipBurstCheck.js
const cron = require('node-cron');
const supabase = require('../config/supabase');

async function check() {
  // 找 1h 内同一 /24 段注册 >= 5 的 IP 段
  const { data } = await supabase.rpc('find_burst_ip_cidr24', { p_window_hours: 1, p_min: 5 });
  for (const row of data || []) {
    // 写 ban_records，15 分钟临时封
    await supabase.from('ban_records').insert({
      target_type: 'ip',
      target_id: row.ip_cidr_24,
      ban_type: 'auto_score',
      reason: `1h 内同段注册 ${row.account_count} 个账号`,
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    // 同时更新 ip_records.is_banned
    await supabase.from('ip_records').update({
      is_banned: true,
      banned_until: new Date(Date.now() + 15 * 60 * 1000),
    }).eq('ip_cidr_24', row.ip_cidr_24);
  }
}

cron.schedule('*/10 * * * *', check);
module.exports = { check };
```

---

## 5. Phase 3 测试清单

### 5.1 自动化

#### 单元
- [ ] `applyEnforcement.test.js`：score 分段映射到正确状态，白名单邮箱不被封
- [ ] `shadowBan.test.js`：采样率正确
- [ ] `appealService.test.js`：7 天 3 次限制

#### 集成
- [ ] 手动把测试用户 risk_score 设为 45 → 查询 timeline 别人看不到他帖子，自己能看
- [ ] risk_score = 75 → POST /api/posts 返回 403 UNDER_REVIEW
- [ ] risk_score = 90 → POST /api/auth/login 成功但 GET /api/posts 403 / POST 任何都 401
- [ ] POST /admin/bulk-ban/preview 返回用户列表
- [ ] POST /admin/bulk-ban/execute 真正封禁
- [ ] POST /api/appeals appeals_enabled=false → 503 COMING_SOON
- [ ] POST /api/appeals appeals_enabled=true → 200 + 7 天 3 次限流

#### E2E
- [ ] 管理员登录 → /admin/clusters → 看到账号簇列表
- [ ] 点击一键封簇 → 弹预览"即将封禁 5 个账号" → 点确认 → 5 个账号 status=banned
- [ ] 管理员后台切 observe/enforce → 下一次规则触发行为改变

### 5.2 手动测试

**Shadow Ban 表现**
- [ ] 把 A 账号 risk_score 手动设为 45，A 发帖，B（普通用户）刷 timeline → 看不到 A 的帖子
- [ ] A 自己打开 timeline → 能看到自己的帖子
- [ ] A 的评论也同理（别人看不到）
- [ ] A 点赞后，B 看帖子 like_count 不变（或要求另算，Phase 3 简单实现：直接不写 likes 表）
- [ ] 5 次刷新后统计命中率 ≈ 50%（shadow_ban_sample_rate=0.5）

**冻结表现**
- [ ] A 账号 risk_score=75 → 前端打开首页应看到顶部黄色 banner
- [ ] 点击发帖按钮 → 弹 toast "账号审核中..."
- [ ] 点击私聊、好友申请 → 同样 toast
- [ ] 点击"申诉"链接 → 跳转到申诉页面
- [ ] 申诉页面点"提交" → toast "功能开发中"（因为 appeals_enabled=false）

**封禁表现**
- [ ] A 账号 risk_score=90 → 尝试登录 → 返回 `{code: BANNED}`
- [ ] 管理员后台能看到 A 账号已封，且有 ban_records

**白名单豁免**
- [ ] A 账号邮箱是 `student@hit.edu.cn`，risk_score=90 → 依然**不自动封**（推送管理员审核队列）
- [ ] 查 account_clusters.status 应有对应记录

**账号簇视图**
- [ ] 访问 `/admin/clusters` → 看到三类簇（指纹簇、IP段簇、孤岛簇 Phase 4 才有）
- [ ] 点击某簇 → 展开成员列表
- [ ] 点击"一键封簇" → 弹预览框列出全部成员
- [ ] 点确认 → 整簇 status=banned，ban_records 写入 ban_type='cluster'

**批量封禁 UI**
- [ ] 选"按风险分 > X" → 输入 60 → 预览 → 显示 5 个候选账号
- [ ] 确认执行 → 5 个账号封禁
- [ ] 再试"按最近 1 小时同 IP 注册"→ 输入 IP → 预览 → 确认
- [ ] "按关键词"→ 输入 "垃圾广告"→ 预览 → 确认

**IP 段自动封**
- [ ] 用 10 个同 /24 段 IP（模拟）在 1h 内注册 → 等 10 分钟 cron → ip_records.is_banned=true
- [ ] 该 IP 段下一次请求（Phase 3 先实现"记录"，Phase 4 cron 真正拒绝）

**申诉功能（feature flag）**
- [ ] appeals_enabled=false 默认状态 → 点申诉 → toast "功能开发中"
- [ ] 管理员后台切 appeals_enabled=true → 刷新前端 → 申诉页能真正提交
- [ ] 连提 4 次 → 第 4 次 429

**全局开关**
- [ ] 管理员切 observe 模式 → 新触发的规则不再降权（risk_score 不变）
- [ ] 切回 enforce → 新触发的规则正常降权

### 5.3 回归
- [ ] Phase 1、Phase 2 所有功能仍正常
- [ ] 普通用户（risk_score=0）完全不受影响，所有功能正常

---

## 6. 完成标志

- 所有自动化测试通过
- 所有手动测试清单全通过
- 代码通过 **code-reviewer** 审查
- 提交 commit：`feat(anti-abuse-phase3): enforcement + clusters + bulk ban + appeals skeleton`
- VPS 观察 1 小时无异常
- 用户确认后进入 Phase 4

---

## 7. 回滚策略

- 紧急情况：管理员后台切 observe → 所有降权立刻停止
- 手动解除误封：SQL `UPDATE users SET status='active', risk_score=0, is_shadow_banned=false WHERE id=...;` + 写 `ban_records.revoked_at`

---

**下一步**：Phase 3 完成后，进入 [07-phase4-clustering-decay.md](./07-phase4-clustering-decay.md)。
