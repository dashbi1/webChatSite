# Phase 2 手动测试清单（用户验收用）

> 前置：Phase 1 已上线且 `phase1-MANUAL-TEST.md` 全部勾完。
> Phase 2 新增：指纹采集、规则引擎、12 条默认规则、管理员后台风控管理页。
> 全部勾完后方可进入 Phase 3。

---

## 0. 数据库迁移（Supabase Dashboard → SQL Editor）

- [ ] 粘贴运行 `database/migrations/anti_abuse_phase2.sql`
- [ ] 验证表结构：
  ```sql
  SELECT COUNT(*) FROM fingerprints; -- 0（新表）
  SELECT COUNT(*) FROM risk_rules;   -- 12
  SELECT code, enabled, score FROM risk_rules ORDER BY category, code;
  -- APK_SIGNATURE_FAIL 应 enabled=false（其他 11 条 enabled=true）
  ```

---

## 1. 部署 + PM2 重启

在本地：
- [ ] `./deploy-to-vps.sh`（部署新版后端 + 前端）

在 VPS：
- [ ] `cd /opt/hit-circle/server && sudo npm install --omit=dev`
- [ ] `sudo pm2 restart hit-circle`
- [ ] `pm2 logs hit-circle --lines 30 --nostream` 应看到：
  ```
  [supabase] Production/NO_PROXY mode ...
  工大圈子后端服务启动: http://localhost:3000
  [disposable] loaded XXXX domains
  [cron] 2 tasks scheduled     ← Phase 2 加了 updateAccountCounts
  ```
- [ ] 无 `Cannot find module` / `supabaseUrl is required` 等错误

---

## 2. 前端指纹采集

- [ ] 打开 `https://www.agent666.xyz/#/pages/login/index`
- [ ] F12 Network → 任意请求 → 查看 Request Headers：
  - [ ] 有 `X-Device-Fingerprint: <64位hash>`
  - [ ] 有 `X-Device-Info: <base64 JSON>`
- [ ] F12 Console：解码 X-Device-Info 应看到 `{ userAgent, timezone, canvas: 'present', webgl: 'present', ... }`
- [ ] 刷新页面后 hash **稳定不变**（FingerprintJS 缓存正确）
- [ ] 无痕模式开新窗口 → hash **不同**（说明指纹区分不同浏览器 profile）

---

## 3. 风控规则触发（在 OBSERVE 模式下观察，不会降权）

### 前置：把系统先切到 observe 模式方便验证
- [ ] 管理员登录后台 `https://www.agent666.xyz/console-k8m2x7/`
  - 账号：用你的管理员邮箱登录（Phase 2 登录表单已改为 email）
- [ ] 左侧选 "风控管理"
- [ ] 点 "切到 OBSERVE"（确认框）

### 测试规则触发（全部检查 observe 模式下 risk_events 表是否有记录）

在 Supabase SQL Editor 运行：
```sql
SELECT rule_code, mode, score_delta, evidence, created_at
FROM risk_events
ORDER BY created_at DESC
LIMIT 20;
```

逐条规则验证：

#### 3.1 REGISTER_QUICK_POST（注册后 < 5 分钟发首帖 +5）
- [ ] 注册新账号 `test1@gmail.com`，立即登录发一条帖子
- [ ] 查 risk_events 应有 `REGISTER_QUICK_POST` 记录 + `evidence.registered_min_ago < 5`

#### 3.2 NEW_ACCOUNT_BURST（24h 内发帖 > 5 条 +10）
- [ ] 同一账号连续发 6 条帖子
- [ ] 第 6 条触发 `NEW_ACCOUNT_BURST`

#### 3.3 SIMHASH_SIMILAR（与 24h 内其他新号帖子相似 +15）
- [ ] 注册 A、B 两个新账号
- [ ] A 发 `"今天天气真好我很开心"`
- [ ] B 发 `"今天天气真好我很开心啊"`（相似）
- [ ] B 的帖子应触发 `SIMHASH_SIMILAR` + `evidence.simhash_distance < 3`

