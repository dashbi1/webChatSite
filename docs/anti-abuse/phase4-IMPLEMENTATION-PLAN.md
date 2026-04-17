# Phase 4 实施 Plan（马尔可夫式）

> 反滥用系统 Phase 4：聚类检测 + 时间衰减 + 正向奖励 + 申诉热启用 + 事件归档。
> 本文档自包含，无需回溯前期对话即可独立执行。

---

## 0. 范围与目标

完成反滥用系统的**长期治理能力**：
- **孤岛簇检测**（每小时 cron）：发现新号互关互赞养号
- **风险分时间衰减**（每日 cron）：自然回归 + 修复历史误判
- **正向行为奖励**（4 个事件式 + 1 个 daily cron）：奖励干净用户
- **过期封禁清理**（每日 cron）：自动恢复 IP/设备临时封
- **风险事件归档**（每周 cron）：90 天前 risk_events 移到归档表
- **申诉系统热启用**：`appeals_enabled=true` + 管理员后台处理 UI

**结束标志**：所有自动化测试通过 + 手动测试清单 ✅ + VPS 上线后 PM2 无报错。

---

## 1. 已对齐的全部决策（共 23 项）

| # | 决策 | 选择 |
|---|------|------|
| Q1 | 互动数据源：写 supabase RPC（`list_new_user_likes` / `list_new_user_comments`） | A |
| Q2 | 时间衰减是否对历史用户生效 | A（生效，但跳过 `status='banned'`） |
| Q3 | 正向奖励触发点 | A（4 个事件式 + 1 个 daily） |
| Q4 | 同簇过滤复用 `account_clusters` | A |
| Q5 | 上线即 `appeals_enabled=true` | A |
| Q6 | 归档：移到 `risk_events_archive` 表 | B |
| Q7 | 测试范围 | A（单元 + 集成 + 手动 md） |
| Q8 | 申诉处理 UI 位置 | A（在 `server/admin/index.html` 加 Appeals tab） |
| Q9 | 提交粒度 | A（1 个合并 commit） |
| Q10 | 衰减只跳过 banned，frozen/restricted 仍衰减 | A |
| Q11 | 加 `expireBans` cron | A |
| Q12 | 互动率公式去重（无向边） | A |
| Q13 | "陌生人点赞 -3"：第一个非簇内点赞触发 | A |
| Q14 | weekly_active_clean = "近 7 天活跃 + 近 7 天 rule_trigger 累计 score_delta < 10" | B |
| Q15 | 好友通过奖励 → 申请方 | A |
| Q16 | 申诉 UI：行内通过/拒绝 + 备注弹窗 | A |
| Q17 | `risk_events_archive` 字段同 `risk_events` + `archived_at` + `(user_id, created_at)` 索引 | A |
| Q18 | 衰减/奖励**双写** `risk_events` 和 `risk_score_decay_log` | A |
| Q19 | 无违规 = 7 天内 rule_trigger 累计 `score_delta < 10` | B |
| Q20 | 边语义（friendships accepted / likes 经 posts.author_id / comments 经 posts.author_id） | A |
| Q21 | 同簇过滤排除 `cleared` 和 `ignored` 状态 | A |
| Q22 | observe 模式下 cron 仍跑（applyEnforcement 内部已处理 observe） | A |
| Q23 | archive cron 每周日 04:00 | A |

**自决细节**：
- cron 时间错峰：island=`0 * * * *`、decay=`0 2 * * *`、daily reward=`30 3 * * *`、expireBans=`30 4 * * *`、archive=`0 4 * * 0`
- decay cron 分页：每批 500 用户
- 触发式奖励冷却：用 Upstash Redis（已存在 `services/cache/redis.js` 或类似），fallback 查 `risk_events`
- migration 文件：`database/migrations/anti_abuse_phase4.sql`（含 RPC + appeals_enabled=true）
- commit msg：`feat(anti-abuse-phase4): clustering + decay + rewards + appeals live`

---

## 2. 现状盘点（继承自 Phase 1-3）

### 2.1 已有数据表（关键字段）

| 表 | 关键字段 | Phase4 是否需要 |
|----|---------|-----------------|
| `users` | `id, email, status, risk_score, restricted_until, is_shadow_banned, shadow_ban_until, last_risk_event_at, created_at` | ✅ 直接读写 |
| `friendships` | `requester_id, addressee_id, status, updated_at` | ✅ 互动边 + 好友通过奖励 |
| `posts` | `id, author_id, created_at` | ✅ join 解析 likes 接收方 |
| `likes` | `user_id, post_id, created_at` | ✅ 边 + 点赞奖励 |
| `comments` | `user_id, post_id, content, created_at` | ✅ 边 + 评论回复奖励 |
| `risk_events` | `user_id, rule_code, score_delta, reason, evidence, mode, created_at` | ✅ 双写 + 归档源 |
| `account_clusters` | `cluster_type, member_ids[], status, evidence` | ✅ 写孤岛簇 + 同簇过滤查 |
| `ban_records` | `target_type, target_id, expires_at, revoked_at, revoked_by, revoke_reason` | ✅ expireBans 扫描 |
| `appeals` | `user_id, status, ban_record_id, ...` | ✅ admin UI 处理 |
| `risk_rules` | `code, enabled, score, params (含 dedup_mode)` | ✅ 孤岛簇规则触发用 |
| `system_config` | `appeals_enabled, score_decay_factor, new_account_protection_days, risk_enforcement_mode` | ✅ 全部读 |

### 2.2 已有服务层

