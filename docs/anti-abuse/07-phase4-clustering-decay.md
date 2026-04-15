# 07 — Phase 4：聚类检测、衰减、奖励、申诉 UI 启用

> **工期预估**：3-4 天
> **目标**：完善长期治理能力——孤岛簇识别、风险分衰减、正向行为奖励、申诉 UI 热启用。
> **结束标志**：手动测试清单全通过，**整个反滥用系统上线完毕**。

---

## 1. 交付物

- **Cron：孤岛簇检测**（每小时）
- **Cron：风险分时间衰减**（每日）
- **Cron：正向行为奖励**（每小时触发式 + 每日汇总）
- **申诉功能热启用**：`appeals_enabled=true`
- **管理员处理申诉 UI**
- **风险事件归档**（90 天）
- **数据表**：risk_score_decay_log
- **测试**：单元 + 集成 + 手动清单
- **迁移脚本**：`database/migrations/anti_abuse_phase4.sql`

---

## 2. 前置准备

- [ ] `git checkout -b feat/anti-abuse-phase4`
- [ ] Phase 3 已运行至少 1 周，观察真实数据分布

---

## 3. 文件改动清单

### 3.1 新增文件

```
server/
├── src/
│   ├── services/
│   │   ├── cluster/
│   │   │   ├── isolatedIslandDetect.js    # 孤岛簇检测算法
│   │   │   └── interactionGraph.js        # 构建用户互动图
│   │   ├── decay/
│   │   │   ├── timeDecay.js               # 时间衰减
│   │   │   └── positiveReward.js          # 正向行为奖励
│   │   └── archive/
│   │       └── archiveRiskEvents.js       # 归档 90 天前的 risk_events
│   └── cron/
│       ├── isolatedIslandDetect.js        # 每小时
│       ├── decayRiskScore.js              # 每日凌晨 2 点
│       ├── positiveRewardDaily.js         # 每日
│       ├── expireBans.js                  # 每日清理过期 ban
│       └── archiveRiskEvents.js           # 每周
├── admin/
│   └── appeals/                           # 处理申诉 UI
database/migrations/
└── anti_abuse_phase4.sql                  # risk_score_decay_log 表

tests/
├── unit/
│   ├── cluster/
│   │   └── isolatedIslandDetect.test.js
│   ├── decay/
│   │   ├── timeDecay.test.js
│   │   └── positiveReward.test.js
└── integration/
    └── phase4-cron.test.js
```

### 3.2 修改文件

```
server/
├── src/
│   ├── routes/
│   │   ├── posts.js                       # 帖子被点赞 → 异步触发奖励（见 4.3）
│   │   ├── comments.js                    # 评论被回复 → 奖励
│   │   └── friendships.js                 # 好友申请被通过 → 奖励

supabase 或 manual：
└── system_config: appeals_enabled → true  # Phase 4 结束时切
```

---

## 4. 关键逻辑

### 4.1 孤岛簇检测（每小时 cron）

