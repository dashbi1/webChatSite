# Phase 3 Fix Pack 实施 Plan（马尔可夫式）

> Phase 3 初版上线后发现 3 个严重问题，本文档是修复和增强的编码契约。

---

## 0. 问题与决策（Q1-Q7）

### 已发现问题
1. **用户 `ttt3` 到 200 分仍能正常发帖** — status 保持 active，restricted_until=null，is_shadow_banned=false
2. **70+ 冻结从未触发** — 无 RiskBanner、能发帖、别人能看到
3. **同规则短时间重复加分** — ttt3 发 6 次帖，ASN_DATACENTER 被加 6 次 × 25 = 150 分，瞬间冲到斩杀线

### 决策清单

| 问题 | 选择 | 备注 |
|---|---|---|
| Q1 闭环触发 | **B 异步 fire-and-forget** | scoreStore 末尾 setImmediate 调 applyEnforcement |
| Q2 白名单 | **B 封禁 + 额外推 pending** | 白名单不再豁免 frozen/banned，只在注册时 COLD_EMAIL_DOMAIN 不加分（phase2 已是如此） |
| Q3 去重 | **A 每规则配 dedup_mode** | once / decay / none 三种模式 |
| Q4 申诉 | **关** | 保持 appeals_enabled=false，phase4 打开 |
| Q5 自然衰减 | **A 留 phase4** | 每日 cron × 0.9 不在这次范围 |
| Q6 配置放哪 | **A params JSONB 扩展** | 不改表 schema，合并进现有 params |
| Q7 commit 粒度 | **1 个合并 commit** | 一次到位 |
| decay 保底 | **最小 1 分** | `Math.max(1, round(base × factor^hits))` |
| 存量用户 | **从今往后** | ttt3 不管，新事件走新机制 |
| 日志策略 | **dedup=0 不写** | 避免污染 risk_events |
| window_hits | **只数 rule_trigger** | decay/reward 事件不计入 |

---

## 1. 代码改动

### 1.1 新增 `server/src/services/riskEngine/dedupDecay.js`

```js
// computeAppliedDelta(userId, rule) → Promise<number>
// 根据 rule.params 里 dedup_mode / dedup_window_hours / decay_factor 计算实际加分
//   'none'  → 返回 rule.score
//   'once'  → 窗口内已命中 ≥1 次 → 0；否则 rule.score
//   'decay' → max(1, round(rule.score × decay_factor ^ hits))
// window_hours=null 时表示永久窗口（对 COLD_EMAIL_DOMAIN）
```

查询用 `risk_events WHERE user_id=.. AND rule_code=.. AND reason='rule_trigger' [AND created_at >= since]` HEAD count。

### 1.2 改 `server/src/services/riskEngine/index.js`

`evaluate` 循环里，触发后先调 `computeAppliedDelta(user.id, rule)`：
- 返回 0 → 跳过（不写 risk_events、不调 recordEvent）
- 返回 >0 → 传给 recordEvent 作为 scoreDelta（**不再是原 rule.score**）

### 1.3 改 `server/src/services/riskEngine/scoreStore.js`

在 `recordEvent` 末尾，mode='enforce' 且 updated 成功后：
```js
if (mode === 'enforce' && next !== current) {
  setImmediate(async () => {
    try {
      const { data: fresh } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
      if (fresh) await applyEnforcement(fresh);
    } catch (e) { console.warn('[scoreStore] enforce async failed:', e && e.message); }
  });
}
```
用动态 `require('./... /applyEnforcement')` 避免循环依赖（applyEnforcement 不依赖 scoreStore，但保险起见）。

### 1.4 改 `server/src/services/enforcement/applyEnforcement.js`

- **删除**整个 `if (level === 'banned') { if (isWhitelist) { whitelistShielded = true; insert pending; } else { ban; } }` 的豁免逻辑
- 改成:
  - `level === 'banned'`:
    - 设 `newStatus = 'banned'`
    - 调 `createBanRecord(user, ...)`
    - 若 `isWhitelistedDomain(user.email)` → **额外**写 `account_clusters(status='pending', cluster_type='simhash_similar', evidence={banned_whitelist_email: true, domain, score})` 供 admin 审计
- 返回结构保留 `whitelistShielded` 字段（false/true 仅表示"是否同时推了 admin pending 通知"），`enforced` 始终按 banned 处理时为 true

### 1.5 Supabase seed 迁移