```
server/src/services/
├── enforcement/
│   ├── applyEnforcement.js     ← 闭环已 OK，cron 调它做状态回退
│   ├── banRecord.js
│   └── shadowBan.js
├── cluster/
│   ├── fingerprintCluster.js
│   ├── ipCluster.js
│   └── index.js                ← 复用，扩展 isInSameCluster()
├── appeals/
│   └── appealService.js        ← 已 OK，仅靠 system_config 切换
├── riskEngine/
│   ├── index.js
│   ├── ruleCache.js            ← cron 也用它读 rule.params
│   ├── scoreStore.js           ← cron 调 recordEvent 加分/减分
│   └── dedupDecay.js
├── config/systemConfig.js      ← 读 enforce 模式 / 衰减系数
├── whitelist/emailDomains.js
└── (新增 4 个：见 §3.1)
```

### 2.3 已有 cron（infrastructure）

```
server/src/cron/
├── index.js                    ← scheduleTask + startCron + stopCron 已就绪
├── ipBurstCheck.js
└── updateAccountCounts.js
```

### 2.4 已有路由 / 中间件

- `server/src/middleware/riskEnforcer.js`：拦截 frozen/banned 请求
- `server/src/routes/posts.js`、`friends.js`、`messages.js` 已被 Phase 3 改造接入 enforcer
- `server/src/routes/appeals.js`：用户提交 + 历史，已存在
- `server/admin/index.html`：单文件后台，已含 risk-rules / clusters / bulk-ban 三个 tab

### 2.5 现有 `users` 字段无 `last_login_at`

→ Phase 4 用 **`user_ips.last_seen_at` 取 MAX** 反推用户活跃（user_ips 在每次关键动作 phase2 已更新）。
**不**新增 `users.last_login_at` 字段（避免动 schema）。

---

## 3. 文件改动清单

### 3.1 新增文件

```
server/src/services/
├── decay/
│   ├── timeDecay.js              # 时间衰减核心（每日 cron 调）
│   └── positiveReward.js         # tryAddReward + 4 个事件触发函数
├── archive/
│   └── archiveRiskEvents.js      # 归档 90 天前事件
├── cluster/
│   ├── isolatedIslandDetect.js   # 孤岛簇主算法
│   ├── interactionGraph.js       # 收集互动边 + 连通子图
│   └── sameCluster.js            # isInSameCluster(userA, userB)
└── enforcement/
    └── expireBans.js             # 扫 ban_records.expires_at 做自动解封

server/src/cron/
├── isolatedIslandDetect.js       # 每小时 0 分
├── decayRiskScore.js             # 每日 02:00
├── dailyRewardWeeklyActive.js    # 每日 03:30
├── expireBans.js                 # 每日 04:30
└── archiveRiskEvents.js          # 每周日 04:00

database/migrations/
└── anti_abuse_phase4.sql         # risk_score_decay_log + risk_events_archive
                                  # + 2 个 RPC (list_new_user_likes / list_new_user_comments)
                                  # + UPDATE system_config SET appeals_enabled=true

server/tests/anti-abuse/phase4/
├── unit/
│   ├── timeDecay.test.js
│   ├── positiveReward.test.js
│   ├── isolatedIslandDetect.test.js
│   ├── sameCluster.test.js
│   ├── expireBans.test.js
│   └── archiveRiskEvents.test.js
└── integration/
    ├── decayCron.test.js
    └── rewardCron.test.js

docs/anti-abuse/
└── phase4-MANUAL-TEST.md         # 手动测试清单
```

### 3.2 修改文件

```
server/src/cron/index.js          # 注册 5 个新 cron
server/src/routes/likes.js        # POST 成功后异步触发陌生人点赞奖励
server/src/routes/comments.js     # POST 成功后异步触发"作者被回复"奖励
server/src/routes/friends.js      # PUT accept 成功后异步触发申请方奖励
server/admin/index.html           # 加 Appeals tab + 处理 UI
server/src/routes/admin/appeals.js # 已存在 listPending；新增 PUT /:id/resolve（如未实现）
```

> **不动**：`riskEngine/index.js`、`scoreStore.js`、`applyEnforcement.js`（Phase 3 已闭环）、`ruleCache.js`。

---

## 4. 数据库迁移：`anti_abuse_phase4.sql`

### 4.1 `risk_score_decay_log` 表

```sql
CREATE TABLE IF NOT EXISTS risk_score_decay_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  before_score INT NOT NULL,
  after_score INT NOT NULL,
  decay_type VARCHAR(40) NOT NULL,
  -- 取值：
  -- 'time_decay'
  -- 'reward_weekly_active'
  -- 'reward_post_liked_by_stranger'
  -- 'reward_comment_replied'
  -- 'reward_friend_accepted'
  -- 'reward_appeal_approve'  (Phase 3 已写)
  metadata JSONB DEFAULT '{}',  -- 例如 { post_id, comment_id, days_since_event }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decay_log_user
  ON risk_score_decay_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decay_log_type
  ON risk_score_decay_log(decay_type, created_at DESC);
```

### 4.2 `risk_events_archive` 表

```sql
CREATE TABLE IF NOT EXISTS risk_events_archive (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,  -- 不加 FK 防止 user 删除时归档丢失
  rule_code VARCHAR(50) NOT NULL,
  score_delta INT NOT NULL,
  reason VARCHAR(30) NOT NULL,
  evidence JSONB,
  mode VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_archive_user
  ON risk_events_archive(user_id, created_at DESC);
```

### 4.3 RPC：`list_new_user_likes(p_user_ids uuid[], p_since timestamptz)`

返回 `(actor_id uuid, target_id uuid)`：actor 是新用户中点赞者、target 是新用户中被赞帖子作者。