```js
// server/src/services/cluster/isolatedIslandDetect.js
const supabase = require('../../config/supabase');

/**
 * 孤岛簇判定条件：
 *   - 簇内账号全部 < 7 天注册
 *   - 簇内互动率 > 60%（互关/互赞/互评）
 *   - 簇外互动数 < 3 次/人
 *   - 簇大小 ≥ 3
 *
 * 算法：
 *   1. 拿近 7 天注册用户
 *   2. 构建邻接矩阵（边 = 有互动）
 *   3. 连通子图 → 候选簇
 *   4. 对每个簇验证四项阈值
 */
async function detect() {
  const rule = await getRule('ISOLATED_ISLAND');
  if (!rule?.enabled) return;
  const {
    internal_rate_threshold = 0.6,
    external_max_per_user = 3,
    new_days = 7,
    min_cluster_size = 3,
  } = rule.params;

  const sinceDate = new Date(Date.now() - new_days * 86400 * 1000).toISOString();

  // 1. 新用户
  const { data: newUsers } = await supabase
    .from('users').select('id').gte('created_at', sinceDate);
  const newUserIds = new Set(newUsers.map(u => u.id));
  if (newUserIds.size < min_cluster_size) return;

  // 2. 收集互动边（friendships accepted + likes + comments）
  const edges = await collectInteractionEdges(Array.from(newUserIds));

  // 3. 构图 + 连通子图
  const graph = buildGraph(newUserIds, edges);
  const components = findConnectedComponents(graph);

  // 4. 验证阈值
  for (const comp of components) {
    if (comp.size < min_cluster_size) continue;
    const stats = computeClusterStats(comp, edges, newUserIds);
    if (stats.internalRate > internal_rate_threshold &&
        stats.maxExternal < external_max_per_user) {
      // 写 account_clusters
      await supabase.from('account_clusters').insert({
        cluster_type: 'isolated_island',
        member_ids: Array.from(comp),
        suspicion_score: Math.min(100, Math.floor(stats.internalRate * 100)),
        evidence: stats,
        status: 'pending',
      });
      // 对每个成员触发 ISOLATED_ISLAND 规则加分
      for (const uid of comp) {
        await evaluateRule('ISOLATED_ISLAND', uid, { cluster_evidence: stats });
      }
    }
  }
}
```

**interactionGraph.js**：
```js
async function collectInteractionEdges(userIds) {
  // friendships（accepted）
  const { data: frs } = await supabase.from('friendships')
    .select('requester_id, addressee_id')
    .in('requester_id', userIds).in('addressee_id', userIds)
    .eq('status', 'accepted');
  // likes（两端都是新用户）
  const { data: lks } = await supabase.rpc('list_new_user_likes', { p_user_ids: userIds });
  // comments（评论别人的帖子）
  const { data: cms } = await supabase.rpc('list_new_user_comments', { p_user_ids: userIds });
  return [...frs, ...lks, ...cms].map(e => ({ a: e.requester_id || e.user_id, b: e.addressee_id || e.target_user_id }));
}

// 内部互动率 = (内部边数) / (内部边 + 每人对外互动数 / N)
function computeClusterStats(component, allEdges, newUserIds) {
  const members = new Set(component);
  let internal = 0;
  const externalCount = {};  // { userId: count }
  for (const e of allEdges) {
    const aIn = members.has(e.a);
    const bIn = members.has(e.b);
    if (aIn && bIn) internal++;
    else if (aIn) externalCount[e.a] = (externalCount[e.a] || 0) + 1;
    else if (bIn) externalCount[e.b] = (externalCount[e.b] || 0) + 1;
  }
  const maxExternal = Math.max(0, ...Object.values(externalCount));
  const possibleInternal = members.size * (members.size - 1) / 2;
  const internalRate = possibleInternal > 0 ? internal / possibleInternal : 0;
  return { size: members.size, internal, internalRate, maxExternal };
}
```

### 4.2 风险分时间衰减（每日 cron）

```js
// server/src/services/decay/timeDecay.js
async function runDecay() {
  const protectionDays = await getSystemConfigInt('new_account_protection_days', 7);
  const decayFactor = await getSystemConfigFloat('score_decay_factor', 0.9);

  const { data: users } = await supabase
    .from('users')
    .select('id, risk_score, created_at, last_risk_event_at')
    .gt('risk_score', 0);

  for (const u of users) {
    const lastEvent = u.last_risk_event_at ? new Date(u.last_risk_event_at) : new Date(u.created_at);
    const daysSince = (Date.now() - lastEvent.getTime()) / 86400000;
    if (daysSince < 7) continue;  // 未到衰减周期
    const regDays = (Date.now() - new Date(u.created_at).getTime()) / 86400000;
    let effectiveFactor = decayFactor;
    if (regDays < protectionDays) {
      // 新号保护期：衰减只 30% 效果
      effectiveFactor = 1 - (1 - decayFactor) * 0.3;  // 0.9 → 0.97
    }
    const newScore = Math.floor(u.risk_score * effectiveFactor);
    if (newScore < u.risk_score) {
      await supabase.from('users').update({ risk_score: newScore }).eq('id', u.id);
      await supabase.from('risk_events').insert({
        user_id: u.id,
        rule_code: 'TIME_DECAY',
        score_delta: newScore - u.risk_score,
        reason: 'decay',
      });
      await supabase.from('risk_score_decay_log').insert({
        user_id: u.id,
        before_score: u.risk_score,
        after_score: newScore,
        decay_type: 'time_decay',
      });
      // 分数衰减可能触发状态回退
      await applyEnforcement({ ...u, risk_score: newScore });
    }
  }
}
```

