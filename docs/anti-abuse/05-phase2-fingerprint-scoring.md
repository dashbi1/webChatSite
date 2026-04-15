# 05 — Phase 2：指纹采集 + 评分引擎

> **工期预估**：4-5 天
> **目标**：采集浏览器 / APK 设备指纹，实施 APK 签名强校验，构建规则引擎与评分系统，管理员后台新增"规则配置"页。
> **结束标志**：手动测试清单全通过，用户确认后进入 Phase 3。

**本期不做**：实际的降权 / 封禁执行（那是 Phase 3 的事）。本期只产出"风险事件"和"风险分"。

---

## 1. 交付物

- 前端浏览器指纹采集（FingerprintJS Open Source）
- APK 自定义 Capacitor 插件（读签名 + 设备信息）
- axios 拦截器自动加 header
- 后端中间件：指纹 / IP 记录、APK 签名校验、规则引擎评估
- 12 条默认规则实现
- 规则缓存（10 分钟 TTL）
- 管理员后台"规则配置"页
- 数据表：fingerprints / user_fingerprints / ip_records / user_ips / risk_rules / risk_rule_audit / risk_events
- ip-api.com 集成（ASN / 机房识别）
- Cron：updateAccountCounts（每 30 分钟）
- 测试：单元 + 集成 + E2E + 手动清单
- 迁移脚本：`database/migrations/anti_abuse_phase2.sql`

---

## 2. 前置准备

- [ ] **生成 release keystore**（仅首次做）：
  ```bash
  keytool -genkey -v \
    -keystore hit-circle-release.keystore \
    -alias hit-circle \
    -keyalg RSA -keysize 2048 -validity 36500
  # 填密码和基本信息，**密码必须妥善保存**
  # keystore 文件**不要**提交到 git，放 1Password / 本地 encrypted drive
  ```
- [ ] **从 keystore 提取 SHA256 哈希**：
  ```bash
  keytool -list -v -keystore hit-circle-release.keystore -alias hit-circle
  # 输出里找 "SHA256:" 行，形如 "AB:CD:EF:..."
  # 去掉冒号转小写：abcdef...
  ```
- [ ] **生成 APK HMAC 密钥**：
  ```bash
  openssl rand -hex 32
  # 例如：a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
  ```
- [ ] `git checkout -b feat/anti-abuse-phase2`

---

## 3. 文件改动清单

### 3.1 新增文件

```
server/
├── src/
│   ├── middleware/
│   │   ├── apkSignature.js                # APK 签名 HMAC 校验
│   │   ├── fingerprintRecorder.js         # 采集指纹 / IP 记录
│   │   └── riskEvaluator.js               # 规则引擎触发
│   ├── services/
│   │   ├── riskEngine/
│   │   │   ├── index.js                   # 评估入口
│   │   │   ├── ruleCache.js               # 规则缓存
│   │   │   ├── scoreStore.js              # risk_score 读写 + 事件记录
│   │   │   └── rules/
│   │   │       ├── registerQuickPost.js
│   │   │       ├── newAccountBurst.js
│   │   │       ├── simhashSimilar.js
│   │   │       ├── deviceMultiAccount.js
│   │   │       ├── ipCidr24Burst.js
│   │   │       ├── asnDatacenter.js
│   │   │       ├── coldEmailDomain.js
│   │   │       ├── defaultProfile.js
│   │   │       ├── apkSignatureFail.js
│   │   │       ├── emulatorOrRoot.js
│   │   │       └── noFingerprint.js
│   │   ├── fingerprint/
│   │   │   └── recordFingerprint.js       # upsert fingerprints + user_fingerprints
│   │   ├── ip/
│   │   │   ├── recordIp.js                # upsert ip_records + user_ips
│   │   │   └── enrichIp.js                # 调 ip-api.com 补 ASN / 机房信息
│   │   └── simhash/
│   │       └── index.js                   # simhash 实现（可用现成库 simhash-js）
│   └── cron/
│       └── updateAccountCounts.js         # 每 30 分钟更新 fingerprints.account_count
├── admin/
│   └── risk-rules/                        # 规则配置页（静态 HTML + fetch API）
│       ├── index.html
│       └── rules.js
database/migrations/
└── anti_abuse_phase2.sql

client/
├── src/
│   ├── utils/
│   │   ├── fingerprint.js                 # FingerprintJS 封装
│   │   ├── apkSignature.js                # 调 Capacitor 插件生成 header
│   │   └── getPlatform.js                 # 判断 web / android
│   └── api/
│       └── request.js                     # axios 拦截器改造

client/android/app/src/main/java/com/hitcircle/plugins/
└── DeviceSignaturePlugin.kt               # Capacitor 自定义插件（Kotlin）
client/capacitor.config.json               # 注册插件
client/android/app/build.gradle            # BuildConfig 注入 APK_HMAC_SECRET

tests/
├── unit/
│   ├── riskEngine/
│   │   ├── registerQuickPost.test.js
│   │   ├── simhashSimilar.test.js
│   │   ├── deviceMultiAccount.test.js
│   │   ├── apkSignatureFail.test.js
│   │   └── (每条规则对应一个)
│   ├── ruleCache.test.js
│   ├── scoreStore.test.js
│   └── apkSignatureMiddleware.test.js
├── integration/
│   ├── fingerprintRecord.test.js
│   ├── riskEvaluate.test.js
│   └── adminRulesApi.test.js
└── e2e/
    └── phase2-admin-rules.spec.js
```

