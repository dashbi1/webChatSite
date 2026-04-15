# 02 — 规则引擎、默认规则与评分机制

> 本文档列出 12 条默认风控规则、风险分的加 / 减逻辑、时间衰减与正向奖励公式。
> 所有规则通过 `risk_rules` 表配置，管理员后台可开关和调分值。

---

## 1. 风险分层级（回顾）

| 分数段 | 状态 | 自动动作 | 用户感知 |
|--------|------|----------|----------|
| `0-40` | 正常 | 无 | 无 |
| `40-70` | **降权（shadow）** | 帖子/评论/点赞 shadow ban、发帖冷却拉长、不推荐 | **不通知** |
| `70-85` | **冻结** | 不能发帖 / 私聊，能登录看内容 | **banner + toast 提示"审核中"** |
| `85+` | **封禁** | `status='banned'`，禁止登录 | 登录返回 `code: BANNED` |

**降分路径**：分数衰减或申诉通过后，用户状态自动恢复（下一档以下的动作同时解除）。

**例子**：
- 用户分数 75（冻结）→ 申诉通过 -30 → 45（降权）→ shadow ban 仍生效但能发帖
- 用户分数 45（降权）→ 时间衰减到 38 → 回归正常

---

## 2. 12 条默认规则（seed 数据）

### 2.1 规则总表（按分类分组）

| # | code | name | category | enabled | 默认分值 | 触发条件 |
|---|------|------|----------|---------|---------|---------|
| 1 | `REGISTER_QUICK_POST` | 注册后快速发首帖 | registration | ✅ | **+5** | 注册后 < 5 分钟发首帖 |
| 2 | `NEW_ACCOUNT_BURST` | 新号短时发帖过多 | registration | ✅ | **+10** | 新号 24h 内发帖 > 5 条 |
| 3 | `SIMHASH_SIMILAR` | 文案与其他新号高相似 | content | ✅ | **+15** | simhash 距离 < 3 于 24h 内其他新号（< 7 天） |
| 4 | `DEVICE_MULTI_ACCOUNT` | 同设备多账号 | device | ✅ | **+25** | 设备指纹已关联 ≥ 3 个账号（触达限流上限） |
| 5 | `IP_CIDR24_BURST` | IP 段注册密集 | network | ✅ | **+30** | 同 /24 段 1h 内注册 ≥ 5 |
| 6 | `ASN_DATACENTER` | 机房 IP | network | ✅ | **+25** | ASN 是已知数据中心（DigitalOcean/Vultr/AWS 等） |
| 7 | `COLD_EMAIL_DOMAIN` | 冷门邮箱域 | registration | ✅ | **+10** | 邮箱域不在白名单且不是 edu/edu.cn |
| 8 | `DEFAULT_PROFILE` | 默认头像+昵称 | registration | ✅ | **+5** | 头像空 + 昵称格式为 "用户xxx" |
| 9 | `ISOLATED_ISLAND` | 孤岛互动簇 | behavior | ✅ | **+10** | 簇内互动率 > 60%，簇外 < 3 次/人 |
| 10 | `APK_SIGNATURE_FAIL` | APK 签名失败 | device | ✅ | **+45** | `X-App-Signature` 校验失败（HMAC 或 SHA256 白名单） |
| 11 | `EMULATOR_OR_ROOT` | 模拟器 / root 设备 | device | ✅ | **+25** | APK 检测到 root / 模拟器 / Xposed |
| 12 | `NO_FINGERPRINT` | 缺失设备指纹 | device | ✅ | **+5** | 关键动作请求未携带指纹 header |

### 2.2 完整 Seed SQL

