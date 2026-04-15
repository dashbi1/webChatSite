# 反滥用与反批量化防御方案（Anti-Abuse System）

> 本目录包含**工大圈子**项目反滥用系统的完整设计方案。
> 文档采用**马尔可夫式**写作：新 session 进来只读本目录就能无损衔接，无需回溯对话历史。

---

## 设计目标

1. 防止**批量注册占位**（P0）
2. 防止**批量发帖灌水 / 批量点赞互吹 / 批量举报攻击**（P1，平行优先级）
3. 防止**职业灰产矩阵**：群控设备、秒拨 IP、接码平台、改机工具、Xposed hook
4. **默认启用、可应急切换**：上线即 enforce，管理员后台一键切 observe
5. **不误伤真实学校用户**：edu/edu.cn 永久白名单 + 新号保护期 + 误封可申诉

---

## 文档索引

| 文件 | 内容摘要 |
|------|----------|
| [00-overview.md](./00-overview.md) | 背景、威胁模型、完整决策摘要（40+ 对齐点） |
| [01-database-schema.md](./01-database-schema.md) | 数据表设计：14 张新表/列 + RLS 策略 |
| [02-rules-and-scoring.md](./02-rules-and-scoring.md) | 规则引擎、12 条默认规则、评分 / 衰减 / 奖励公式 |
| [03-architecture.md](./03-architecture.md) | 系统架构、请求流程、IP 解析、Cron 任务 |
| [04-phase1-infrastructure.md](./04-phase1-infrastructure.md) | **Phase 1**：真实 IP、限流、Turnstile、邮箱黑名单、协议更新 |
| [05-phase2-fingerprint-scoring.md](./05-phase2-fingerprint-scoring.md) | **Phase 2**：指纹采集、APK 强校验、评分引擎、规则后台 |
| [06-phase3-enforcement.md](./06-phase3-enforcement.md) | **Phase 3**：降权执行、账号簇、批量封、申诉框架 |
| [07-phase4-clustering-decay.md](./07-phase4-clustering-decay.md) | **Phase 4**：聚类、衰减、奖励、申诉 UI 启用 |
| [08-deployment.md](./08-deployment.md) | 部署步骤：Upstash / Turnstile / keystore / Nginx / CF |

---

## Phase 执行顺序

```
Phase 1 (3-4天)  →  Phase 2 (4-5天)  →  Phase 3 (3-4天)  →  Phase 4 (3-4天)
   ↓                    ↓                    ↓                    ↓
 测试通过            测试通过            测试通过            测试通过
   ↓                    ↓                    ↓                    ↓
 用户确认            用户确认            用户确认            用户确认
```

**每个 phase 结束必须跑完测试清单，用户手动确认后方可进入下一 phase**。

---

## 关键约束（实施前必读）

- **零额外 VPS 服务**：限流用 Upstash Redis Cloud（日本区域），人机验证用 CF Turnstile，都是云服务
- **默认启用风控**：`system_config.risk_enforcement_mode = 'enforce'`，管理员后台可一键切 observe
- **edu / edu.cn 永久白名单**：学校邮箱永远不被任何规则封禁（但可以降权观察）
- **三种部署模式全支持**：ip / cloudflare / cloudflare-split，统一走 `X-Real-IP`
- **APK 强校验只对 APK 请求生效**：浏览器 H5 无 `X-App-Signature` header 跳过
- **单 admin 角色**：不引入 super_admin
- **申诉先占位后热启用**：Phase 3 建好后端 + UI 占位，Phase 4 拉 feature flag 开启，不重新打包前端

---

## 关键技术栈

| 组件 | 方案 |
|------|------|
| 限流 | **Upstash Redis Cloud** 免费版（日本区，10k 命令/天）|
| 人机验证 | **Cloudflare Turnstile Free**（100 万次/天）|
| 浏览器指纹 | **FingerprintJS Open Source**（MIT 协议）|
| APK 指纹 | **Capacitor 自定义插件**（读签名 + 设备信息）|
| IP 风险分析 | **ip-api.com 免费版**（ASN + 机房识别）|
| 一次性邮箱库 | **disposable-email-domains**（GitHub 社区维护）|
| 数据存储 | Supabase PG（现有实例）|
| 规则引擎 | 数据库驱动 + Node 内存缓存（10 分钟 TTL）|

---

## 覆盖率目标

- 单元测试：**80%+**（Jest）
- 集成测试：**所有关键 API**（Jest + supertest）
- E2E 测试：**3-5 条关键流**（Playwright）
- 手动测试清单：**每 phase 一份 `.md`**（VPS 上跑过方可进下一 phase）

---

## 不在本方案范围内

- ❌ 手机号短信验证（已放弃，纯邮箱）
- ❌ 实名认证 / 付费验证
- ❌ 国际化（只中文）
- ❌ 生物特征

---

**下一步**：读 [00-overview.md](./00-overview.md) 理解完整决策背景。