### 3.2 修改文件

```
server/
├── src/
│   ├── app.js                             # 挂载 fingerprintRecorder + riskEvaluator 中间件
│   └── routes/
│       ├── auth.js                        # register 触发指纹关联 + 规则评估
│       ├── posts.js                       # 发帖触发规则评估
│       ├── comments.js                    # 发评论
│       ├── messages.js                    # 私聊
│       └── admin/rules.js                 # 新增规则管理 API

client/
├── src/
│   ├── config/
│   │   └── env.js                         # 加 FP_CDN_URL（如需自托管）
│   ├── pages/
│   │   ├── register/index.vue             # 发送时带指纹 header
│   │   └── login/index.vue                # 同上
│   └── api/
│       └── request.js                     # axios 拦截器自动加 header

client/
├── package.json                           # 加 @fingerprintjs/fingerprintjs
├── android/app/build.gradle               # BuildConfig 注入 HMAC 密钥
```

---

## 4. 关键代码骨架

### 4.1 Capacitor 自定义插件（Kotlin）

```kotlin
// client/android/app/src/main/java/com/hitcircle/plugins/DeviceSignaturePlugin.kt
package com.hitcircle.plugins

import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@CapacitorPlugin(name = "DeviceSignature")
class DeviceSignaturePlugin : Plugin() {

    @PluginMethod
    fun getSignatureHeader(call: PluginCall) {
        val userId = call.getString("userId") ?: ""
        try {
            val sigSha256 = getApkSignatureSha256()
            val timestamp = (System.currentTimeMillis() / 1000).toString()
            val payload = "$sigSha256|$timestamp|$userId"
            val hmac = hmacSha256(BuildConfig.APK_HMAC_SECRET, payload)
            val result = JSObject()
            result.put("header", "$sigSha256|$timestamp|$hmac")
            result.put("sigSha256", sigSha256)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to generate signature: ${e.message}")
        }
    }

    @PluginMethod
    fun getDeviceInfo(call: PluginCall) {
        val result = JSObject()
        result.put("androidId",
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID))
        result.put("model", Build.MODEL)
        result.put("manufacturer", Build.MANUFACTURER)
        result.put("osVersion", Build.VERSION.SDK_INT)
        result.put("installer", getInstaller())
        result.put("isRooted", RootDetector.isDeviceRooted())
        result.put("isEmulator", EmulatorDetector.isEmulator(context))
        result.put("apkSigSha256", getApkSignatureSha256())
        call.resolve(result)
    }

    private fun getApkSignatureSha256(): String {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                    PackageManager.GET_SIGNING_CERTIFICATES
                    else PackageManager.GET_SIGNATURES
        val info = pm.getPackageInfo(context.packageName, flags)
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                         info.signingInfo.apkContentsSigners
                         else info.signatures
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(signatures[0].toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private fun hmacSha256(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return mac.doFinal(data.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private fun getInstaller(): String? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        else context.packageManager.getInstallerPackageName(context.packageName)
    }
}
```

### 4.2 BuildConfig 注入 HMAC 密钥

```gradle
// client/android/app/build.gradle
android {
  defaultConfig {
    // 从 gradle.properties 读取（gradle.properties 不进 git）
    buildConfigField "String", "APK_HMAC_SECRET", "\"${project.APK_HMAC_SECRET}\""
  }
}
```

```
# client/android/gradle.properties（**不要**提交到 git）
APK_HMAC_SECRET=a3f8b2c9e7d4f1a5b8c2e9f7d4a1b8c5e2f9d7a4b1c8e5f2d9a7b4c1e8f5d2a9
```