### 4.3 正向行为奖励

**触发式（用户动作发生时）**：
```js
// 别人点赞了某用户的帖子 → 检查是否应给作者减分
// server/src/routes/likes.js (POST 成功后)
const post = await getPost(postId);
const authorId = post.author_id;
if (authorId !== req.user.id && !isInSameCluster(authorId, req.user.id)) {
  // 不在同簇才算数
  await tryAddReward(authorId, 'post_liked_by_stranger', -3, {
    cooldown_key: `reward:post:${postId}`,
    cooldown_sec: 365 * 86400,  // 每帖只算一次
  });
}
```

**每日汇总（cron）**：
```js
// 每日检查：所有连续 7 天登录且无违规的用户 → -5
async function dailyReward() {
  const { data: users } = await supabase.rpc('find_eligible_weekly_reward_users');
  for (const u of users) {
    await tryAddReward(u.id, 'weekly_active_clean', -5, {
      cooldown_key: `reward:weekly:${u.id}`,
      cooldown_sec: 7 * 86400,
    });
  }
}
```

**tryAddReward 实现**：
```js
// server/src/services/decay/positiveReward.js
async function tryAddReward(userId, rewardType, scoreDelta, { cooldown_key, cooldown_sec }) {
  // 检查冷却（用 Upstash Redis SET NX EX）
  const ok = await redis.set(cooldown_key, '1', { nx: true, ex: cooldown_sec });
  if (!ok) return { skipped: true, reason: 'cooldown' };

  const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user || user.risk_score <= 0) return { skipped: true, reason: 'no_score_to_reduce' };

  // 新号保护期
  const regDays = (Date.now() - new Date(user.created_at).getTime()) / 86400000;
  const protectionDays = await getSystemConfigInt('new_account_protection_days', 7);
  let effective = scoreDelta;
  if (regDays < protectionDays) effective = Math.ceil(scoreDelta * 0.3);
  if (effective === 0) return { skipped: true, reason: 'rounded_to_zero' };

  const newScore = Math.max(0, user.risk_score + effective);
  await supabase.from('users').update({ risk_score: newScore }).eq('id', userId);
  await supabase.from('risk_events').insert({
    user_id: userId,
    rule_code: rewardType.toUpperCase(),
    score_delta: effective,
    reason: 'reward',
  });
  await supabase.from('risk_score_decay_log').insert({
    user_id: userId,
    before_score: user.risk_score,
    after_score: newScore,
    decay_type: `reward_${rewardType}`,
  });
  await applyEnforcement({ ...user, risk_score: newScore });
  return { applied: true, scoreDelta: effective };
}
```

### 4.4 申诉处理 UI（管理员后台）

```
/admin/appeals
  - 状态筛选（pending / approved / rejected）
  - 列表：user nickname | 申诉原因 | 联系邮箱 | 证据 | 提交时间
  - 操作：通过 / 拒绝 + 备注
```

