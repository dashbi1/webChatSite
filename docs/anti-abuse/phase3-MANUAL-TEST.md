# Phase 3 手动测试清单（用户验收用）

> 前置：Phase 1 / Phase 2 已上线且对应 MANUAL-TEST 清单全部勾完。
> Phase 3 新增：降权执行、账号簇视图、批量封禁、申诉骨架（feature flag 默认关）、IP 段自动封 cron。
> 全部勾完后方可进入 Phase 4。

---

## 0. 数据库迁移（Supabase Dashboard → SQL Editor）

- [ ] 粘贴运行 `database/migrations/anti_abuse_phase3.sql`
- [ ] 验证新表 + 新列：
  ```sql
  SELECT COUNT(*) FROM ban_records;         -- 0（新表）
  SELECT COUNT(*) FROM account_clusters;    -- 0
  SELECT COUNT(*) FROM appeals;             -- 0
  SELECT column_name FROM information_schema.columns
    WHERE table_name='posts' AND column_name='shadow_ban';   -- 应返回 1 行
  SELECT column_name FROM information_schema.columns
    WHERE table_name='comments' AND column_name='shadow_ban';
  ```
- [ ] 验证 RPC 函数存在：
  ```sql
  SELECT proname FROM pg_proc WHERE proname IN (
    'get_timeline_posts', 'get_post_comments_visible',
    'list_fingerprint_clusters', 'list_ip_cidr24_clusters',
    'find_burst_ip_cidr24', 'users_same_ip_within_hours',
    'users_by_fingerprint_cluster'
  );
  -- 应返回 7 行
  ```

---

## 1. 自动化测试

在项目根目录运行：

- [ ] `cd server && npm run test:abuse:phase3` 全部通过
- [ ] 无报错、无未处理 Promise

---

## 2. 部署 + PM2 重启

在本地：
- [ ] `./deploy-to-vps.sh`（或 `.ps1`）部署新版后端 + 前端

在 VPS：
- [ ] `cd /opt/hit-circle/server && sudo npm install --omit=dev`
- [ ] `sudo pm2 restart hit-circle`
- [ ] `pm2 logs hit-circle --lines 30 --nostream` 应看到：
  ```
  工大圈子后端服务启动: http://localhost:3000
  [disposable] loaded XXXX domains
  [cron] 3 tasks scheduled     ← Phase 3 加了 ipBurstCheck，共 3 个
  ```
- [ ] 无 `Cannot find module` / 其他启动错误

---

## 3. Shadow Ban（40-70 降权档）

### 准备
- [ ] 注册账号 A，在 Supabase 手动把 A 的 risk_score 设为 50：
  ```sql
  UPDATE users SET risk_score=50, is_shadow_banned=true,
    shadow_ban_until=NOW() + INTERVAL '14 days'
    WHERE email='<A的邮箱>';
  ```
- [ ] 注册账号 B（正常用户）
- [ ] A 和 B 互加好友（这样 B 能看到 A 的帖子）

### 发帖 Shadow
- [ ] A 连续发 6 条帖子（因为 sample_rate=0.5，约一半会被 shadow）
- [ ] **B** 刷信息流：A 的被 shadow 的帖子看不到；未 shadow 的能看到
- [ ] **A 自己**刷信息流：**全部能看到**（包括被 shadow 的那些）
- [ ] SQL 验证：
  ```sql
  SELECT id, shadow_ban FROM posts WHERE author_id='<A的id>' ORDER BY created_at DESC LIMIT 6;
  -- 应有 shadow_ban=true 和 shadow_ban=false 混合（大约一半）
  ```

### 评论 Shadow
- [ ] B 发一条帖子，A 去评论 6 次
- [ ] B 打开该帖子详情：只看到未 shadow 的评论
- [ ] A 自己打开该帖子：**全部评论可见**
- [ ] 帖子详情页 `comment_count` 只统计非 shadow 评论

### 点赞 Shadow
- [ ] B 发帖，A 反复点赞/取消/再点赞
- [ ] B 打开帖子：`like_count` 不增加（shadow 点赞不计数）
- [ ] A 刷新后看 `is_liked`：可能为 true（假点赞），但 B 看不到

### Shadow 过期自动恢复
- [ ] SQL 手动把 `shadow_ban_until` 改成昨天：
  ```sql
  UPDATE users SET shadow_ban_until=NOW() - INTERVAL '1 day' WHERE email='<A>';
  ```
- [ ] A 再发帖：应不再写 `shadow_ban=true`（验证 `isShadowBanned=false` 的逻辑）

---

## 4. 冻结（70-85）

### 准备
- [ ] 把 A 的 risk_score 设为 75，`restricted_until` 设为 7 天后：
  ```sql
  UPDATE users SET risk_score=75, is_shadow_banned=false, shadow_ban_until=NULL,
    restricted_until=NOW() + INTERVAL '7 days'
    WHERE email='<A>';
  ```

