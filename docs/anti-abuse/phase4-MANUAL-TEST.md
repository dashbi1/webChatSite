# Phase 4 手动测试清单

> 自动化已由 `npm run test:abuse:phase4` 覆盖。本文档是 VPS 上线后的端到端人工验证。

## 前置

- [ ] Phase 4 migration 已在生产 Supabase 上跑成功
- [ ] `./deploy-to-vps.sh` 执行完成
- [ ] VPS `sudo pm2 restart hit-circle`
- [ ] `pm2 logs hit-circle | head -80` 应看到 `[cron] 8 tasks scheduled`

---

## 1. 孤岛簇检测（`0 * * * *`）

- [ ] 创建 5 个测试账号 T1-T5，均 < 7 天注册
- [ ] 让 T1-T5 之间**相互加好友**（全部 accepted）+ **相互点赞每人的帖子**
- [ ] 等下一个整点或在 VPS 上临时触发：
  ```sh
  ssh ... 'cd /opt/hit-circle && node -e "require(\"./src/services/cluster/isolatedIslandDetect\").detect().then(console.log)"'
  ```
- [ ] 预期：
  - `account_clusters` 新增一条 `cluster_type='isolated_island'`、`status='pending'`、`member_ids` 含 T1-T5
  - 每个 Ti 的 `users.risk_score` +10
  - `risk_events` 每人一条 `ISOLATED_ISLAND, reason=rule_trigger`
  - admin 后台 "账号簇" tab 应看到此簇

## 2. 时间衰减（`0 2 * * *`）

- [ ] 选测试账号 U1：手动 SQL
  ```sql
  UPDATE users SET risk_score=50, last_risk_event_at=NOW() - INTERVAL '10 days' WHERE id='U1';
  ```
- [ ] 触发 cron 或直接：
  ```sh
  node -e "require('./src/services/decay/timeDecay').runDecay().then(console.log)"
  ```
- [ ] 预期：
  - `users.risk_score` = 45（`floor(50 * 0.9)`）
  - `risk_events` 新增 `TIME_DECAY, score_delta=-5, reason=decay`
  - `risk_score_decay_log` 新增 `decay_type=time_decay, before=50, after=45`

## 3. 新号衰减保护（factor = 0.97）

- [ ] 注册 < 7 天的 U2：
  ```sql
  UPDATE users SET risk_score=50, last_risk_event_at=NOW() - INTERVAL '10 days' WHERE id='U2' AND created_at > NOW() - INTERVAL '7 days';
  ```
- [ ] 触发 decay cron
- [ ] 预期：`risk_score = 48`（`floor(50 * 0.97)`）

## 4. banned 跳过衰减

- [ ] 设置 U3：`UPDATE users SET status='banned', risk_score=90, last_risk_event_at=NOW() - INTERVAL '10 days' WHERE id='U3';`
- [ ] 触发 decay cron
- [ ] 预期：U3 分数不变（查询应确认 `risk_score=90, status=banned`）

## 5. 陌生人点赞奖励

- [ ] A（risk_score=20）发帖 P
- [ ] B（A 与 B 无同簇）点赞 P
- [ ] 预期：A 的 `risk_score` 变 17；`risk_score_decay_log` 有 `decay_type=reward_post_liked_by_stranger, metadata.post_id=P`
- [ ] 再让 C 也点赞 P → A 不再减分（cooldown 命中）

## 6. 同簇过滤

- [ ] 手动向 `account_clusters` 插入一条包含 A + B 的 `fingerprint` cluster（status=pending）
- [ ] A 发帖 P2；B 点赞 P2
- [ ] 预期：A 的 `risk_score` 不变（reward skipped, reason=same_cluster）
- [ ] 查 `risk_score_decay_log` 无新记录

## 7. 评论被回复奖励