```sql
CREATE OR REPLACE FUNCTION list_new_user_likes(
  p_user_ids UUID[],
  p_since TIMESTAMPTZ
) RETURNS TABLE (actor_id UUID, target_id UUID) AS $$
  SELECT l.user_id AS actor_id, p.author_id AS target_id
  FROM likes l
  JOIN posts p ON p.id = l.post_id
  WHERE l.user_id = ANY(p_user_ids)
    AND p.author_id = ANY(p_user_ids)
    AND l.user_id <> p.author_id
    AND l.created_at >= p_since;
$$ LANGUAGE SQL STABLE;
```

### 4.4 RPC：`list_new_user_comments(p_user_ids uuid[], p_since timestamptz)`

```sql
CREATE OR REPLACE FUNCTION list_new_user_comments(
  p_user_ids UUID[],
  p_since TIMESTAMPTZ
) RETURNS TABLE (actor_id UUID, target_id UUID) AS $$
  SELECT c.user_id AS actor_id, p.author_id AS target_id
  FROM comments c
  JOIN posts p ON p.id = c.post_id
  WHERE c.user_id = ANY(p_user_ids)
    AND p.author_id = ANY(p_user_ids)
    AND c.user_id <> p.author_id
    AND c.created_at >= p_since;
$$ LANGUAGE SQL STABLE;
```

### 4.5 RPC：`list_user_recent_active(p_since timestamptz)`（用于 weekly_active）

返回 `last_seen_at >= since` 的用户 ids。

```sql
CREATE OR REPLACE FUNCTION list_recent_active_users(p_since TIMESTAMPTZ)
RETURNS TABLE (user_id UUID, last_seen_at TIMESTAMPTZ) AS $$
  SELECT ui.user_id, MAX(ui.last_seen_at) AS last_seen_at
  FROM user_ips ui
  WHERE ui.last_seen_at >= p_since
  GROUP BY ui.user_id;
$$ LANGUAGE SQL STABLE;
```

### 4.6 启用申诉

```sql
UPDATE system_config SET value = 'true'::jsonb, updated_at = NOW()
  WHERE key = 'appeals_enabled';
```

### 4.7 回滚（注释 in-file）

```sql
-- ROLLBACK:
-- DROP FUNCTION IF EXISTS list_new_user_likes(UUID[], TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS list_new_user_comments(UUID[], TIMESTAMPTZ);
-- DROP FUNCTION IF EXISTS list_recent_active_users(TIMESTAMPTZ);
-- UPDATE system_config SET value='false'::jsonb WHERE key='appeals_enabled';
-- DROP TABLE IF EXISTS risk_events_archive;
-- DROP TABLE IF EXISTS risk_score_decay_log;
```

---

## 5. 服务层实现细节

### 5.1 `services/cluster/sameCluster.js`

```js
// 复用 account_clusters 表，过滤掉 cleared / ignored 状态
const supabase = require('../../config/supabase');

const ACTIVE_STATES = ['pending', 'reviewed', 'banned'];

async function isInSameCluster(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const { data, error } = await supabase
    .from('account_clusters')
    .select('id, member_ids')
    .in('status', ACTIVE_STATES)
    .contains('member_ids', [userIdA])
    .limit(50);
  if (error || !data) return false;
  return data.some(c => Array.isArray(c.member_ids) && c.member_ids.includes(userIdB));
}

module.exports = { isInSameCluster };
```

### 5.2 `services/cluster/interactionGraph.js`

```js
// 收集新用户集合内的互动边（无向去重）+ 构图 + 找连通子图（BFS）
const supabase = require('../../config/supabase');

async function collectInteractionEdges(newUserIds, sinceIso) {
  if (newUserIds.length < 2) return [];

  // 1. friendships accepted（双向）
  const { data: frs } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id')
    .in('requester_id', newUserIds)
    .in('addressee_id', newUserIds)
    .eq('status', 'accepted');

  // 2. likes 经 RPC
  const { data: lks } = await supabase.rpc('list_new_user_likes', {
    p_user_ids: newUserIds, p_since: sinceIso,
  });

  // 3. comments 经 RPC
  const { data: cms } = await supabase.rpc('list_new_user_comments', {
    p_user_ids: newUserIds, p_since: sinceIso,
  });

  const raw = [
    ...(frs || []).map(e => [e.requester_id, e.addressee_id]),
    ...(lks || []).map(e => [e.actor_id, e.target_id]),
    ...(cms || []).map(e => [e.actor_id, e.target_id]),
  ];

  // 无向去重：[a,b] → key = `${min}-${max}`
  const set = new Set();
  for (const [a, b] of raw) {
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    set.add(key);
  }
  return Array.from(set).map(k => k.split('|'));
}

function buildAdjacency(userIds, edges) {
  const adj = new Map();
  for (const u of userIds) adj.set(u, new Set());
  for (const [a, b] of edges) {
    if (adj.has(a) && adj.has(b)) {
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  }
  return adj;
}

function findConnectedComponents(adj) {
  const visited = new Set();
  const components = [];
  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const comp = new Set();
    const queue = [node];
    while (queue.length) {
      const n = queue.shift();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.add(n);
      for (const nb of adj.get(n) || []) if (!visited.has(nb)) queue.push(nb);
    }
    components.push(comp);
  }
  return components;
}

function computeClusterStats(component, edges, allEdgesAcrossNewUsers) {
  // edges 已经是无向去重；这里用全集（含 component 与外部）来算外部互动
  const members = new Set(component);
  let internal = 0;
  const externalCountByUser = {};
  for (const [a, b] of allEdgesAcrossNewUsers) {
    const aIn = members.has(a);
    const bIn = members.has(b);
    if (aIn && bIn) internal++;
    else if (aIn) externalCountByUser[a] = (externalCountByUser[a] || 0) + 1;
    else if (bIn) externalCountByUser[b] = (externalCountByUser[b] || 0) + 1;
  }
  const possibleInternal = members.size * (members.size - 1) / 2;
  const internalRate = possibleInternal > 0 ? internal / possibleInternal : 0;
  const maxExternal = Object.values(externalCountByUser).reduce((m, v) => Math.max(m, v), 0);
  return { size: members.size, internal, internalRate, maxExternal };
}

module.exports = {
  collectInteractionEdges,
  buildAdjacency,
  findConnectedComponents,
  computeClusterStats,
};
```