#### 3.4 DEVICE_MULTI_ACCOUNT（同设备 ≥ 3 账号 +25）
- [ ] 用同一浏览器（同指纹）连续注册 3 个账号
- [ ] 第 3 个账号注册时触发 `DEVICE_MULTI_ACCOUNT`
  - 第 4 个会被 Phase 1 限流拒掉

#### 3.5 IP_CIDR24_BURST（同 /24 1h 内 ≥ 5 注册 +30）
- [ ] 较难在家中复现，跳过。后续发现时看日志即可。

#### 3.6 ASN_DATACENTER（机房 IP +25）
- [ ] 用 DigitalOcean/Vultr 的 VPS 走 curl 模拟注册（需要 bypass Turnstile）
- [ ] 跳过可选

#### 3.7 COLD_EMAIL_DOMAIN（冷门域名 +10）
- [ ] 用 `someone@random.xyz` 注册（非白名单、非 edu）
- [ ] 风险事件应有 `COLD_EMAIL_DOMAIN`

#### 3.8 DEFAULT_PROFILE（默认头像 + 默认昵称 +5）
- [ ] 注册时不填昵称，不设头像（代码生成 "用户xxx" 格式）
- [ ] 风险事件应有 `DEFAULT_PROFILE`

#### 3.9 APK_SIGNATURE_FAIL（初始 enabled=false）
- [ ] Phase 2 阶段此规则**默认禁用**，跳过测试
- [ ] 后续发布带签名的 APK 后，在管理员后台启用此规则再测

#### 3.10 EMULATOR_OR_ROOT（模拟器/root +25）
- [ ] 浏览器端不触发（仅 APK）
- [ ] APK 版暂时未发，跳过

#### 3.11 NO_FINGERPRINT（缺失指纹 +5）
- [ ] F12 Network → 右键某个 API 请求 → "Replay XHR" → 修改为删除 `X-Device-Fingerprint` 后重发
- [ ] 或者用 curl 直接发（不带此 header）：
  ```bash
  curl -X POST https://www.agent666.xyz/api/posts \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"content":"test"}'
  ```
- [ ] 风险事件应有 `NO_FINGERPRINT`

---

## 4. 管理员后台风控管理

登录管理员后台 → 侧边栏 "风控管理"：

### 4.1 全局开关
- [ ] 上方显示当前模式（橙色 OBSERVE / 红色 ENFORCE）
- [ ] 点击切换按钮 → 弹确认框 → 确认后模式切换
- [ ] 再次切换应生效（`system_config.risk_enforcement_mode` 已更新）

### 4.2 规则配置（子 tab）
- [ ] 默认显示 12 条规则，按分类分组
- [ ] APK_SIGNATURE_FAIL 的 "启用" 开关应为**关闭**状态
- [ ] 勾选某条规则的 "启用" 开关 → 自动保存（查 DB: `risk_rules` 对应行 enabled 变化）
- [ ] 修改某条规则的 score → 点 "保存分值" → 查 DB 对应行 score 变化
- [ ] score 超过 100 → 弹错误 toast "score 必须在 0-100 之间"

### 4.3 规则审计
- [ ] 切到 "规则审计" tab
- [ ] 看到刚才的变更记录，含 `before_value` / `after_value` / 操作者

### 4.4 最近事件
- [ ] 切到 "最近事件" tab
- [ ] 看到你 Step 3 手动测试时触发的 risk_events 列表
- [ ] 过滤 mode='observe' → 只显示观察模式的事件
- [ ] 过滤 rule_code='REGISTER_QUICK_POST' → 只显示该规则触发

### 4.5 触发统计
- [ ] 切到 "触发统计" tab
- [ ] 选择时间窗口（1h / 24h / 7天）
- [ ] 表格应按 count 降序排列（最多命中的规则在最上）

---

## 5. 模式切到 ENFORCE，验证实际降权

**警告：切 ENFORCE 后，达到阈值的账号会被真降权/冻结/封禁**