```sql
INSERT INTO risk_rules (code, name, description, category, enabled, score, params) VALUES
('REGISTER_QUICK_POST',
  '注册后快速发首帖',
  '新账号注册后 N 分钟内就发首帖，疑似脚本行为',
  'registration', TRUE, 5,
  '{"threshold_minutes": 5}'::jsonb),

('NEW_ACCOUNT_BURST',
  '新号短时发帖过多',
  '新账号 24 小时内发帖数量超过阈值',
  'registration', TRUE, 10,
  '{"window_hours": 24, "max_posts": 5}'::jsonb),

('SIMHASH_SIMILAR',
  '文案与其他新号高相似',
  'simhash 距离 < N，与 24h 内其他新号（< 7 天）的帖子高度相似',
  'content', TRUE, 15,
  '{"threshold_distance": 3, "window_hours": 24, "new_days": 7}'::jsonb),

('DEVICE_MULTI_ACCOUNT',
  '同设备多账号',
  '同一设备指纹已关联多个账号',
  'device', TRUE, 25,
  '{"max_accounts": 3}'::jsonb),

('IP_CIDR24_BURST',
  'IP 段注册密集',
  '同一 /24 IP 段短时间内注册多个账号',
  'network', TRUE, 30,
  '{"cidr_prefix": 24, "window_hours": 1, "max_registrations": 5}'::jsonb),

('ASN_DATACENTER',
  '机房 IP',
  'IP 属于已知数据中心 ASN（疑似代理/VPN/服务器）',
  'network', TRUE, 25,
  '{}'::jsonb),

('COLD_EMAIL_DOMAIN',
  '冷门邮箱域',
  '邮箱域名不在白名单且不是 edu/edu.cn 教育邮箱',
  'registration', TRUE, 10,
  '{}'::jsonb),

('DEFAULT_PROFILE',
  '默认头像+默认昵称',
  '未设置头像 + 昵称是默认"用户xxx"格式',
  'registration', TRUE, 5,
  '{"default_nickname_pattern": "^用户[\\\\w]{4,8}$"}'::jsonb),

('ISOLATED_ISLAND',
  '孤岛互动簇',
  '账号属于互动率 > 60%、簇外互动 < 3 次/人、全是 < 7 天新号的孤岛簇',
  'behavior', TRUE, 10,
  '{"internal_rate_threshold": 0.6, "external_max_per_user": 3, "new_days": 7, "min_cluster_size": 3}'::jsonb),

('APK_SIGNATURE_FAIL',
  'APK 签名校验失败',
  'X-App-Signature header 校验失败：HMAC 不匹配或签名 SHA256 不在白名单',
  'device', TRUE, 45,
  '{}'::jsonb),

('EMULATOR_OR_ROOT',
  '模拟器 / root 设备',
  'APK 检测到设备被 root 或运行在模拟器中',
  'device', TRUE, 25,
  '{}'::jsonb),

('NO_FINGERPRINT',
  '缺失设备指纹',
  '关键动作请求未携带 X-Device-Fingerprint header',
  'device', TRUE, 5,
  '{}'::jsonb);
```

---

## 3. 规则引擎行为

### 3.1 规则缓存

- Node 启动时从 `risk_rules` 表加载所有规则到内存 `Map<code, rule>`
- **每 10 分钟刷新一次**（由 `system_config.rules_cache_ttl_seconds` 控制）
- 管理员改规则后，**最长 10 分钟生效**（符合热加载预期）

### 3.2 评估流程（每个请求）

```
关键动作请求进来
  ↓
getClientIp(req) + 采集指纹 header
  ↓
→ [并行] 记录 fingerprint / ip_record + 关联到 user_fingerprints / user_ips
→ [并行] 评估规则：遍历所有 enabled=true 的规则，符合条件则:
           - 写 risk_events（score_delta = rule.score, mode = 当前 system_config.risk_enforcement_mode）
           - 累加到 user.risk_score
  ↓
重新计算 user 的执行级别（正常/降权/冻结/封禁）
  ↓
执行对应动作（仅 enforce 模式下生效）
```

### 3.3 observe 模式下的行为

- `risk_events` 正常写，`mode = 'observe'`
- `users.risk_score` **不更新**（保持原值）
- 降权/冻结/封禁**不触发**
- 管理员可通过 `risk_events` 日志查看"如果开 enforce 会怎样"

### 3.4 规则触发的解析位置

每条规则对应一个评估函数，位置在 `server/src/services/riskEngine/rules/`：