### 5.3 `services/cluster/isolatedIslandDetect.js`

```js
const supabase = require('../../config/supabase');
const { getRules } = require('../riskEngine/ruleCache');
const { computeAppliedDelta } = require('../riskEngine/dedupDecay');
const { recordEvent } = require('../riskEngine/scoreStore');
const {
  collectInteractionEdges, buildAdjacency,
  findConnectedComponents, computeClusterStats,
} = require('./interactionGraph');

async function detect() {
  const rules = await getRules();
  const rule = rules.find(r => r.code === 'ISOLATED_ISLAND');
  if (!rule || !rule.enabled) return { skipped: true, reason: 'disabled' };

  const params = rule.params || {};
  const internalRateThreshold = params.internal_rate_threshold ?? 0.6;
  const externalMaxPerUser = params.external_max_per_user ?? 3;
  const newDays = params.new_days ?? 7;
  const minSize = params.min_cluster_size ?? 3;

  const since = new Date(Date.now() - newDays * 86400 * 1000);
  const sinceIso = since.toISOString();

  // 1. 拿新用户
  const { data: newUsers } = await supabase
    .from('users').select('id').gte('created_at', sinceIso);
  const newUserIds = (newUsers || []).map(u => u.id);
  if (newUserIds.length < minSize) {
    return { skipped: true, reason: 'too_few_new_users', count: newUserIds.length };
  }

  // 2. 收集边
  const edges = await collectInteractionEdges(newUserIds, sinceIso);
  if (edges.length === 0) return { skipped: true, reason: 'no_edges' };

  // 3. 找连通子图
  const adj = buildAdjacency(newUserIds, edges);
  const components = findConnectedComponents(adj).filter(c => c.size >= minSize);

  // 4. 验证阈值 + 写入
  const result = { detectedClusters: 0, addedScores: 0 };
  for (const comp of components) {
    const stats = computeClusterStats(comp, edges, edges);
    if (stats.internalRate < internalRateThreshold) continue;
    if (stats.maxExternal >= externalMaxPerUser) continue;

    // 去重：member_ids 完全一致的 24h 内 cluster 不重复写
    const memberArr = Array.from(comp).sort();
    const { data: existing } = await supabase
      .from('account_clusters')
      .select('id')
      .eq('cluster_type', 'isolated_island')
      .gte('created_at', new Date(Date.now() - 86400000).toISOString())
      .contains('member_ids', memberArr)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const { data: cluster } = await supabase.from('account_clusters').insert({
      cluster_type: 'isolated_island',
      member_ids: memberArr,
      suspicion_score: Math.min(100, Math.floor(stats.internalRate * 100)),
      evidence: stats,
      status: 'pending',
    }).select('id').single();

    result.detectedClusters++;

    // 5. 给每个成员触发 ISOLATED_ISLAND 规则加分（走 dedup→recordEvent）
    for (const uid of comp) {
      const delta = await computeAppliedDelta(uid, rule);
      if (delta <= 0) continue;
      const r = await recordEvent({
        userId: uid,
        ruleCode: 'ISOLATED_ISLAND',
        scoreDelta: delta,
        reason: 'rule_trigger',
        evidence: { cluster_id: cluster?.id, ...stats },
      });
      if (r && r.applied) result.addedScores += delta;
    }
  }

  return result;
}

module.exports = { detect };
```

### 5.4 `services/decay/timeDecay.js`

```js
const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');
const { applyEnforcement } = require('../enforcement/applyEnforcement');

const DAY_MS = 86400000;
const PAGE = 500;

async function runDecay(now = new Date()) {
  const decayFactor = parseFloat(await getSystemConfig('score_decay_factor', 0.9)) || 0.9;
  const protectionDays = parseInt(await getSystemConfig('new_account_protection_days', 7), 10) || 7;

  const summary = { scanned: 0, decayed: 0, errors: 0 };
  let offset = 0;

  while (true) {
    const { data: page, error } = await supabase
      .from('users')
      .select('id, email, status, risk_score, created_at, last_risk_event_at, restricted_until, is_shadow_banned, shadow_ban_until')
      .gt('risk_score', 0)
      .neq('status', 'banned')           // Q10/Q2: 跳过已封禁
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) { summary.errors++; break; }
    if (!page || page.length === 0) break;

    summary.scanned += page.length;
    for (const u of page) {
      const lastEvent = u.last_risk_event_at
        ? new Date(u.last_risk_event_at)
        : new Date(u.created_at);
      const daysSinceEvent = (now.getTime() - lastEvent.getTime()) / DAY_MS;
      if (daysSinceEvent < 7) continue;

      const regDays = (now.getTime() - new Date(u.created_at).getTime()) / DAY_MS;
      let factor = decayFactor;
      if (regDays < protectionDays) {
        factor = 1 - (1 - decayFactor) * 0.3;  // 0.9 → 0.97
      }
      const newScore = Math.floor(u.risk_score * factor);
      if (newScore >= u.risk_score) continue;

      try {
        const delta = newScore - u.risk_score;  // 负数
        await supabase.from('users').update({
          risk_score: newScore,
          last_risk_event_at: now.toISOString(),
        }).eq('id', u.id);

        // 双写
        await supabase.from('risk_events').insert({
          user_id: u.id,
          rule_code: 'TIME_DECAY',
          score_delta: delta,
          reason: 'decay',
          evidence: { factor, days_since_event: Math.floor(daysSinceEvent) },
          mode: 'enforce',
        });
        await supabase.from('risk_score_decay_log').insert({
          user_id: u.id,
          before_score: u.risk_score,
          after_score: newScore,
          decay_type: 'time_decay',
          metadata: { factor, days_since_event: Math.floor(daysSinceEvent) },
        });

        // 状态自动回退（observe 模式 applyEnforcement 内部会跳过修改）
        await applyEnforcement({ ...u, risk_score: newScore });
        summary.decayed++;
      } catch (err) {
        console.warn('[timeDecay] user', u.id, 'failed:', err && err.message);
        summary.errors++;
      }
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return summary;
}

module.exports = { runDecay };
```