```
# client/android/gradle.properties.example（提交到 git，留空值）
APK_HMAC_SECRET=
```

### 4.3 前端指纹工具

```js
// client/src/utils/fingerprint.js
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { Capacitor } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

const DeviceSignature = registerPlugin('DeviceSignature');

let cache = null;

export async function getFingerprint(userId = null) {
  if (cache) return cache;
  const platform = Capacitor.getPlatform();  // 'web' | 'android' | 'ios'
  if (platform === 'android') {
    const info = await DeviceSignature.getDeviceInfo();
    const hash = await sha256(JSON.stringify(info));
    cache = {
      hash,
      platform: 'android',
      details: info,
    };
  } else {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    cache = {
      hash: result.visitorId,
      platform: 'web',
      details: simplifyComponents(result.components),
    };
  }
  return cache;
}

export async function getApkSignatureHeader(userId = null) {
  if (Capacitor.getPlatform() !== 'android') return null;
  const { header } = await DeviceSignature.getSignatureHeader({ userId: userId || '' });
  return header;
}

async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function simplifyComponents(components) {
  const keys = ['userAgent', 'language', 'timezone', 'screenResolution',
                'canvas', 'webgl', 'audio', 'fonts', 'hardwareConcurrency'];
  const out = {};
  for (const k of keys) if (components[k]) out[k] = components[k].value;
  return out;
}
```

### 4.4 axios 拦截器改造

```js
// client/src/api/request.js
import { getFingerprint, getApkSignatureHeader } from '@/utils/fingerprint';

axios.interceptors.request.use(async (config) => {
  try {
    const fp = await getFingerprint();
    config.headers['X-Device-Fingerprint'] = fp.hash;
    config.headers['X-Device-Info'] = btoa(unescape(encodeURIComponent(JSON.stringify(fp.details))));
    const userId = store.state.user?.id;
    const apkHeader = await getApkSignatureHeader(userId);
    if (apkHeader) config.headers['X-App-Signature'] = apkHeader;
  } catch (e) {
    console.warn('[fp] fingerprint collection failed:', e);
  }
  return config;
});
```

### 4.5 后端规则引擎入口

```js
// server/src/services/riskEngine/index.js
const { getRules } = require('./ruleCache');
const { addRiskEvent, applyScoreDelta } = require('./scoreStore');
const ruleImpls = require('./rules');  // 动态加载所有规则

async function evaluate({ user, action, context, req }) {
  const rules = await getRules();  // 从 cache 拿，10 分钟 TTL
  const results = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const impl = ruleImpls[rule.code];
    if (!impl) continue;
    try {
      const res = await impl.evaluate({ user, action, context, req, rule });
      if (res?.triggered) {
        results.push({
          rule_code: rule.code,
          score_delta: rule.score,
          evidence: res.evidence || {},
        });
      }
    } catch (e) {
      console.error(`[riskEngine] rule ${rule.code} error:`, e);
    }
  }
  const mode = await getSystemConfig('risk_enforcement_mode');
  for (const r of results) {
    await addRiskEvent({
      user_id: user.id,
      rule_code: r.rule_code,
      score_delta: r.score_delta,
      reason: 'rule_trigger',
      evidence: r.evidence,
      mode,
    });
  }
  if (mode === 'enforce') {
    const totalDelta = results.reduce((s, r) => s + r.score_delta, 0);
    if (totalDelta !== 0) await applyScoreDelta(user.id, totalDelta);
  }
  return results;
}

module.exports = { evaluate };
```

### 4.6 规则缓存

```js
// server/src/services/riskEngine/ruleCache.js
const supabase = require('../../config/supabase');

let cache = null;
let loadedAt = 0;

async function getRules() {
  const ttlMs = (await getSystemConfigInt('rules_cache_ttl_seconds', 600)) * 1000;
  if (cache && Date.now() - loadedAt < ttlMs) return cache;
  const { data } = await supabase.from('risk_rules').select('*');
  cache = data || [];
  loadedAt = Date.now();
  return cache;
}

function invalidate() { cache = null; loadedAt = 0; }

module.exports = { getRules, invalidate };
```

### 4.7 规则示例实现

```js
// server/src/services/riskEngine/rules/registerQuickPost.js
async function evaluate({ user, action, rule }) {
  if (action !== 'post_create') return { triggered: false };
  const thresholdMin = rule.params.threshold_minutes || 5;
  const registeredAt = new Date(user.created_at).getTime();
  const elapsedMin = (Date.now() - registeredAt) / 60000;
  if (elapsedMin < thresholdMin) {
    // 还要确认这是首帖
    const { count } = await supabase.from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', user.id);
    if (count === 1) {
      return {
        triggered: true,
        evidence: { registered_min_ago: elapsedMin.toFixed(1) },
      };
    }
  }
  return { triggered: false };
}

module.exports = { evaluate };
```