### 前端体验
- [ ] A 登录后打开首页：看到黄色条幅"您的账号正在审核中..."，右侧有"申诉"链接
- [ ] A 点击"+"发帖按钮写好内容 → 提交 → 弹 toast "账号审核中，暂时无法进行此操作"
- [ ] A 尝试评论 → 同样 toast
- [ ] A 尝试点赞 → 同样 toast
- [ ] A 尝试发好友申请 → 同样 toast
- [ ] A 尝试发私聊（socket）→ 在对话界面显示错误（无法发送）
- [ ] A 点击首页条幅的"申诉"链接 → 跳到 `/pages/appeals/index`
- [ ] A 填表单提交 → 弹 toast **"功能开发中，敬请期待"**（因为 `appeals_enabled=false`）

### 后端直接验证
- [ ] `curl -X POST https://www.agent666.xyz/api/posts -H "Authorization: Bearer <A_TOKEN>" -H "Content-Type: application/json" -d '{"content":"test"}'`
  - 返回 `403 { code: "UNDER_REVIEW" }`

### 冻结过期自动恢复
- [ ] SQL 把 `restricted_until` 改成昨天 → A 再次发帖 → 成功

---

## 5. 封禁（85+）

### 非白名单自动封
- [ ] 注册账号 C，邮箱用冷门域名（如 `c@random.xyz`）
- [ ] SQL 把 risk_score 设为 90：
  ```sql
  UPDATE users SET risk_score=90 WHERE email='c@random.xyz';
  ```
- [ ] 在 node 控制台或通过代码触发 `applyEnforcement(user)`（或写一个临时的 admin `POST /api/admin/risk/adjust` 触发）
  - 简化：直接在 SQL 里模拟效果：
    ```sql
    UPDATE users SET status='banned' WHERE email='c@random.xyz';
    INSERT INTO ban_records (target_type, target_id, ban_type, reason)
      VALUES ('user', (SELECT id FROM users WHERE email='c@random.xyz'), 'auto_score', '风险分 90 >= 85 自动封禁');
    ```
- [ ] C 尝试登录 → 返回 `{ code: "BANNED" }`
- [ ] SQL 查 `SELECT * FROM ban_records WHERE target_type='user'` → 有新记录

### 白名单豁免
- [ ] 注册账号 D，邮箱 `d@hit.edu.cn`
- [ ] 把 D 的 risk_score 设为 100
- [ ] 触发 `applyEnforcement(D)` → **D.status 仍然是 active**
- [ ] `SELECT * FROM account_clusters WHERE status='pending'` → 看到一行 D 的记录，evidence 说明原因

---

## 6. 账号簇视图（Admin）

### 准备
- [ ] 用同一浏览器 profile（保证 FingerprintJS 生成相同 visitorId）注册 5 个账号
- [ ] 等待（或手动触发）`updateAccountCounts` cron，使得 `fingerprints.account_count` 更新

### 验证
- [ ] 访问 `https://www.agent666.xyz/console-k8m2x7/`，进入"账号簇"tab
- [ ] 下拉选"按指纹"→ 看到刚才那组指纹，account_count >= 3
- [ ] 展开 account_ids → 看到 5 个账号的前 8 位 UUID
- [ ] 点击"一键封簇" → 弹确认"封禁 5 个账号？" → 确认 → 弹"已封禁 5 个账号"
- [ ] 刷新 → 这 5 个账号 status=banned
- [ ] SQL 查 `SELECT * FROM ban_records WHERE ban_type='bulk_cluster_fingerprint'` → 5 行

### IP 簇视图
- [ ] 切换"按 IP /24 段"下拉 → 看到你的 IP /24 段对应的账号簇

---

## 7. 批量封禁 UI

### 按风险分
- [ ] 准备几个账号把 risk_score 手动设到 60+
- [ ] 进入"批量封禁"tab → 选 `按风险分 >= 阈值` → 输入 50 → 点"预览候选"
- [ ] 下方显示候选用户表 count=N
- [ ] 点"确认封禁" → 弹 alert "已封禁 N 个账号"
- [ ] 刷新 users 表 → N 个账号 status=banned
- [ ] `SELECT ban_type FROM ban_records ORDER BY created_at DESC LIMIT N;` → 全部 `bulk_score_gt`

### 按关键词
- [ ] 有账号 F 发过帖子包含 "垃圾广告"
- [ ] 批量封禁页选 `按帖子关键词` → 输入 `垃圾广告` → 预览 → 确认
- [ ] F 被封

### 按最近 N 小时同 IP
- [ ] 选 `按最近 N 小时同 IP` → 输入某 IP + 1 小时 → 预览
- [ ] 若命中 → 执行

---

## 8. 申诉（Feature Flag）