### 5.5 `services/decay/positiveReward.js`

```js
// 4 个事件式触发函数 + tryAddReward 统一入口
const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');
const { isInSameCluster } = require('../cluster/sameCluster');
const { applyEnforcement } = require('../enforcement/applyEnforcement');

let redisClient = null;
try { redisClient = require('../cache/upstash'); } catch (_) { /* 可能不存在 */ }

const DAY_MS = 86400000;

async function checkCooldown(key, ttlSec) {
  if (redisClient && typeof redisClient.set === 'function') {
    try {
      const ok = await redisClient.set(key, '1', { nx: true, ex: ttlSec });
      return !!ok;
    } catch (_) { /* fallback */ }
  }
  // Fallback: 查 risk_score_decay_log 是否有 metadata.cooldown_key=key 在 ttl 内
  const since = new Date(Date.now() - ttlSec * 1000).toISOString();
  const { count } = await supabase
    .from('risk_score_decay_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .filter('metadata->>cooldown_key', 'eq', key);
  return (count || 0) === 0;
}

/**
 * @param userId 受奖励用户
 * @param decayType see migrations 5.1
 * @param baseDelta 负数（如 -3）
 * @param opts { cooldownKey, cooldownSec, metadata }
 */
async function tryAddReward(userId, decayType, baseDelta, opts = {}) {
  if (baseDelta >= 0) return { skipped: true, reason: 'invalid_delta' };

  const { cooldownKey, cooldownSec = 86400, metadata = {} } = opts;
  if (cooldownKey) {
    const ok = await checkCooldown(cooldownKey, cooldownSec);
    if (!ok) return { skipped: true, reason: 'cooldown' };
  }

  const { data: user } = await supabase
    .from('users').select('id, status, risk_score, created_at')
    .eq('id', userId).maybeSingle();
  if (!user) return { skipped: true, reason: 'user_not_found' };
  if (user.status === 'banned') return { skipped: true, reason: 'banned' };
  if ((user.risk_score || 0) <= 0) return { skipped: true, reason: 'no_score_to_reduce' };

  const protectionDays = parseInt(await getSystemConfig('new_account_protection_days', 7), 10) || 7;
  const regDays = (Date.now() - new Date(user.created_at).getTime()) / DAY_MS;
  let effective = baseDelta;
  if (regDays < protectionDays) effective = Math.ceil(baseDelta * 0.3);
  if (effective >= 0) return { skipped: true, reason: 'rounded_to_zero' };

  const newScore = Math.max(0, user.risk_score + effective);
  await supabase.from('users').update({
    risk_score: newScore,
    last_risk_event_at: new Date().toISOString(),
  }).eq('id', userId);

  await supabase.from('risk_events').insert({
    user_id: userId,
    rule_code: decayType.toUpperCase(),
    score_delta: effective,
    reason: 'reward',
    evidence: { ...metadata, base_delta: baseDelta },
    mode: 'enforce',
  });
  await supabase.from('risk_score_decay_log').insert({
    user_id: userId,
    before_score: user.risk_score,
    after_score: newScore,
    decay_type: decayType,
    metadata: { ...metadata, cooldown_key: cooldownKey },
  });
  await applyEnforcement({ ...user, risk_score: newScore });

  return { applied: true, scoreDelta: effective, newScore };
}

// 4 个触发点 helper
async function rewardPostLikedByStranger({ postId, authorId, likerId }) {
  if (!authorId || !likerId || authorId === likerId) return { skipped: true };
  if (await isInSameCluster(authorId, likerId)) return { skipped: true, reason: 'same_cluster' };
  return tryAddReward(authorId, 'reward_post_liked_by_stranger', -3, {
    cooldownKey: `reward:post:${postId}`,
    cooldownSec: 365 * 86400,  // 每帖只算一次
    metadata: { post_id: postId, liker_id: likerId },
  });
}

async function rewardCommentReplied({ authorId, replierId, postId, commentId }) {
  if (!authorId || !replierId || authorId === replierId) return { skipped: true };
  if (await isInSameCluster(authorId, replierId)) return { skipped: true, reason: 'same_cluster' };
  return tryAddReward(authorId, 'reward_comment_replied', -2, {
    cooldownKey: `reward:reply:${authorId}:${new Date().toISOString().slice(0,10)}`,  // 每天 1 次
    cooldownSec: 86400,
    metadata: { post_id: postId, comment_id: commentId, replier_id: replierId },
  });
}

async function rewardFriendAccepted({ requesterId, addresseeId }) {
  if (!requesterId || !addresseeId || requesterId === addresseeId) return { skipped: true };
  if (await isInSameCluster(requesterId, addresseeId)) return { skipped: true, reason: 'same_cluster' };
  return tryAddReward(requesterId, 'reward_friend_accepted', -3, {
    cooldownKey: `reward:friend:${requesterId}:${new Date().toISOString().slice(0,10)}`,
    cooldownSec: 86400,
    metadata: { addressee_id: addresseeId },
  });
}

async function rewardWeeklyActiveClean(userId) {
  return tryAddReward(userId, 'reward_weekly_active', -5, {
    cooldownKey: `reward:weekly:${userId}`,
    cooldownSec: 7 * 86400,
    metadata: {},
  });
}

module.exports = {
  tryAddReward,
  rewardPostLikedByStranger,
  rewardCommentReplied,
  rewardFriendAccepted,
  rewardWeeklyActiveClean,
};
```