`apply_migration(name='anti_abuse_phase3_dedup_seed')` 跑 12 条 UPDATE：
```sql
UPDATE risk_rules SET params = params || '{"dedup_mode":"once","dedup_window_hours":24}'::jsonb
  WHERE code='REGISTER_QUICK_POST';
UPDATE risk_rules SET params = params || '{"dedup_mode":"decay","dedup_window_hours":1,"decay_factor":0.5}'::jsonb
  WHERE code='NEW_ACCOUNT_BURST';
-- ... 12 条
```

完整 dedup 配置表（与前文技术摘要一致）:

| code | dedup_mode | dedup_window_hours | decay_factor |
|---|---|---|---|
| REGISTER_QUICK_POST | once | 24 | - |
| NEW_ACCOUNT_BURST | decay | 1 | 0.5 |
| SIMHASH_SIMILAR | decay | 24 | 0.5 |
| DEVICE_MULTI_ACCOUNT | once | 24 | - |
| IP_CIDR24_BURST | once | 1 | - |
| ASN_DATACENTER | once | 720 | - |
| COLD_EMAIL_DOMAIN | once | null | - |
| DEFAULT_PROFILE | once | 24 | - |
| APK_SIGNATURE_FAIL | decay | 1 | 0.5 |
| EMULATOR_OR_ROOT | once | 720 | - |
| NO_FINGERPRINT | once | 1 | - |
| ISOLATED_ISLAND | once | 24 | - |

缓存:seed 完成后记得 `ruleCache.invalidate()`（下次请求自动重新加载；apply_migration 跑完 PM2 不重启也无所谓，10 分钟 TTL 内会自然刷新）。

### 1.6 也把本地迁移脚本 `database/migrations/anti_abuse_phase3_dedup_seed.sql` 同步落盘（便于回滚/审计）

---

## 2. 测试

### 2.1 新增 `tests/anti-abuse/phase3/unit/dedupDecay.test.js`

- `none` → 返回 rule.score
- `once` 无历史 → rule.score；有历史 → 0
- `decay` 无历史 → base；n 次后 = round(base × factor^n)
- `decay` 保底 1（base=1 factor=0.5 n=10）
- window_hours=null → 不带 created_at 过滤
- window_hours=24 → 带 since 过滤

### 2.2 改 `tests/anti-abuse/phase3/unit/applyEnforcement.test.js`

把"白名单豁免自动封"测试改成:
- 非白名单 90 分 → banned + createBanRecord（保留）
- **白名单 90 分 → banned + createBanRecord + 额外写 account_clusters pending**（改）
- whitelistShielded 字段改为仅标识"是否同时推了 pending"，不影响 enforced=true

### 2.3 新增 `tests/anti-abuse/phase3/integration/scoreStore.integration.test.js`

验证 recordEvent 末尾 setImmediate 会触发 applyEnforcement：
- 给 user mock 分数从 0 → 90（足以触发 banned）
- mock applyEnforcement，等 `setImmediate + await Promise.resolve()` 后断言被调用一次
- observe 模式不应调用

### 2.4 改 `riskEngine/index.js` 可能影响现有集成测试 — 检查不破坏 phase2 的 adminRisk 集成测试

---

## 3. 部署

1. `git add` + `git commit -m "fix(anti-abuse-phase3): applyEnforcement 闭环 + dedup/decay + 白名单不再豁免封禁"`
2. `apply_migration anti_abuse_phase3_dedup_seed`（生产库）
3. `./deploy-to-vps.sh`
4. VPS: `sudo pm2 restart hit-circle`
5. 手动验证:
   - 新建一个测试账号，连续用机房 IP 发 6 次帖子 → risk_events 只有 1 条 ASN_DATACENTER（once/720h）
   - 分数到 70+ 时 → users.restricted_until 被设 + RiskBanner 显示 + POST /api/posts 返回 UNDER_REVIEW
   - 分数到 85+ 时 → users.status=banned + ban_records + 白名单邮箱额外有 account_clusters pending

---

## 4. 回滚

- 代码:`git revert <commit>`
- seed:写一条 rollback SQL 把 params 里 dedup_* 字段 `-` 掉
- 或者直接切 observe 模式应急（全局跳过执行）

---

## 5. 完成判定

- 所有自动化测试 `npm run test:abuse:phase3` 通过
- ttt3 场景手动验证:再发 5 次同样行为，ASN_DATACENTER 不再加分（720h 冷却）
- 测试用户到 70 分能看到 RiskBanner、到 85 能收到 banned