```
server/src/services/riskEngine/
├── index.js                    # 入口：evaluate(user, action, context)
├── ruleCache.js                # 内存缓存 + 定时刷新
├── scoreStore.js               # risk_score 读写（带互动簇过滤）
└── rules/
    ├── registerQuickPost.js
    ├── newAccountBurst.js
    ├── simhashSimilar.js
    ├── deviceMultiAccount.js
    ├── ipCidr24Burst.js
    ├── asnDatacenter.js
    ├── coldEmailDomain.js
    ├── defaultProfile.js
    ├── isolatedIsland.js
    ├── apkSignatureFail.js
    ├── emulatorOrRoot.js
    └── noFingerprint.js
```

---

## 4. 白名单与豁免

### 4.1 邮箱白名单（永不被封禁，但可降权观察）

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

function isWhitelistedDomain(email) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return WHITELIST.has(domain) || isEduDomain(domain);
}
```

### 4.2 白名单效果

- **COLD_EMAIL_DOMAIN** 规则不触发
- **封禁动作 skip**：70-85 冻结档和 85+ 封禁档**不强制执行**（降为"标记可疑"推送管理员审核）
- Shadow ban 仍可生效（这是无害的降权）

**例外**：白名单邮箱的 APK 签名失败、root 检测仍会加分（那些规则与邮箱无关）。

---

## 5. 风险分公式

### 5.1 加分公式（规则触发时）

```
new_score = min(200, current_score + rule.score)
```

上限 200（防止单账号分数虚高，实际 >100 没意义）。

### 5.2 衰减公式（cron 每日跑一次）

```
# 对所有 risk_score > 0 的用户：
decay_factor = 0.9
days_since_last_event = (NOW - last_risk_event_at) / 86400

if days_since_last_event >= 7:
    # 新号保护期：注册 < 7 天的账号衰减只 30%
    if user.registered_days < 7:
        effective_factor = 0.97  # 衰减 3%（1 - 0.3 × 10%）
    else:
        effective_factor = 0.9  # 衰减 10%
    new_score = floor(current_score * effective_factor)
    write risk_events(reason='decay', score_delta = new_score - current_score)
```

**设计意图**：
- 新号衰减慢 → 黑产养号周期拉到 3-4 周才见效
- 老号衰减快 → 真实用户的历史误判能自然消退

### 5.3 正向行为奖励

| 行为 | 减分 | 冷却 | 新号保护期（< 7 天） |
|------|------|------|---------------------|
| 连续 7 天登录且无违规 | **-5** | 每周一次 | × 30% → -1.5 → -2（向下取整不到 0） |
| 发帖被**陌生人**点赞 ≥ 3 次 | **-3** | 每帖一次 | × 30% → -1 |
| 发评论被他人回复 | **-2** | 每天 1 次 | × 30% → 无效（-0.6 → 0） |
| 好友申请被**非簇内**用户通过 | **-3** | 每天 1 次 | × 30% → -1 |
| 申诉通过 | **-30** | 单次 | **不受新号保护期影响** |

**关键反养号措施**：
- 减分事件必须校验互动方**不在同一风险簇**（账号簇表查询）
- 每类奖励**每天/每周冷却**，防高频刷
- 所有减分写 `risk_score_decay_log` 便于追溯

### 5.4 管理员手动调整

```
POST /api/admin/users/:id/adjust-score
Body: { delta: -20, reason: 'manual review, cleared false positive' }

→ 写 risk_events(reason='admin_adjust', operator_id=admin_id)
→ 更新 users.risk_score
```

---

## 6. 降权动作的具体表现

### 6.1 Shadow Ban（40-70 档自动启用）

```js
// 发帖 / 评论 / 点赞时检查：
if (user.is_shadow_banned) {
  // 写入数据库，但查询时过滤
  INSERT INTO posts (...) VALUES (..., shadow_ban=true);
}