通过 → 自动 -30 风险分 + 解封（如果曾 ban）：
```js
router.put('/:id/approve', adminOnly, async (req, res) => {
  const appeal = await supabase.from('appeals').select('*').eq('id', req.params.id).single();
  await supabase.from('appeals').update({
    status: 'approved',
    admin_note: req.body.note,
    resolved_at: new Date(),
    resolved_by: req.user.id,
  }).eq('id', req.params.id);
  // -30 分
  const { data: user } = await supabase.from('users').select('*').eq('id', appeal.data.user_id).single();
  const newScore = Math.max(0, user.risk_score - 30);
  await supabase.from('users').update({ risk_score: newScore, status: 'active' }).eq('id', user.id);
  await supabase.from('risk_events').insert({
    user_id: user.id,
    rule_code: 'APPEAL_APPROVE',
    score_delta: -30,
    reason: 'appeal_approve',
  });
  // revoke 对应 ban_records
  if (appeal.data.ban_record_id) {
    await supabase.from('ban_records').update({
      revoked_at: new Date(),
      revoked_by: req.user.id,
      revoke_reason: '申诉通过',
    }).eq('id', appeal.data.ban_record_id);
  }
  await applyEnforcement({ ...user, risk_score: newScore });
  res.json({ success: true });
});
```

### 4.5 开启申诉前端

最后一步（验证过后）：
```sql
UPDATE system_config SET value='true' WHERE key='appeals_enabled';
```

前端**无需**重新打包：请求后端时如果拿到 `code: COMING_SOON` → toast 占位；拿到 `200` → 正常流程。

### 4.6 事件归档

```js
// server/src/services/archive/archiveRiskEvents.js
async function archive() {
  const cutoff = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
  // 简单方案：直接删除（保留 Phase 4 log 表中的关键 decay/reward 轨迹即可）
  const { count } = await supabase.from('risk_events').delete().lt('created_at', cutoff).select('id', { count: 'exact' });
  console.log(`[archive] deleted ${count} old risk_events`);
}
```

---

## 5. Phase 4 测试清单

### 5.1 自动化

#### 单元
- [ ] `isolatedIslandDetect.test.js`：3 个新号互关率 80% → 识别为孤岛簇；有外部关注 > 3 → 不识别
- [ ] `timeDecay.test.js`：风险分 50 × 0.9 = 45；新号 × 0.97 = 48.5 → 48（floor）
- [ ] `positiveReward.test.js`：冷却生效 / 同簇过滤生效 / 新号保护 × 30%
- [ ] `archiveRiskEvents.test.js`：90 天前事件被删除

#### 集成
- [ ] 注入 5 个互相关注的新号 → cron 跑完 → account_clusters 有 isolated_island 记录
- [ ] 造 risk_score=50 + last_event_at=8 天前的用户 → cron 跑完 → 分数变 45
- [ ] 触发 tryAddReward → 冷却期内第二次调用 returns skipped
- [ ] 申诉通过 → user.risk_score -30，status='active'，ban_records.revoked_at 写入

### 5.2 手动测试

**孤岛簇检测**
- [ ] 创建 5 个测试账号，全部 < 7 天，互相加好友 + 互相点赞
- [ ] 手动触发 cron（或等 1 小时）→ 查 `account_clusters WHERE cluster_type='isolated_island'` 应有记录
- [ ] 每个成员 risk_score 应增加（ISOLATED_ISLAND 规则 +10）
- [ ] 管理员后台账号簇视图应出现此簇

**风险分衰减**
- [ ] 手动设测试账号 risk_score=50，`last_risk_event_at` = 10 天前
- [ ] 触发 decay cron → 查 users.risk_score 应变 45
- [ ] 查 `risk_score_decay_log` 应有记录
- [ ] 新号（注册 < 7 天）同样设 50 → 应变 48（× 0.97）

**正向行为奖励**
- [ ] A 账号 risk_score=20，发一条帖子
- [ ] B、C、D（都与 A 无指纹/IP 簇关联）分别点赞 → 触发奖励 -3
- [ ] 查 A.risk_score 应变 17
- [ ] 同一帖子再被 E 点赞 → 不减分（cooldown 命中，此帖已算过）
- [ ] 连续 7 天登录且无违规的账号 → daily cron 跑完后 -5