- [ ] 管理员后台切 ENFORCE 模式
- [ ] 手动把测试账号 risk_score 设为 40（触发降权档）：
  ```sql
  -- 注意：prevent_risk_field_mutation trigger 只对 JWT 用户端阻拦，
  -- service_role_key 和直连 DB 都能改
  UPDATE users SET risk_score = 40 WHERE email = 'your-test@gmail.com';
  ```
- [ ] 用该账号登录发帖——Phase 2 期间尚无 shadow ban 执行逻辑（Phase 3 才做）
- [ ] 本阶段只验证 risk_score 能被规则推高，**真正 shadow ban/冻结/封禁是 Phase 3 的事**
- [ ] 把 risk_score 恢复：
  ```sql
  UPDATE users SET risk_score = 0, last_risk_event_at = NULL WHERE email = 'your-test@gmail.com';
  ```

---

## 6. Cron 任务

- [ ] 手动触发 updateAccountCounts：
  ```bash
  ssh vps
  cd /opt/hit-circle/server
  sudo node -e "require('./src/cron/updateAccountCounts').updateAccountCounts().then(()=>console.log('done'))"
  ```
- [ ] 应输出 `[cron:updateAccountCounts] updated X fingerprints` 和 `X ip_records`
- [ ] 查 DB 验证：
  ```sql
  SELECT account_count, fingerprint_hash FROM fingerprints ORDER BY account_count DESC LIMIT 5;
  SELECT account_count, ip_address FROM ip_records ORDER BY account_count DESC LIMIT 5;
  ```

---

## 7. 回归测试（保证 Phase 1 功能未被破坏）

- [ ] 注册新用户走 Turnstile → 正常
- [ ] 发送验证码 IP 限流 → 正常
- [ ] 一次性邮箱 `test@mailinator.com` 被拒 → 正常
- [ ] edu.cn 邮箱白名单 → 正常通过
- [ ] 真实 IP 解析 → pm2 日志里 IP 是真实客户端 IP

---

## 8. 白名单豁免验证

- [ ] 用 `student@hit.edu.cn` 注册并连续触发多条规则（发帖 × 6）
- [ ] risk_events 会记录，但查 `users.risk_score` 应 < 85
- [ ] 即使分数 >= 85，白名单邮箱不会被自动封（Phase 3 实际执行层检查白名单）

---

## 完成判定

全部勾完即可进入 **Phase 3（降权执行 + 账号簇 + 批量封 + 申诉）**。

如果某条不通过：
1. 先查 `pm2 logs hit-circle --lines 100 --nostream` 看后端异常
2. 检查 `system_config.risk_enforcement_mode` 是否符合预期（observe 模式下 users.risk_score 不会变）
3. 检查对应规则 `enabled=true`

---

## 9. Phase 2 交付清单

| 组件 | 位置 |
|------|------|
| DB 迁移 | `database/migrations/anti_abuse_phase2.sql` |
| 风控引擎 | `server/src/services/riskEngine/` |
| 12 规则 | `server/src/services/riskEngine/rules/*.js` |
| Simhash | `server/src/services/simhash/index.js` |
| 指纹记录 | `server/src/services/fingerprint/recordFingerprint.js` |
| IP 记录+ASN | `server/src/services/ip/{recordIp,enrichIp}.js` |
| APK 签名校验 | `server/src/middleware/apkSignature.js` |
| 规则评估助手 | `server/src/services/riskEngine/triggerAsync.js` |
| 路由集成 | `server/src/routes/{auth,posts}.js` |
| Cron | `server/src/cron/updateAccountCounts.js` |
| 管理员 API | `server/src/routes/adminRisk.js` |
| 管理员 UI | `server/admin/index.html` 新增"风控管理"tab |
| 前端指纹采集 | `client/src/utils/fingerprint.js` + `client/src/api/request.js` |
| 测试 | `server/tests/anti-abuse/phase2/` |

测试：**192 passed**（Phase 1 的 72 + Phase 2 的 120）