### 5.6 `services/enforcement/expireBans.js`

```js
const supabase = require('../../config/supabase');

async function runExpireBans(now = new Date()) {
  const summary = { user: 0, fingerprint: 0, ip: 0, errors: 0 };
  const nowIso = now.toISOString();

  const { data: rows, error } = await supabase
    .from('ban_records')
    .select('id, target_type, target_id, expires_at')
    .lte('expires_at', nowIso)
    .is('revoked_at', null);
  if (error) { summary.errors++; return summary; }

  for (const r of rows || []) {
    try {
      await supabase.from('ban_records').update({
        revoked_at: nowIso, revoke_reason: 'auto_expired',
      }).eq('id', r.id);

      if (r.target_type === 'user') {
        // 注意：用户级永久封 expires_at 一般为 NULL，到期解封通常是临时降权
        // 仅当 users.status='banned' 时尝试恢复
        const { data: u } = await supabase.from('users')
          .select('id, status, risk_score').eq('id', r.target_id).maybeSingle();
        if (u && u.status === 'banned' && (u.risk_score || 0) < 85) {
          await supabase.from('users').update({ status: 'active' }).eq('id', r.target_id);
        }
        summary.user++;
      } else if (r.target_type === 'fingerprint') {
        await supabase.from('fingerprints').update({
          is_banned: false, banned_until: null,
        }).eq('id', r.target_id);
        summary.fingerprint++;
      } else if (r.target_type === 'ip') {
        await supabase.from('ip_records').update({
          is_banned: false, banned_until: null,
        }).eq('ip_address', r.target_id);
        summary.ip++;
      }
    } catch (e) {
      summary.errors++;
      console.warn('[expireBans] failed', r.id, e && e.message);
    }
  }
  return summary;
}

module.exports = { runExpireBans };
```

### 5.7 `services/archive/archiveRiskEvents.js`

```js
const supabase = require('../../config/supabase');

async function runArchive(daysOld = 90, batchSize = 500) {
  const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
  const summary = { copied: 0, deleted: 0, batches: 0, errors: 0 };

  while (true) {
    const { data: batch, error: readErr } = await supabase
      .from('risk_events')
      .select('id, user_id, rule_code, score_delta, reason, evidence, mode, created_at')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(batchSize);
    if (readErr) { summary.errors++; break; }
    if (!batch || batch.length === 0) break;

    const archiveRows = batch.map(r => ({ ...r, archived_at: new Date().toISOString() }));
    const { error: insErr } = await supabase.from('risk_events_archive').insert(archiveRows);
    if (insErr) { summary.errors++; break; }
    summary.copied += archiveRows.length;

    const ids = batch.map(b => b.id);
    const { error: delErr } = await supabase.from('risk_events').delete().in('id', ids);
    if (delErr) { summary.errors++; break; }
    summary.deleted += ids.length;
    summary.batches++;
    if (batch.length < batchSize) break;
  }
  return summary;
}

module.exports = { runArchive };
```

---

## 6. Cron 注册（修改 `server/src/cron/index.js`）

在现有 `startCron()` 内追加：

```js
const { detect: detectIslands } = require('../services/cluster/isolatedIslandDetect');
const { runDecay } = require('../services/decay/timeDecay');
const { runExpireBans } = require('../services/enforcement/expireBans');
const { runArchive } = require('../services/archive/archiveRiskEvents');
const { rewardWeeklyActiveClean } = require('../services/decay/positiveReward');
const supabase = require('../config/supabase');

// 孤岛簇 每小时
scheduleTask('0 * * * *', 'isolatedIslandDetect', () => detectIslands());

// 时间衰减 每日 02:00
scheduleTask('0 2 * * *', 'decayRiskScore', () => runDecay());

// daily reward (weekly_active_clean) 每日 03:30
scheduleTask('30 3 * * *', 'dailyRewardWeeklyActive', async () => {
  // 通过 RPC 拿近 7 天活跃用户
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data: actives } = await supabase.rpc('list_recent_active_users', { p_since: since });
  let applied = 0;
  for (const a of actives || []) {
    // 7 天内 rule_trigger 累计 score_delta < 10（Q19 B）
    const { data: events } = await supabase
      .from('risk_events').select('score_delta')
      .eq('user_id', a.user_id).eq('reason', 'rule_trigger').gte('created_at', since);
    const total = (events || []).reduce((s, e) => s + (e.score_delta || 0), 0);
    if (total >= 10) continue;
    const r = await rewardWeeklyActiveClean(a.user_id);
    if (r && r.applied) applied++;
  }
  console.log(`[cron:dailyRewardWeeklyActive] rewarded=${applied} active=${(actives||[]).length}`);
});

// 过期封禁清理 每日 04:30
scheduleTask('30 4 * * *', 'expireBans', () => runExpireBans());

// risk_events 归档 每周日 04:00
scheduleTask('0 4 * * 0', 'archiveRiskEvents', () => runArchive(90));
```

---

## 7. 路由 hook 改动

### 7.1 `server/src/routes/likes.js`

POST 成功创建 like 后，**异步**触发奖励（不阻塞响应）：