```js
// server/src/services/riskEngine/rules/simhashSimilar.js
const { simhash, hammingDistance } = require('../../simhash');

async function evaluate({ user, action, context, rule }) {
  if (action !== 'post_create') return { triggered: false };
  const content = context.post?.content;
  if (!content || content.length < 5) return { triggered: false };
  const sig = simhash(content);
  const { threshold_distance = 3, window_hours = 24, new_days = 7 } = rule.params;
  // 查窗口内新号的 simhash 签名
  const { data: candidates } = await supabase.rpc('find_recent_new_account_post_simhashes', {
    p_exclude_user: user.id,
    p_window_hours: window_hours,
    p_new_days: new_days,
  });
  for (const row of candidates || []) {
    if (hammingDistance(sig, row.simhash) < threshold_distance) {
      return {
        triggered: true,
        evidence: {
          simhash_distance: hammingDistance(sig, row.simhash),
          similar_post_id: row.post_id,
        },
      };
    }
  }
  return { triggered: false };
}
```

### 4.8 管理员后台：规则配置 API

```js
// server/src/routes/admin/rules.js
const express = require('express');
const supabase = require('../../config/supabase');
const { adminOnly } = require('../../middleware/auth');
const { invalidate: invalidateRulesCache } = require('../../services/riskEngine/ruleCache');

const router = express.Router();

router.use(adminOnly);

// 列表
router.get('/', async (req, res) => {
  const { data } = await supabase.from('risk_rules').select('*').order('category');
  res.json({ success: true, data });
});

// 修改
router.put('/:code', async (req, res) => {
  const { code } = req.params;
  const { enabled, score } = req.body;
  const { data: before } = await supabase.from('risk_rules').select('*').eq('code', code).single();
  const patch = { updated_at: new Date().toISOString(), updated_by: req.user.id };
  if (typeof enabled === 'boolean') patch.enabled = enabled;
  if (typeof score === 'number' && score >= 0 && score <= 100) patch.score = score;
  const { data: after } = await supabase.from('risk_rules').update(patch).eq('code', code).select().single();
  // 审计
  await supabase.from('risk_rule_audit').insert({
    rule_code: code,
    action: enabled !== undefined ? (enabled ? 'enable' : 'disable') : 'update_score',
    before_value: before,
    after_value: after,
    operator_id: req.user.id,
  });
  invalidateRulesCache();
  res.json({ success: true, data: after });
});

// 审计日志
router.get('/audit', async (req, res) => {
  const { data } = await supabase.from('risk_rule_audit').select('*').order('created_at', { ascending: false }).limit(50);
  res.json({ success: true, data });
});

module.exports = router;
```

---

## 5. Phase 2 测试清单

### 5.1 自动化测试

#### 单元测试
- [ ] 每条规则的 evaluate() 触发和不触发场景（12 条 × 2 = 24 个）
- [ ] `ruleCache.test.js`：缓存命中 / 过期刷新 / invalidate 生效
- [ ] `scoreStore.test.js`：addRiskEvent 写入、applyScoreDelta 上限 200
- [ ] `apkSignatureMiddleware.test.js`：valid / absent / hmac_mismatch / sig_mismatch / expired 五种状态
- [ ] `simhash.test.js`：相似文本距离 < 3，完全不同 > 20

#### 集成测试
- [ ] POST /api/posts 新号注册 3 分钟内发首帖 → risk_events 有 `REGISTER_QUICK_POST`
- [ ] POST /api/posts 发和他人 simhash 相似的内容 → risk_events 有 `SIMHASH_SIMILAR`
- [ ] 修改管理员规则 disable → 10 分钟后该规则不再触发（可通过 invalidate 加速测试）
- [ ] observe 模式下触发规则 → risk_events 写了但 users.risk_score 不变
- [ ] APK 请求带错误签名 → risk_events 有 `APK_SIGNATURE_FAIL` 且 score_delta=45

#### E2E
- [ ] 管理员登录 → 访问 `/admin/risk-rules` → 看到 12 条规则
- [ ] 修改某条规则 score 从 15 → 30 → 保存 → 刷新能看到新值
- [ ] 点击"审计日志"能看到刚才的修改记录

### 5.2 手动测试清单

