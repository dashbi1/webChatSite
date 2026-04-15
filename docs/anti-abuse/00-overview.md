# 00 — 反滥用系统总览

> **马尔可夫式文档**：阅读本文即可获得完整决策背景，无需回溯对话历史。

---

## 1. 项目背景

**工大圈子**（hit-circle）是一个以学校社区为核心的社交应用：

- 用户规模：日活 ~100 人（小规模但设计面向黑产级威胁）
- 前端：uni-app（H5 + Capacitor 打包 Android APK）
- 后端：Node.js + Express + Supabase PG
- 部署：VPS（日本）+ Cloudflare Free（支持 ip / cloudflare / cloudflare-split 三种模式）
- 认证：**邮箱 + 密码 + Resend 验证码**（2026-04 刚从手机号改造完成）

管理员（用户 `dashbi`）希望**未雨绸缪**防止未来被专业化黑产盯上，同时保证上线即有效。

---

## 2. 威胁模型

### 2.1 威胁优先级（管理员确认）

- 🔴 **P0**：防批量注册占位
- 🟡 **P1（平行）**：
  - 批量发帖灌水
  - 批量点赞互吹
  - 批量恶意举报攻击

### 2.2 攻击手段 → 对应防御（完整映射）

| 攻击手段 | 对应防御 |
|----------|----------|
| 脚本批量注册 | Turnstile 人机验证 + IP/邮箱/设备三层限流 + 一次性邮箱黑名单 |
| 重签名 APK 绕风控 | APK 签名 SHA256 白名单 + HMAC 强校验 |
| 秒拨 IP / 代理 / 机房 IP | ASN 机房识别（ip-api.com 免费版）+ IP 段注册频率限流 |
| 改机软件改指纹 | 激进组合浏览器指纹 + Capacitor 原生采集 + 设备级封禁 |
| 接码平台买邮箱 | 冷门域名加风险分 + 行为后置识别 |
| 脚本发相似文案 | Simhash 新号文案相似度检测 |
| 互关互赞养号 | 孤岛簇聚类检测（cron）+ shadow ban |
| 秒注册秒发帖 | 注册后 N 分钟首帖加风险分 |
| 批量举报 | 举报者风险分过滤 + 举报可信度加权 |

### 2.3 散户 vs 职业黑产 应对差异

| 维度 | 散户 | 职业黑产 |
|------|------|----------|
| 邮箱 | 自己注册 gmail 几个 | 接码平台批量购买 |
| IP | 自家 WiFi | 秒拨 / 代理 / 机房 IP |
| 设备 | 同一手机 / 同一电脑 | 改机软件每次新指纹 |
| 行为 | 手动节奏随机 | **脚本时间规律 + 文案相似**（最稳的识别信号）|
| 核心防御 | 限流 + 指纹 | **行为聚类 + Shadow Ban + 蜜罐** |

**关键洞察**：职业黑产最难伪装的是**行为模式**。指纹可改、IP 可换、邮箱可买，但脚本集中发高相似内容逃不过 simhash 检测。

---

## 3. 当前系统现状（改造起点）

### 3.1 已有结构
- `users` 表：仅 `status = 'active' | 'banned'` 二元状态，无风险分、无指纹关联
- `email_verifications` 表：仅**同邮箱 60 秒冷却**
- `auth.js` 路由：**完全未使用 `req.ip`**，没有 IP/设备限流
- `reports` 举报表：已有（Phase 4 可复用）
- Nginx：已配 `real_ip`（CF 模式 → `CF-Connecting-IP` 映射到 `X-Real-IP`）
- PM2 生态：ecosystem.config.js 已启用
- Supabase RLS：基础策略已有但**风险字段未受保护**（Phase 1 新增策略）

### 3.2 明确的技术栈约束
- 无 Redis（VPS 不装 Redis 服务）→ **采用 Upstash Redis Cloud 免费版**（日本区）
- CF Free 级别 → **可用 Turnstile、WAF Rate Limiting 免费版**
- 单 admin 角色（不引入 super_admin）
- VPS 在日本 → Upstash 选日本 / 韩国 / 新加坡区

