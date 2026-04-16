# Phase 3 实施 Plan（马尔可夫式自包含）

> 本文档是 Phase 3 编码阶段的落地契约。读本文即可得到完整背景，无需回溯对话历史。
> 对齐对象：[06-phase3-enforcement.md](./06-phase3-enforcement.md) + [03-architecture.md](./03-architecture.md) + 实际仓库状态。

---

## 0. 背景与前置状态

- 项目：工大圈子（hit-circle）uni-app + Express + Supabase PG
- 当前 HEAD：`d4f8e7b`（Phase 2 已上线，代码干净）
- Phase 1 / Phase 2 已完成：真实 IP / 限流 / Turnstile / 邮箱黑名单 / 指纹采集 / 12 条规则 / 评分引擎 / `system_config` 基础设施 / admin 风控管理页（规则 + 全局开关 + 审计 + 事件）
- 已有数据表：`system_config`（含 `risk_enforcement_mode` / `appeals_enabled` / `shadow_ban_sample_rate` seed）、`users` 加列（`risk_score` / `restricted_until` / `is_shadow_banned` / `shadow_ban_until`）、`fingerprints` / `user_fingerprints` / `ip_records` / `user_ips` / `risk_rules` / `risk_rule_audit` / `risk_events`
- 已有服务：`services/config/systemConfig.js`（10s 缓存）、`services/riskEngine/ruleCache`、`triggerAsync`
- 已有中间件：`auth`、`apkSignature`、`fingerprintRecorder`、`rateLimit`、`riskEvaluator`、`turnstile`
- Admin 管理页：单 HTML `server/admin/index.html`（Vue3 CDN + inline），已有"风控管理"子页

### 关键仓库偏差（与 06-phase3 文档差异）
- `routes/comments.js` / `routes/likes.js` / `routes/friendships.js` 都**不存在**：评论/点赞内嵌在 `routes/posts.js` 子路由（`POST /:id/comments` / `POST /:id/like`），好友请求在 `routes/friends.js`
- `routes/messages.js` 存在；WebSocket 发消息在 `socket/chatHandler.js`
- client 端**无 stores 目录**（没用 pinia），用户信息用 `uni.getStorageSync('user')` 存；因此不引入 stores，改为在 `RiskBanner` 组件中直接从 `/api/users/me` 或 login 后写入 storage 的 `user.restricted_until` 字段中读

---

## 1. 交付物清单（必须全部完成）

### 1.1 数据库（database/migrations/anti_abuse_phase3.sql）
- [ ] 新表：`ban_records` / `account_clusters` / `appeals`
- [ ] `posts` / `comments` 加 `shadow_ban BOOLEAN DEFAULT FALSE` + 索引
- [ ] RPC 函数：
  - `get_timeline_posts(current_user_id, p_limit, p_offset)` — shadow 过滤
  - `get_post_comments_visible(post_id, current_user_id, p_limit, p_offset)` — shadow 过滤评论
  - `list_fingerprint_clusters(p_min_accounts, p_limit)`
  - `list_ip_cidr24_clusters(p_min_accounts, p_limit)`
  - `find_burst_ip_cidr24(p_window_hours, p_min)`
  - `users_same_ip_within_hours(p_ip, p_hours)`
  - `users_by_fingerprint_cluster(p_fingerprint_id)`
- [ ] 统一在 `BEGIN;` / `COMMIT;` 中，包含 rollback 注释

### 1.2 后端服务层（server/src/services/）
- [ ] `enforcement/applyEnforcement.js` — 根据 `risk_score` + 白名单域名 → 更新 users 状态；返回 {score, level, enforced}；observe 模式只记录不修改 DB
- [ ] `enforcement/shadowBan.js` — `shouldShadowPost(user, sampleRate)` 抽样函数
- [ ] `enforcement/banRecord.js` — `createBanRecord(targetType, targetId, banType, reason, options)`；级联：target_type=user 时设 users.status='banned'
- [ ] `cluster/fingerprintCluster.js` — `listFingerprintClusters({minAccounts, limit})`
- [ ] `cluster/ipCluster.js` — `listIpClusters({minAccounts, windowHours, limit})`
- [ ] `cluster/index.js` — 统一出口 `listClusters({type})`
- [ ] `appeals/appealService.js` — `submitAppeal(userId, dto)` / `getUserAppeals(userId)` / `listPending()` / `resolveAppeal(id, adminId, status, note)`；feature flag + 7 天 3 次限流

### 1.3 后端中间件
- [ ] `middleware/riskEnforcer.js` — 按 req.user 拉最新 users 风控字段，挂到 req.user；banned → 403 BANNED；frozen + 冻结动作 → 403 UNDER_REVIEW；observe 模式下跳过拦截但记 log
- [ ] `middleware/shadowBanFilter.js` — 导出 `applyShadowFilter(list, currentUserId)` 纯函数（备用，首选走 SQL RPC 过滤）