**前端指纹采集**
- [ ] 浏览器打开注册页，F12 Network 看到 `X-Device-Fingerprint` header
- [ ] 同一浏览器刷新页面，指纹 hash **相同**（FingerprintJS 稳定性）
- [ ] 无痕模式打开，指纹 hash **不同**（因为某些分量改变）
- [ ] Android APK 启动，请求里带 `X-App-Signature` header
- [ ] APK 请求 header 格式：`<sigSha256>|<timestamp>|<hmac>`（三段 `|` 分隔）

**APK 签名校验**
- [ ] 用正版 APK 请求 → 后端日志 `apkSignatureStatus=valid`，不加分
- [ ] 手动修改 HMAC 前几位 → `apkSignatureStatus=hmac_mismatch`，risk_events 有 +45 事件
- [ ] 反编译 + 重签 APK（用 apktool + apksigner 换签名）→ `sig_mismatch`，+45
- [ ] H5 请求（无 X-App-Signature header）→ `absent`，不加分
- [ ] 篡改时间戳（改成 10 分钟前）→ `expired`，+45

**指纹数据落库**
- [ ] 注册一个新用户后查询：
  ```sql
  SELECT * FROM fingerprints WHERE platform='web' ORDER BY first_seen_at DESC LIMIT 1;
  SELECT * FROM user_fingerprints WHERE user_id = '新用户ID';
  SELECT * FROM ip_records WHERE ip_address = '真实IP';
  ```
  应有对应数据

**规则触发验证**
- [ ] 新号注册 3 分钟发首帖 → 查 risk_events 应有 `REGISTER_QUICK_POST` 记录
- [ ] 两个新号发相似文案 "今天天气真好" 和 "今天天气不错" → 第二条应有 `SIMHASH_SIMILAR`
- [ ] 用 DigitalOcean VPS IP 注册 → 查 ip_records 应 is_datacenter=true，risk_events 有 `ASN_DATACENTER`
- [ ] 用 `test@randomxyz.top` 注册 → risk_events 应有 `COLD_EMAIL_DOMAIN`
- [ ] 头像空 + 昵称默认生成 → risk_events 应有 `DEFAULT_PROFILE`

**管理员后台**
- [ ] 访问 `/ADMIN_PATH/risk-rules` → 看到 12 条规则列表
- [ ] 关闭 `COLD_EMAIL_DOMAIN` 开关 → 新注册 random.xyz 邮箱不再加分
- [ ] 修改 `SIMHASH_SIMILAR` 分值从 15 → 30 → 下次触发应加 30 分
- [ ] 查看审计日志 → 看到刚才的变更记录（before/after）

**observe 模式**
- [ ] 管理员切 observe 模式（通过 API 或 DB 手改 `system_config`）
- [ ] 新号发首帖 → risk_events 写了但 users.risk_score **仍为 0**
- [ ] event.mode='observe'

**规则缓存**
- [ ] 修改规则后立即触发规则 → 可能仍用旧值（缓存未失效）
- [ ] 调用 invalidate API 后立即触发 → 用新值

**Cron**
- [ ] 手动触发 `updateAccountCounts` → fingerprints.account_count 更新到实际关联数
- [ ] 手动把某指纹关联 3 个账号 → account_count=3 → 第 4 个账号注册时 DEVICE_MULTI_ACCOUNT 触发

### 5.3 回归测试
- [ ] Phase 1 所有功能正常（限流、Turnstile、邮箱黑名单）
- [ ] 已有用户登录、发帖、评论、私聊正常
- [ ] 管理员现有功能（用户列表、举报处理）正常

---

## 6. 完成标志

- 所有自动化测试通过
- 所有手动测试清单全通过
- 代码通过 **code-reviewer** 代理审查
- release keystore 已生成 + SHA256 已记录到 `.env`
- APK HMAC 密钥已生成 + 已注入 gradle.properties
- 提交 commit：`feat(anti-abuse-phase2): fingerprint collection + risk engine + APK signature validation`
- 推送 VPS 观察 1 小时无异常
- 用户确认后进入 Phase 3

---

## 7. 回滚策略

- 降权 / 封禁尚未启用（Phase 3 才做），本期**只是记录风险事件**，即使规则误触发也不影响用户体验
- 如需快速停止：
  1. Supabase 执行 `UPDATE risk_rules SET enabled=false;`
  2. 或切 observe 模式：`UPDATE system_config SET value='"observe"' WHERE key='risk_enforcement_mode';`

---

**下一步**：Phase 2 完成后，进入 [06-phase3-enforcement.md](./06-phase3-enforcement.md)。