### 3.3 Supabase 所在区域
- 美国区（远离 VPS）→ 数据库查询有约 150ms 延迟。风控相关热数据应能在 Redis 层命中（避免每请求都打 Supabase）。

---

## 4. 完整决策摘要（40+ 对齐点）

### A. 规模与威胁优先级
- **A1** 日活规模：~100 人（小规模但设计面向黑产级）
- **A2** 主要假想敌：职业黑产矩阵
- **A3** 威胁优先级：批量注册 > [批量发帖 / 批量点赞 / 批量举报]
- **A4** 未来策略：一旦发现被盯上，**只调参数 + 升级安全套餐**，不改架构

### B. 技术选型
- **B1** 限流：Upstash Redis（日本区，免费版 10k 命令/天）
- **B2** 人机验证：Cloudflare Turnstile Free
- **B3** 浏览器指纹：FingerprintJS Open Source（MIT）
- **B4** APK 指纹：**Capacitor 自定义插件**（~100 行 Kotlin，读签名 + 设备信息）
- **B5** IP 风险分析：ip-api.com 免费版（ASN、机房、国家）
- **B6** 数据存储：Supabase PG 现有实例

### C. 风险分层级（四档全自动）
- **C1** `0-40` **正常**：无动作
- **C2** `40-70` **降权**：自动触发 shadow ban（帖子/评论/点赞）+ 发帖冷却拉长 + 不给推荐位，**不通知用户**
- **C3** `70-85` **冻结**：自动触发"待审核"状态，能登录看内容但不能发帖/私聊，**前端 banner + 点击动作 toast 提示"账号审核中"**，管理员复核队列
- **C4** `85+` **封禁**：自动 `status='banned'`，进入管理员审核队列供撤销

**冻结状态解除方式**：A+B 都支持（管理员手动解冻 OR 风险分衰减到 < 70）

### D. 观察/强制模式（全局开关）
- **D1** **默认 enforce 模式**（上线首日即生效）
- **D2** 管理员后台可一键切 observe 模式（降权+封禁动作被跳过，只记风险事件）
- **D3** 存 `system_config.risk_enforcement_mode` 字段

### E. 规则引擎（12 条默认规则）
- **E1** 管理员后台可**启用/禁用**每条规则
- **E2** 管理员后台可**修改分值**（阈值参数先锁死，不开放）
- **E3** 规则改动通过 Node 内存缓存（**10 分钟 TTL**）热生效，无需重启
- **E4** 所有规则变更写 `risk_rule_audit` 表
- **E5** 12 条默认规则详见 [02-rules-and-scoring.md](./02-rules-and-scoring.md)

### F. Shadow Ban 覆盖范围（40-70 降权档自动触发）
- **F1** ✅ 发的帖子别人刷不到（自己可见）
- **F2** ✅ 发的评论别人看不到（自己可见）
- **F3** ✅ 点赞不计数（对方数字不变）
- **F4** ❌ 好友申请、私聊、举报**不 shadow**（这些只在 70-85 冻结档禁用）

### G. 封禁策略
- **G1** 层级：账号级、设备级、IP 级（短临时 15 分钟 / 长期 30 天）
- **G2** **邮箱白名单永不封**：`gmail.com` / `outlook.com` / `hotmail.com` / `qq.com` / `163.com` / `126.com` / `foxmail.com` / `sina.com` / `yahoo.com` + `*.edu` + `*.edu.cn`
- **G3** 邮箱黑名单：`disposable-email-domains/v1` GitHub 社区库（每日 cron 拉取）
- **G4** 自动设备封：命中 ≥3 个账号且其中有账号被封 → **设备封 30 天**
- **G5** 自动 IP 封：1h 内 /24 段注册 ≥5 → **临时封 15 分钟**（避免误伤学校 NAT）
- **G6** 账号永久封：**不自动解除**，只能通过申诉解封