- [ ] A（risk_score=20）发帖 Q
- [ ] B 评论 Q
- [ ] 预期：A 的 `risk_score` 变 18；`decay_type=reward_comment_replied`
- [ ] 当天 C 再评论 Q → A 不再减分（同日 cooldown）

## 8. 好友通过奖励

- [ ] A（risk_score=20）向 B 发好友申请
- [ ] B 接受
- [ ] 预期：A（申请方）的 `risk_score` 变 17；`decay_type=reward_friend_accepted`
- [ ] B 的分数不变（仅申请方受益）

## 9. weekly_active_clean 奖励（`30 3 * * *`）

- [ ] 给 U4 造数据：`UPDATE users SET risk_score=15 WHERE id='U4';`
- [ ] 确保 `user_ips` 中 U4 的 `last_seen_at` 在 7 天内
- [ ] 确保 U4 近 7 天 `risk_events(reason='rule_trigger')` 累计 `score_delta < 10`
- [ ] 触发：
  ```sh
  node -e "require('./src/cron/dailyRewardWeeklyActive').runDailyRewardWeeklyActive().then(console.log)"
  ```
- [ ] 预期：U4 `risk_score = 10`；`decay_type=reward_weekly_active`

## 10. 过期封禁自动解除（`30 4 * * *`）

- [ ] 手动造数据：
  ```sql
  INSERT INTO ban_records(target_type, target_id, ban_type, reason, expires_at)
    VALUES ('ip', '1.2.3.4', 'auto_score', 'test', NOW() - INTERVAL '1 hour');
  UPDATE ip_records SET is_banned=true WHERE ip_address='1.2.3.4';
  ```
- [ ] 触发：
  ```sh
  node -e "require('./src/services/enforcement/expireBans').runExpireBans().then(console.log)"
  ```
- [ ] 预期：
  - `ban_records.revoked_at` 被设，`revoke_reason='auto_expired'`
  - `ip_records.is_banned=false`

## 11. 申诉热启用 + admin 处理

- [ ] `SELECT value FROM system_config WHERE key='appeals_enabled';` → `true`
- [ ] 用户 U5（banned）在前端申诉页面填写理由并提交 → 201
- [ ] 7 天内第 4 次提交 → 429
- [ ] Admin 后台 → 申诉处理 tab → 看到 U5 的申诉
- [ ] 点"通过"并填备注 → U5 `risk_score -30`、`status='active'`、关联 `ban_records.revoked_at` 写入
- [ ] `risk_events` 新增一条 `APPEAL_APPROVE, score_delta=-30, reason=appeal_approve`

## 12. 归档 cron（`0 4 * * 0`）

- [ ] 手动造一条旧事件：
  ```sql
  INSERT INTO risk_events(user_id, rule_code, score_delta, reason, created_at)
    VALUES ('U1', 'TEST_OLD', 1, 'rule_trigger', NOW() - INTERVAL '95 days');
  ```
- [ ] 触发：
  ```sh
  node -e "require('./src/services/archive/archiveRiskEvents').runArchive(90).then(console.log)"
  ```
- [ ] 预期：
  - `risk_events_archive` 有该记录 + `archived_at`
  - `risk_events` 中对应 id 已删除
  - `risk_score_decay_log` 内容不受影响（只保留 90 天归档目标是 risk_events）

## 13. 闭环回归

- [ ] U6 分数 > 70：banner 应出现（冻结）
- [ ] 触发衰减把 U6 拉回 < 70 → banner 自动消失（applyEnforcement 闭环生效）
- [ ] Phase 1/2/3 老测试：登录、注册、发帖、限流、shadow、enforce 模式切换、规则 UI 改分，都应正常

---

## 完成判定

- [ ] 12 项全部 ✅
- [ ] `pm2 logs hit-circle | grep cron:` 显示 8 个 cron 均周期运行无异常
- [ ] 48 小时观察：无 ERROR、`decay_log` / `risk_events_archive` / `account_clusters` 有新增记录