**同簇过滤**
- [ ] A、B 属于同一指纹簇，A 发帖 B 点赞 → A 不减分
- [ ] A、B 属于不同簇，A 发帖 B 点赞 → A 减分

**申诉热启用**
- [ ] 当前 appeals_enabled=false → 前端点申诉 → toast "功能开发中"
- [ ] 管理员把 appeals_enabled 改为 true（直接 UPDATE system_config）
- [ ] **不重新打包前端**，刷新页面后
- [ ] 点"提交申诉" → 真正进入流程，POST /api/appeals 成功返回
- [ ] 7 天内提交第 4 次 → 429
- [ ] 管理员后台 `/admin/appeals` → 看到申诉
- [ ] 点"通过" → A 账号 risk_score -30，ban_records.revoked_at 写入

**归档**
- [ ] 手动触发 archive cron → 90 天前的 risk_events 被删除
- [ ] 查 `risk_score_decay_log` 仍完整保留（不归档）

**完整流程端到端**
- [ ] 新用户用正版 APK 注册 → 一切正常
- [ ] 脚本用秒拨 IP 注册 10 个账号 → 后 5 个触发 IP 段封
- [ ] 一个账号脚本发 10 条相似帖子 → 触发 SIMHASH_SIMILAR，分数飙升到 >70 → 冻结
- [ ] 用户点申诉 → 填写申诉 → 管理员通过 → 账号恢复

### 5.3 回归
- [ ] Phase 1、2、3 全部功能仍正常
- [ ] 无任何回归错误

---

## 6. 完成标志 & 上线清单

- [ ] 所有自动化测试通过
- [ ] 所有手动测试清单全通过
- [ ] 代码通过 **code-reviewer** 审查
- [ ] VPS 上**连续观察 48 小时**无异常
- [ ] 提交 commit：`feat(anti-abuse-phase4): clustering + decay + rewards + appeals live`
- [ ] **执行**：`UPDATE system_config SET value='true' WHERE key='appeals_enabled';`（生产环境）
- [ ] 通知用户（管理员）整个反滥用系统上线完毕

---

## 7. 运维指南（上线后）

### 7.1 关键指标监控

- 每天查询：
  ```sql
  SELECT COUNT(*) FROM risk_events WHERE created_at > NOW() - INTERVAL '24 hours';  -- 应 > 0
  SELECT COUNT(*) FROM users WHERE risk_score >= 40;  -- 降权人数
  SELECT COUNT(*) FROM users WHERE status='banned';  -- 封禁总数
  SELECT COUNT(*) FROM account_clusters WHERE status='pending';  -- 待审核簇数
  SELECT COUNT(*) FROM appeals WHERE status='pending';  -- 待处理申诉
  ```

### 7.2 阈值调整建议

上线 2 周后按以下方式微调：
- 降权人数 > 日活 5% → 阈值偏严，考虑把 40-70 改为 50-75
- 封禁人数 > 日活 1% → 同上，85 改为 90
- 申诉通过率 > 50% → 规则误杀严重，逐条规则分析 evidence 调低 score

### 7.3 紧急开关

- 发现大面积误封 → 管理员后台切 observe 模式
- 单条规则误触发严重 → 后台禁用该规则
- 所有用户被封 → 直接 SQL：`UPDATE users SET status='active' WHERE status='banned' AND risk_score < 85;`

### 7.4 cron 任务监控

如果 cron 未执行：
- 查 pm2 logs：`pm2 logs hit-circle | grep cron`
- 查进程：`pm2 show hit-circle`
- 重启：`pm2 restart hit-circle`

### 7.5 未来扩展

系统 100% 上线后的扩展路径：
1. 接入 FingerprintJS Pro（$20+/月） → 指纹精准度从 85% → 99.5%
2. CF 升级 Pro → 启用 Bot Management
3. 接入 IPQualityScore → 更精准识别代理/VPN
4. 接入 Supabase 美 → 日本 迁移 → 减少风控查询延迟

---

**全部完成！** 回到 [README.md](./README.md) 查看总索引。