### H. 降分机制（防误封 + 防养号）
- **H1** **时间衰减**：每 7 天 ×0.9，下限 0 分，cron 每日跑
- **H2** **正向行为奖励**：见 [02-rules-and-scoring.md](./02-rules-and-scoring.md) 的表
- **H3** **新号保护期**：注册 < 7 天账号，减分效果 × 30%（防黑产养号）
- **H4** **互动簇过滤**：减分事件校验"互动方不在同一风险簇"（防簇内互赞养号）
- **H5** **管理员手动 ±N**：支持，必写审计

### I. 指纹采集
- **I1** 浏览器激进组合：UA + 时区 + 语言 + 屏幕 + Canvas + WebGL + AudioContext + 字体 + 硬件并发
- **I2** APK 全采：android_id + 设备型号 + 系统版本 + 安装来源 + root 检测 + 模拟器检测 + APK 签名 SHA256
- **I3** 采集时机：**关键动作 6 个**（登录、注册、发帖、评论、私聊、点赞）
- **I4** 缺指纹策略：静默通过 **+5 分**（老用户缓慢补齐）
- **I5** APK 强校验：**签名 SHA256 白名单 + HMAC**，失败 +45 分（`X-App-Signature` header）
- **I6** 历史用户补齐：登录时**静默采集**，不影响体验

### J. 孤岛簇识别（cron 每小时）
- **J1** 簇内账号**全部 < 7 天**新号
- **J2** 簇内互动率（互关 + 互赞 + 互评）> **60%**
- **J3** 簇外互动数 < **3 次/人**
- **J4** 簇大小 ≥ **3 人**
- **J5** 四项全满足 → 判定"可疑孤岛簇"，加分 + 推送管理员后台

### K. Simhash 相似度
- **K1** 对比窗口：**24h 内所有 < 7 天新号**发的帖子
- **K2** 相似度阈值：simhash 距离 < 3（初值，压测后调）

### L. 申诉流程
- **L1** **Phase 3** 完成：申诉数据表 + 后端 API
- **L2** **Phase 3** 前端 UI 占位（按钮点击提示"功能开发中"）
- **L3** **Phase 4** 通过 `system_config.appeals_enabled` 开关热启用，无需重新打包前端
- **L4** 一账号 7 天最多申诉 **3 次**（防刷）
- **L5** 申诉通过 → 自动 -30 风险分 + 解封

### M. 管理员后台新增能力
- **M1** 账号簇视图（按指纹 / IP / 行为相似度分组）
- **M2** 一键封整个簇（带**预览确认**）
- **M3** 按"风险分 > X"批量筛选 + 封禁
- **M4** 按"最近 N 小时同 IP 注册"批量封
- **M5** 按"发帖内容关键词"批量封
- **M6** 规则启用/分值配置页
- **M7** observe / enforce 全局开关
- **M8** 申诉处理队列（Phase 3 起）
- **M9** 风险事件日志查询
- **M10** 手动 ±N 风险分（带审计）

### N. 限流具体参数
- **N1** 同 IP：每天最多 **3 个注册**，每分钟最多 **2 次验证码**
- **N2** 同邮箱：60 秒冷却（已有），每小时最多 **5 次验证码**（新增）
- **N3** 同设备指纹：每天最多 **3 个注册**

### O. Turnstile 触发点
- **O1** ✅ "发送验证码"按钮前（注册流程）
- **O2** ✅ "找回密码发送验证码"前
- **O3** ❌ 其他位置不加（登录 / 注册提交 / 发帖等）

### P. 真实 IP 解析（支持三种部署模式）
- **P1** Node 封装 `getClientIp(req)` 工具函数
- **P2** 优先级：`X-Real-IP` > `CF-Connecting-IP` > `req.ip` > `remoteAddress`
- **P3** 处理 IPv4-mapped IPv6 前缀（`::ffff:` 去除）
- **P4** Express 启用 `app.set('trust proxy', 1)`
- **P5** Nginx 层 `set_real_ip_from` 只信任 CF 官方 IP 段（防伪造）
- **P6** **安全说明**：如果攻击者绕过 CF 直连 VPS 并伪造 `CF-Connecting-IP`，Nginx 因为 `set_real_ip_from` 白名单不会把其作为真实 IP 传给 Node