```js
const { rewardPostLikedByStranger } = require('../services/decay/positiveReward');

// 在 POST /api/posts/:id/likes 创建成功后：
setImmediate(async () => {
  try {
    await rewardPostLikedByStranger({
      postId: post.id,
      authorId: post.author_id,
      likerId: req.user.id,
    });
  } catch (e) {
    console.warn('[reward] post liked failed:', e && e.message);
  }
});
```

### 7.2 `server/src/routes/comments.js`

POST 成功创建 comment 后：

```js
const { rewardCommentReplied } = require('../services/decay/positiveReward');

setImmediate(async () => {
  try {
    await rewardCommentReplied({
      authorId: post.author_id,        // 帖子作者收到回复
      replierId: req.user.id,
      postId: post.id,
      commentId: created.id,
    });
  } catch (e) { console.warn('[reward] comment replied failed:', e && e.message); }
});
```

### 7.3 `server/src/routes/friends.js`

PUT accept 接受好友申请成功后：

```js
const { rewardFriendAccepted } = require('../services/decay/positiveReward');

setImmediate(async () => {
  try {
    await rewardFriendAccepted({
      requesterId: friendship.requester_id,
      addresseeId: friendship.addressee_id,
    });
  } catch (e) { console.warn('[reward] friend accepted failed:', e && e.message); }
});
```

---

## 8. 管理员申诉处理 UI（`server/admin/index.html`）

### 8.1 加 Appeals tab

在 `<nav>` 标签栏后面追加按钮：
```html
<button data-tab="appeals">申诉处理</button>
```

新增 tab 容器：
```html
<section id="tab-appeals" class="tab-pane" hidden>
  <h2>申诉处理</h2>
  <div class="filters">
    <select id="appeal-status-filter">
      <option value="pending">待处理</option>
      <option value="approved">已通过</option>
      <option value="rejected">已拒绝</option>
    </select>
    <button id="appeal-refresh">刷新</button>
  </div>
  <table id="appeal-list">
    <thead><tr>
      <th>提交时间</th><th>用户</th><th>邮箱</th><th>当前分</th>
      <th>当前状态</th><th>原因</th><th>证据</th><th>操作</th>
    </tr></thead>
    <tbody></tbody>
  </table>
</section>
```

### 8.2 JS 处理逻辑（同文件 `<script>` 内）

```js
async function loadAppeals(status = 'pending') {
  const r = await fetch(`/api/admin/appeals?status=${status}`, { credentials: 'include' });
  const data = await r.json();
  renderAppealRows(data.appeals || []);
}

function renderAppealRows(rows) {
  const tbody = document.querySelector('#appeal-list tbody');
  tbody.innerHTML = '';
  for (const a of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(a.created_at).toLocaleString()}</td>
      <td>${a.user_nickname || a.user_id}</td>
      <td>${a.contact_email}</td>
      <td>${a.user_risk_score ?? '-'}</td>
      <td>${a.user_status ?? '-'}</td>
      <td><div class="reason">${escapeHtml(a.reason)}</div></td>
      <td>${(a.evidence_urls || []).map(u => `<a href="${u}" target="_blank">链接</a>`).join('<br>')}</td>
      <td>
        ${a.status === 'pending' ? `
          <button data-action="approve" data-id="${a.id}">通过</button>
          <button data-action="reject" data-id="${a.id}">拒绝</button>
        ` : a.status}
      </td>`;
    tbody.appendChild(tr);
  }
}

document.querySelector('#appeal-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const note = prompt(action === 'approve' ? '通过备注（可空）' : '拒绝原因');
  if (note === null) return;
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  const r = await fetch(`/api/admin/appeals/${id}/resolve`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus, note }),
  });
  if (r.ok) {
    alert(action === 'approve' ? '已通过（用户 -30 分 + 解封）' : '已拒绝');
    loadAppeals(document.querySelector('#appeal-status-filter').value);
  } else {
    const err = await r.json().catch(() => ({}));
    alert('失败：' + (err.message || r.status));
  }
});

document.querySelector('#appeal-status-filter').addEventListener('change', (e) => loadAppeals(e.target.value));
document.querySelector('#appeal-refresh').addEventListener('click', () => {
  loadAppeals(document.querySelector('#appeal-status-filter').value);
});
```

### 8.3 后端路由 `server/src/routes/admin/appeals.js`

补充（如果还没实现）：
```js
// GET /api/admin/appeals?status=pending|approved|rejected
// 返回带 user.nickname / user.risk_score / user.status 的 join 数据
router.get('/', adminOnly, async (req, res) => {
  const status = req.query.status || 'pending';
  const { data, error } = await supabase
    .from('appeals')
    .select('*, user:users(nickname, risk_score, status)')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const appeals = (data || []).map(a => ({
    ...a,
    user_nickname: a.user?.nickname,
    user_risk_score: a.user?.risk_score,
    user_status: a.user?.status,
  }));
  res.json({ appeals });
});