// 公开帖子列表查询：
SELECT * FROM posts
WHERE shadow_ban = false OR author_id = $currentUserId;
// 自己能看见，别人看不到
```

**采样**：`shadow_ban_sample_rate = 0.5` 意思是帖子有 50% 几率被 shadow（发帖时随机决定，让黑产难以检测）。

### 6.2 发帖冷却拉长

```js
// 正常用户：2 秒冷却
// 降权用户：30 秒冷却
const cooldown = user.risk_score >= 40 ? 30 : 2;
```

### 6.3 冻结（70-85 档）

- 后端 API：发帖、发评论、发私聊、发好友申请均返回 `403 { code: 'UNDER_REVIEW', message: '账号审核中' }`
- 前端：拿到此 code → 弹 toast + 顶部 banner 常驻提示

### 6.4 封禁（85+ 档）

- 后端：`users.status = 'banned'`，登录返回 `403 { code: 'BANNED' }`（已有）
- 自动进入 `account_clusters.status='pending'` 队列等待管理员复核撤销

---

## 7. 封禁层级与复活

### 7.1 账号级（user 级）
- 触发：风险分 ≥ 85 **OR** 管理员手动 **OR** 批量封簇
- 写 `ban_records(target_type='user', target_id=user_id)`
- 同步更新 `users.status='banned'`
- **不自动解除**，靠申诉 + 管理员复核

### 7.2 设备级（fingerprint 级）
- 触发：`account_count ≥ 3` 且其中有 `status=banned` 账号 → cron 自动封
- 写 `ban_records(target_type='fingerprint', expires_at=NOW+30days)`
- 效果：该指纹再来任何请求，所有关联账号新动作全部 +50 分（几乎等同立即封）
- **30 天后自动解除**

### 7.3 IP 级（short / long）
- 触发：`IP_CIDR24_BURST` 命中 → cron 每 10 分钟检查并执行
- 写 `ban_records(target_type='ip', expires_at=NOW+15min)`（short）或 `NOW+30days`（long）
- 效果：该 IP 限流策略强化到"每小时最多 1 次请求"
- **自动到期解除**

---

## 8. 管理员规则配置 UI 预期

管理员后台 `/ADMIN_PATH/risk-rules` 页面：

- 12 条规则列表（code / name / enabled 开关 / score 输入框 / 分类筛选）
- 点"保存"后写入 `risk_rules` 并记录审计 `risk_rule_audit`
- 顶部有"observe / enforce"全局开关（写 `system_config.risk_enforcement_mode`）
- 底部有"最近审计记录"列表（最近 20 条变更）

**约束**：
- 分值范围 0-100
- params JSON 字段不开放 UI（需要改阈值直接改 DB，防 UI 过度复杂）
- 禁用规则时弹确认框"此规则禁用后相关风险场景将不再加分，确认？"

---

## 9. 测试用例示例

### 9.1 规则触发单元测试（Phase 2）

```js
// server/tests/riskEngine/registerQuickPost.test.js
describe('REGISTER_QUICK_POST rule', () => {
  it('adds +5 when user posts within 5 min of registration', async () => {
    const user = await createUser({ created_at: minutesAgo(3) });
    const result = await evaluateRule('REGISTER_QUICK_POST', user, {
      action: 'post_create',
      post: { content: 'hi' },
    });
    expect(result.score_delta).toBe(5);
    expect(result.triggered).toBe(true);
  });

  it('does not trigger after threshold minutes', async () => {
    const user = await createUser({ created_at: minutesAgo(10) });
    const result = await evaluateRule('REGISTER_QUICK_POST', user, ...);
    expect(result.triggered).toBe(false);
  });

  it('respects admin-configured threshold_minutes param', async () => {
    await updateRule('REGISTER_QUICK_POST', { params: { threshold_minutes: 15 } });
    const user = await createUser({ created_at: minutesAgo(10) });
    const result = await evaluateRule(...);
    expect(result.triggered).toBe(true);
  });
});
```

### 9.2 观察模式集成测试（Phase 2）

```js
// observe 模式：risk_score 不变，但 risk_events 正常记录
it('observe mode does not update risk_score', async () => {
  await setSystemConfig('risk_enforcement_mode', 'observe');
  const user = await createUser({ risk_score: 0 });
  await triggerRule(user, 'APK_SIGNATURE_FAIL');
  const updated = await getUser(user.id);
  expect(updated.risk_score).toBe(0);  // 不变
  const events = await getRiskEvents(user.id);
  expect(events[0].mode).toBe('observe');
  expect(events[0].score_delta).toBe(45);
});
```

---

**下一步**：读 [03-architecture.md](./03-architecture.md) 了解系统架构和请求流程。