### Q. APK 签名校验
- **Q1** 签名 SHA256 白名单：`.env` 的 `ALLOWED_APK_SIGNATURES`（逗号分隔）
- **Q2** HMAC 密钥：`.env` 的 `APK_HMAC_SECRET`（64 字节随机）
- **Q3** APK 端：BuildConfig 注入 HMAC 密钥（混淆嵌入，95% 攻击者劝退）
- **Q4** 校验逻辑：`HMAC(HMAC_SECRET, signature_sha256 + timestamp + user_id)` 放 `X-App-Signature` header
- **Q5** 失败策略：**仅 APK 请求**（检测到 `X-App-Signature` header）校验，失败 +45 分；H5 请求无此 header 跳过校验
- **Q6** release keystore 用 `keytool` 生成，SHA256 通过 `apksigner verify --print-certs` 或 `keytool -list -v` 提取

### R. 隐私合规
- **R1** 用户协议 + 隐私政策**必须更新**，新增"设备指纹用于反作弊"条款
- **R2** 注册流程新增勾选框（含链接到协议）
- **R3** Phase 1 完成

### S. 测试策略
- **S1** 单元测试（Jest）：评分引擎、IP 解析、HMAC 验签、simhash 相似度、规则热加载
- **S2** 集成测试（Jest + supertest）：API 限流、Turnstile 校验、降权行为、申诉接口
- **S3** E2E（Playwright）：3-5 条关键流（注册被限流、账号簇视图加载、shadow ban 表现）
- **S4** 手动测试：**每 phase 一份 `.md` 测试清单**，VPS 跑通方可进下一 phase
- **S5** 覆盖率目标：**80%+**

### T. Phase 分期
| Phase | 内容概述 | 预计工时 | 详情 |
|-------|----------|----------|------|
| Phase 1 | 真实 IP + 三层限流 + Turnstile + 邮箱黑名单 + 协议更新 | 3-4 天 | [04-phase1-infrastructure.md](./04-phase1-infrastructure.md) |
| Phase 2 | 指纹采集（浏览器+APK）+ 评分引擎 + 管理员规则后台 | 4-5 天 | [05-phase2-fingerprint-scoring.md](./05-phase2-fingerprint-scoring.md) |
| Phase 3 | 降权执行 + 账号簇视图 + 批量封 + 申诉后端/UI 占位 | 3-4 天 | [06-phase3-enforcement.md](./06-phase3-enforcement.md) |
| Phase 4 | 聚类 cron + 衰减 + 奖励 + 申诉 UI 启用 | 3-4 天 | [07-phase4-clustering-decay.md](./07-phase4-clustering-decay.md) |

---

## 5. 不在本方案范围内

- ❌ 手机号短信验证（已放弃，纯邮箱）
- ❌ 实名认证 / 付费验证
- ❌ 国际化语言（只中文）
- ❌ 短信验证码备份
- ❌ 生物特征采集（太复杂、隐私敏感）

---

## 6. 后续扩展（被盯上后升级路径）

如果未来**发现被职业黑产批量盯上**，以下是无需改架构的升级路径：
1. **CF 升级到 Pro**（$20/月）：启用 Bot Management、更严的 WAF 规则
2. **FingerprintJS 升级商业版**：精准度从 85% 提到 99.5%
3. **Upstash Redis 升级 Pay-as-you-go**：取消 10k 命令/天上限
4. **接入 IPQualityScore**：按次计费 $0.001，精准识别代理 / VPN / 机房
5. **把 observe/enforce 阈值调严**：降分阈值 40 → 25，冻结阈值 70 → 50
6. **强制 Turnstile 扩展到登录/发帖**：免费额度 100 万次/天够用
7. **Supabase 区域迁移**：从美国迁到日本（延迟 150ms → 20ms）

---

**下一步**：读 [01-database-schema.md](./01-database-schema.md) 了解完整数据表设计。