// PUT /api/admin/appeals/:id/resolve
router.put('/:id/resolve', adminOnly, async (req, res) => {
  try {
    const updated = await resolveAppeal(req.params.id, req.user.id, req.body.status, req.body.note);
    res.json({ success: true, appeal: updated });
  } catch (e) {
    res.status(e.status || 500).json({ code: e.code, message: e.message });
  }
});
```

---

## 9. 测试计划

### 9.1 单元测试（Jest，mock supabase）

- `timeDecay.test.js`：
  - risk_score=50, last_event=10 天前 → 衰减为 45
  - 新号（regDays<7）+ 50 → 48 (factor=0.97 floor)
  - status='banned' 跳过
  - last_event<7 天跳过
  - risk_score=0 不入扫描

- `positiveReward.test.js`：
  - tryAddReward 冷却命中 → skipped
  - 同簇 → skipped (rewardPostLikedByStranger)
  - 新号保护期 -3 → ceil(-3*0.3)=-1
  - 新号 -2 → ceil(-2*0.3)=0 → rounded_to_zero
  - banned 用户 → skipped
  - applied=true 时调 applyEnforcement

- `isolatedIslandDetect.test.js`：
  - 3 个新号互关满（3 条边）→ internalRate=1.0 → 识别为孤岛
  - 任一成员有外部互动 ≥3 → 不识别
  - <3 人不识别
  - 24h 内同 member_ids 不重复写

- `sameCluster.test.js`：
  - 双方在同 cluster pending → true
  - cluster status=cleared → false
  - 任一不在任何 cluster → false

- `expireBans.test.js`：
  - fingerprint 过期 → is_banned=false
  - ip 过期 → is_banned=false
  - user 到期且 risk_score<85 → status=active；risk_score>=85 不解封

- `archiveRiskEvents.test.js`：
  - 90+ 天事件被复制到 archive + 从 risk_events 删除
  - <90 天事件不动

### 9.2 集成测试

- `decayCron.test.js`：
  - 造 5 个不同状态用户跑完 runDecay() → 分数符合预期
  - banned 用户分数不变
  - 触发 applyEnforcement 让 frozen 用户回 active

- `rewardCron.test.js`：
  - 准备活跃用户 + 无规则触发 → daily cron 跑完 -5
  - 准备活跃用户 + 7 天累计 score_delta>=10 → 不奖励

### 9.3 手动测试清单 → 写入 `docs/anti-abuse/phase4-MANUAL-TEST.md`

完整 11 项测试，VPS 上跑：

1. 孤岛簇：5 个新账号互关互赞 → cron 跑完 → `account_clusters` 有 isolated_island 记录 + 每成员 risk_score +10
2. 时间衰减（普通）：手动 SET risk_score=50, last_risk_event_at=10 天前 → 02:00 cron → 查变 45
3. 时间衰减（新号）：注册<7 天 + risk_score=50 → 衰减后 48
4. 时间衰减（banned 跳过）：status=banned + risk_score=90 → cron 后不变
5. 陌生人点赞奖励：A risk_score=20，B 非簇内点赞 A 帖 → A 变 17（同帖 C 再点赞不再减）
6. 同簇过滤：A B 同簇 → A 帖 B 点赞 → A 不减分
7. 评论被回复奖励：A 发帖 B 评论 → A 减 2 分（同日再回不减）
8. 好友通过奖励：A 申请加 B，B 通过 → A -3 分
9. weekly_active 奖励：mock 7 天活跃且无违规用户 → daily cron -5
10. 申诉热启用：appeals_enabled=true 后用户提 → admin 后台看到 → 通过 → 用户 -30 + 解封
11. 归档：mock 90+ 天 risk_events → 周日 cron 后移到 archive 表

### 9.4 回归

- Phase 1/2/3 全部测试 `npm run test:abuse:phase1` `phase2` `phase3` 均通过
- 部署后 PM2 logs 无错误 / cron 启动日志正确

### 9.5 测试运行命令

```bash
cd server
npm test -- tests/anti-abuse/phase4
# 或
npm run test:abuse:phase4   # 如有 script
```

---

## 10. 部署流程

### 10.1 步骤

1. **本地完成代码 + 测试通过**
2. **commit**：`git add -A && git commit -m "feat(anti-abuse-phase4): clustering + decay + rewards + appeals live"`
3. **跑 supabase migration**：`mcp__supabase__apply_migration` 跑 `anti_abuse_phase4` 内容
4. **部署 VPS**：`./deploy-to-vps.sh`
5. **VPS 重启**：`ssh ... 'sudo pm2 restart hit-circle'`
6. **验证 cron 启动日志**：`pm2 logs hit-circle | grep cron` 应看到 `[cron] 8 tasks scheduled`
7. **跑手动测试清单**

### 10.2 上线后第一周观察指标

每天早 9 点查：
```sql
SELECT decay_type, COUNT(*) FROM risk_score_decay_log
  WHERE created_at > NOW() - INTERVAL '24h' GROUP BY decay_type;
SELECT cluster_type, status, COUNT(*) FROM account_clusters
  WHERE created_at > NOW() - INTERVAL '24h' GROUP BY cluster_type, status;
SELECT status, COUNT(*) FROM appeals GROUP BY status;
```

---

## 11. 回滚方案

- **代码**：`git revert <commit>` + 重新部署
- **migration**：跑 `anti_abuse_phase4.sql` 末尾的 `-- ROLLBACK:` 注释 SQL
- **应急**：直接 `UPDATE system_config SET value='"observe"'::jsonb WHERE key='risk_enforcement_mode'` 切观察模式停所有自动执行
- **关申诉**：`UPDATE system_config SET value='false'::jsonb WHERE key='appeals_enabled'`

---

## 12. 完成判定

- [ ] 所有自动化测试通过（unit + integration ≥ 80% 覆盖）
- [ ] 手动清单 11 项全 ✅
- [ ] VPS PM2 重启后 `pm2 logs` 8 个 cron 全部 scheduled
- [ ] 上线 48 小时无 cron 报错（`pm2 logs hit-circle | grep ERROR`）
- [ ] 申诉链路端到端通跑（前端提交 → admin 处理 → 用户解封）
- [ ] commit 推送到 remote main 分支
- [ ] 通知用户 Phase 4 上线完毕，整个反滥用系统四阶段全部交付

---

**完成 Phase 4 后，[07-phase4-clustering-decay.md](./07-phase4-clustering-decay.md) 文档承诺已全部兑现。**