### 1.4 后端路由
- [ ] `routes/appeals.js` — 用户侧 `POST /api/appeals` / `GET /api/appeals/my`
- [ ] `routes/admin/clusters.js` — `GET /api/admin/clusters?type=fingerprint|ip_cidr24`
- [ ] `routes/admin/bulkBan.js` — `POST /api/admin/bulk-ban/preview` + `/execute`；支持 mode=score_gt / same_ip_recent / keyword / cluster_fingerprint
- [ ] `routes/admin/appeals.js` — `GET /api/admin/appeals` / `POST /:id/resolve`
- [ ] `routes/admin/riskEvents.js` — `GET /api/admin/risk-events`（当前 adminRisk.js 里可能已有，此处确认/重构）

### 1.5 app.js 挂载
- [ ] 挂载 `/api/appeals`、`/api/admin/clusters`、`/api/admin/bulk-ban`、`/api/admin/appeals`、`/api/admin/risk-events`
- [ ] 全局不挂 riskEnforcer（按路由精确挂到需要冻结检查的关键动作）

### 1.6 修改现有路由（集成 shadow / frozen）
- [ ] `routes/posts.js`：
  - `POST /` 发帖：riskEnforcer 检查 frozen → 拒；写 `shadow_ban` 字段（按 `req.user.isShadowBanned` + `shadow_ban_sample_rate` 抽样）
  - `GET /` timeline：改用 `get_timeline_posts` RPC（shadow 过滤）
  - `POST /:id/comments` 评论：同发帖，frozen 拒 + shadow 写字段
  - `GET /:id/comments`：改用 `get_post_comments_visible` RPC
  - `POST /:id/like` 点赞：riskEnforcer 检查 frozen → 拒；shadow 用户点赞**不写 likes 表 + 不调 increment_like_count**（即对外不可见，对自己 is_liked=false）
- [ ] `routes/friends.js` 好友请求：frozen 拒
- [ ] `routes/messages.js` 发私聊：frozen 拒
- [ ] `socket/chatHandler.js` WebSocket 发消息：frozen 拒（发 error event）

### 1.7 Cron
- [ ] `cron/ipBurstCheck.js` — 每 10 分钟检查 1h 内 /24 段注册 ≥ 5 的 IP；写 `ban_records(target_type='ip')` + `ip_records.is_banned=true`；避免重复写同一段
- [ ] `cron/index.js` 注册 `ipBurstCheck`（表达式 `*/10 * * * *`）

### 1.8 前端（uni-app / client）
- [ ] `client/src/api/appeals.js` — submitAppeal / getMyAppeals
- [ ] `client/src/api/request.js` — 拦截响应中 `code === 'UNDER_REVIEW' | 'COMING_SOON' | 'FROZEN_WS'` 弹 toast
- [ ] `client/src/components/RiskBanner.vue` — 读 user.restricted_until / is_shadow_banned，显示冻结条；挂在 index.vue 顶部
- [ ] `client/src/pages/appeals/index.vue` — 申诉表单 + 历史列表
- [ ] `client/src/pages.json` — 注册 `pages/appeals/index`
- [ ] `client/src/pages/index/index.vue` — 挂 `<RiskBanner />`
- [ ] `client/src/api/auth.js`（若需要）— login 成功后把 restricted_until 等字段写入 storage

### 1.9 Admin 后台（server/admin/index.html）
**单文件 Vue3 页面扩展，按现有"风控管理"风格延伸 Tab**：
- [ ] 导航增加：`账号簇` / `批量封禁` / `申诉处理`（风险事件日志 + 全局开关已在"风控管理"里）
- [ ] 账号簇页：下拉切换"按指纹/按 IP 段"，列表展示，"一键封整簇"带预览确认
- [ ] 批量封禁页：四种模式选择（score_gt / same_ip_recent / keyword / cluster_fingerprint），参数输入 + 预览 + 确认执行
- [ ] 申诉处理页：pending 列表，approve/reject 操作

### 1.10 测试
**单元测试（mock 纯逻辑）**：
- [ ] `tests/anti-abuse/phase3/unit/applyEnforcement.test.js` — 分段映射 + 白名单豁免 + observe 模式
- [ ] `tests/anti-abuse/phase3/unit/shadowBan.test.js` — `shouldShadowPost` 抽样率正确（采样 10k 次误差 < 3%）
- [ ] `tests/anti-abuse/phase3/unit/appealService.test.js` — feature flag 关时 503、开时入库、7 天 3 次限流
- [ ] `tests/anti-abuse/phase3/unit/banRecord.test.js` — user 级联 status=banned；带 expires_at