### flag=false 默认状态
- [ ] `curl -X POST .../api/appeals -H "Authorization: Bearer <X>" -d '{...}'` → 返回 `503 { code: "COMING_SOON" }`
- [ ] 前端申诉页提交 → toast "功能开发中"

### flag=true 打开后
- [ ] admin 后台 → 风控管理 → 目前没有 UI 切换此 flag，使用 API：
  ```bash
  curl -X PUT .../api/admin/risk/config/appeals_enabled \
    -H "Authorization: Bearer <ADMIN>" -H "Content-Type: application/json" \
    -d '{"value": true}'
  ```
- [ ] 等 10 秒（缓存失效）或重启 PM2
- [ ] 前端 A 账号（冻结中）→ 申诉页提交 → 弹 "申诉已提交"
- [ ] 历史列表显示刚提交的
- [ ] 再提交 2 次 → 都成功
- [ ] 第 4 次 → 弹 "7 天内申诉次数已达上限"

### 管理员处理申诉
- [ ] admin 后台 → "申诉处理" → 看到 A 的申诉 pending
- [ ] 点 "通过" → prompt 输入理由 → 确认 → 弹 "已通过（自动 -30 分 + 解封）"
- [ ] SQL 查 A：risk_score 减了 30、restricted_until=NULL、status=active
- [ ] `SELECT * FROM risk_events WHERE rule_code='APPEAL_APPROVE'` → 有一条

### 关回 flag
- [ ] `PUT .../api/admin/risk/config/appeals_enabled` 值 `false` → 再提交 → 503

---

## 9. IP 段自动封 Cron

### 准备
- [ ] 模拟（可以在 Supabase 直接插数据）：
  ```sql
  -- 创建 5 条 user_ips 记录，都绑到 1.2.3.0/24
  -- 要先有 users 记录和 ip_records 记录
  -- 略（实际测试时可用多人从同校园 WiFi 1h 内注册，或自己写脚本）
  ```
- [ ] 等 10 分钟 cron 触发，或手动在 node shell 跑：
  ```js
  await require('./server/src/cron/ipBurstCheck').runIpBurstCheck();
  ```

### 验证
- [ ] `SELECT * FROM ban_records WHERE ban_type='ip_burst_auto'` → 看到新记录
- [ ] `SELECT * FROM ip_records WHERE is_banned=true` → 对应 /24 段 is_banned=true
- [ ] 再次跑 cron → 不会重复插入（幂等验证）

---

## 10. 全局开关（Observe / Enforce）

### 切换到 Observe
- [ ] admin 后台 → "风控管理"tab → 顶部点"切到 OBSERVE" → 确认
- [ ] 之前被 shadow 的 A 现在再发帖 → `shadow_ban` 字段应该是 false（observe 模式下 riskEnforcer 不把 isShadowBanned 传下去）
  - 验证：`SELECT shadow_ban FROM posts WHERE author_id='<A>' ORDER BY created_at DESC LIMIT 1;` → false
- [ ] 之前被冻结的 A 发帖 → **成功**（observe 模式不拦截）
- [ ] 切回 ENFORCE → 恢复原行为

---

## 11. 回归测试（Phase 1/2 功能不受影响）

### Phase 1
- [ ] 同 IP 每天最多 3 次注册限流仍然生效
- [ ] Turnstile 仍然生效
- [ ] 一次性邮箱黑名单拦截仍然生效

### Phase 2
- [ ] 前端仍然发送 `X-Device-Fingerprint` header
- [ ] 规则触发仍然正常写 `risk_events`
- [ ] 指纹/IP 的 `account_count` cron 仍然跑

### 普通用户
- [ ] 一个 risk_score=0 的用户全流程无感：发帖可见、评论可见、点赞计数、好友申请、私聊、发帖不带 shadow_ban=true

---

## 12. 完成标志

- [ ] 以上所有清单全部勾完
- [ ] `SELECT COUNT(*) FROM ban_records` 和 `SELECT COUNT(*) FROM appeals` 有测试产生的数据
- [ ] `pm2 logs hit-circle --err --lines 50` 无未知错误
- [ ] 用户确认后进入 Phase 4

---

## 13. 应急回滚

- 紧急情况：admin 后台切 OBSERVE → 所有降权/封禁动作立刻停止
- 手动解封某账号：
  ```sql
  UPDATE users SET status='active', risk_score=0,
    is_shadow_banned=false, shadow_ban_until=NULL,
    restricted_until=NULL
    WHERE id='<user_id>';
  UPDATE ban_records SET revoked_at=NOW(),
    revoke_reason='误封手动撤销'
    WHERE target_type='user' AND target_id='<user_id>' AND revoked_at IS NULL;
  ```
- 全量回滚代码：`git revert <phase3-commit>` + Supabase 上执行 phase3 sql 头部注释里的 DROP 语句