**集成测试（supertest + mock supabase，风格对齐 phase2/adminRisk.integration.test.js）**：
- [ ] `tests/anti-abuse/phase3/integration/riskEnforcer.integration.test.js` — banned → 403 BANNED；frozen + POST /api/posts → 403 UNDER_REVIEW；正常 → 200
- [ ] `tests/anti-abuse/phase3/integration/appeals.integration.test.js` — feature flag 关/开、限流、my 列表
- [ ] `tests/anti-abuse/phase3/integration/bulkBan.integration.test.js` — preview 返回候选、execute 调用 update + 写 ban_records
- [ ] `tests/anti-abuse/phase3/integration/clusters.integration.test.js` — type=fingerprint / ip_cidr24 RPC 调用正确

### 1.11 手动测试清单
- [ ] `docs/anti-abuse/phase3-MANUAL-TEST.md` — 覆盖 shadow / 冻结 / 封禁 / 白名单豁免 / 账号簇视图 / 批量封 / 申诉 / 全局开关 / 回归测试

### 1.12 package.json 脚本
- [ ] 增加 `test:abuse:phase3`

---

## 2. 关键决策点（编码时遵循）

### 2.1 Observe vs Enforce 模式
- 读 `system_config.risk_enforcement_mode`（默认 `"enforce"`）
- `applyEnforcement`：observe 模式下不修改 users 的状态字段，只在 risk_events 表里记 mode='observe'
- `riskEnforcer` 中间件：observe 模式下不拦截请求（但把 req.user.isFrozen / isShadowBanned 等信息挂上，供路由层选择是否"测试性"拒绝）→ **结论：observe 时中间件完全放行**（路由层也不再做额外拦截）

### 2.2 Shadow Ban 抽样
- 读 `system_config.shadow_ban_sample_rate`（默认 `0.5`）
- 仅影响**发帖 / 发评论 / 点赞**；好友申请 / 私聊不 shadow（走 frozen 路径）
- 点赞 shadow：**不写 likes 表 + 不调 increment_like_count**，返回 `{ liked: true }` 假装成功（用户无感）

### 2.3 白名单邮箱豁免自动封
- 复用现有 `services/whitelist/emailDomains.js` 的 `isWhitelistedDomain(email)`
- `applyEnforcement`：score >= 85 且 isWhitelist → 不写 banned，但 push 到 account_clusters.status='pending' 供管理员审核（单行 evidence）

### 2.4 JWT 过期策略
- 用户被封后，下次携带旧 JWT 的请求：`riskEnforcer` 从 DB 读到 status='banned' → 403 BANNED，客户端 request.js 拦截清 token
- 不额外实现 JWT 黑名单

### 2.5 observe 模式下的 ban_records
- 不写（避免误伤）；所有封禁相关操作仅在 enforce 模式生效

### 2.6 IP Burst Cron
- 避免重复封：判 `ip_records.is_banned=true AND banned_until > now()` 跳过
- 幂等：插入 ban_records 前检查活跃记录
- 注意：phase3 cron 仅**记录**；实际拒绝请求留给 phase4（当前 rateLimit 可以扩展读取 `ip_records.is_banned`，但此处不改以保持变更面最小）

### 2.7 appeals_enabled feature flag
- `POST /api/appeals` 在 flag=false 时返回 503 `code=COMING_SOON`
- `GET /api/appeals/my` 无论 flag 都可用（方便用户查看历史）
- admin 审核接口始终可用

### 2.8 `node-cron` 导入
- `const cron = require('node-cron')`；已在 `cron/index.js` 用过

### 2.9 测试不依赖真实 Supabase
- 所有 phase3 自动化测试用 mock，参照 `tests/anti-abuse/phase2/integration/adminRisk.integration.test.js` 风格

---

## 3. 实施顺序（严格按序）

1. plan（本文件）✅
2. SQL 迁移
3. 服务层（enforcement + cluster + appeals）
4. 中间件（riskEnforcer）
5. 路由新建（appeals + admin/*）
6. app.js 挂载 + 现有路由集成
7. Cron
8. 前端 UI
9. Admin 后台 HTML
10. 单元测试
11. 集成测试
12. 手动测试清单
13. 跑测试 + lint 验证
14. 提交 commit

---

## 4. 完成判定

- 所有自动化测试 `npm run test:abuse:phase3` 通过
- `node --check` 对所有新建/修改的 .js 文件通过语法校验
- 手动测试清单文件已产出（等用户在 VPS 上实际勾选）
- commit 消息：`feat(anti-abuse-phase3): enforcement + clusters + bulk ban + appeals skeleton`

---

## 5. 回滚策略

- SQL：迁移文件头部注释包含 DROP 语句，应急时反向执行
- 代码：单 commit 内完成，`git revert` 可一键撤回
- 运行时：管理员后台切 observe 模式，所有降权/封禁动作立刻停止生效
