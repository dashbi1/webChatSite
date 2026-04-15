# 01 — 数据库 Schema 设计

> 本文档列出反滥用系统所需的**全部数据表与列改动**。对应迁移脚本在 Phase 1-4 里分批落地。
> 现有表（users / email_verifications / posts / reports 等）参考 `database/schema.sql`。

---

## 总览：表清单与分期

| # | 表名 | 用途 | Phase |
|---|------|------|-------|
| 0 | `users` | 加列：risk_score, restricted_until, is_shadow_banned, shadow_ban_until | 1 |
| 1 | `system_config` | 全局开关（enforce/observe、appeals_enabled、cache TTL 等） | 1 |
| 2 | `disposable_email_domains` | 一次性邮箱黑名单 | 1 |
| 3 | `fingerprints` | 设备指纹库 | 2 |
| 4 | `user_fingerprints` | 用户-指纹多对多 | 2 |
| 5 | `ip_records` | IP 记录库（含 ASN/机房标识） | 2 |
| 6 | `user_ips` | 用户-IP 多对多 | 2 |
| 7 | `risk_rules` | 规则引擎配置 | 2 |
| 8 | `risk_rule_audit` | 规则变更审计 | 2 |
| 9 | `risk_events` | 风险事件流水 | 2 |
| 10 | `ban_records` | 封禁历史（账号/设备/IP） | 3 |
| 11 | `account_clusters` | 聚类检测结果 | 3 |
| 12 | `appeals` | 申诉记录 | 3 |
| 13 | `risk_score_decay_log` | 衰减 / 奖励日志（可选） | 4 |

---

## Phase 1：基础设施

### 1.0 users 表加列

```sql
-- Phase 1 迁移：database/migrations/anti_abuse_phase1.sql
ALTER TABLE users
  ADD COLUMN risk_score INT NOT NULL DEFAULT 0
    CHECK (risk_score >= 0 AND risk_score <= 200),
  ADD COLUMN restricted_until TIMESTAMPTZ,
  ADD COLUMN is_shadow_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN shadow_ban_until TIMESTAMPTZ,
  ADD COLUMN last_risk_event_at TIMESTAMPTZ;

CREATE INDEX idx_users_risk_score ON users(risk_score) WHERE risk_score > 0;
CREATE INDEX idx_users_restricted ON users(restricted_until) WHERE restricted_until IS NOT NULL;
CREATE INDEX idx_users_shadow ON users(is_shadow_banned) WHERE is_shadow_banned = TRUE;
```

**RLS 策略**：用户自己只读不写风险字段（防止被封用户改自己状态）

```sql
-- 现有 users 表已有 RLS：允许用户读自己。新增"禁止修改风控字段"策略
CREATE OR REPLACE FUNCTION prevent_risk_field_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'admin' THEN
    RETURN NEW;  -- 管理员可以改
  END IF;
  IF OLD.risk_score IS DISTINCT FROM NEW.risk_score OR
     OLD.restricted_until IS DISTINCT FROM NEW.restricted_until OR
     OLD.is_shadow_banned IS DISTINCT FROM NEW.is_shadow_banned OR
     OLD.shadow_ban_until IS DISTINCT FROM NEW.shadow_ban_until OR
     OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Cannot modify risk-related fields';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_users_risk_guard
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_risk_field_mutation();
```

**说明**：实际项目里后端用 `SUPABASE_SERVICE_ROLE_KEY` 绕过 RLS，所以后端能改；前端用 anon key 写就会被拦。

---

### 1.1 system_config（全局开关 + 可配置项）

```sql
CREATE TABLE system_config (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Seed 默认值
INSERT INTO system_config (key, value, description) VALUES
  ('risk_enforcement_mode', '"enforce"',
    '风控执行模式：enforce=降权和封禁生效 / observe=仅记录不执行'),
  ('rules_cache_ttl_seconds', '600',
    '规则配置缓存 TTL（秒），改动后最长 10 分钟生效'),
  ('appeals_enabled', 'false',
    '申诉功能前端是否启用（Phase 3 建后端，Phase 4 切 true）'),
  ('shadow_ban_sample_rate', '0.5',
    'Shadow ban 抽样比例：0.5 表示屏蔽一半内容'),
  ('new_account_protection_days', '7',
    '新号保护期天数：此期间减分效果 × 30%'),
  ('score_decay_factor', '0.9',
    '每 7 天风险分乘以此系数');
```

---

### 1.2 disposable_email_domains（一次性邮箱黑名单）

```sql
CREATE TABLE disposable_email_domains (
  domain VARCHAR(255) PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 由 cron 每日从 github.com/disposable-email-domains/disposable-email-domains 拉取
-- 启动时 Node 加载到内存 Set，O(1) 查询
```

---

## Phase 2：指纹与评分

### 2.1 fingerprints（设备指纹库）

```sql
CREATE TABLE fingerprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA256(组件字符串)
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('web', 'android')),
  details JSONB NOT NULL,
  -- details 字段示例：
  -- web: { ua, tz, lang, screen, canvas, webgl, audio, fonts, hwConcurrency }
  -- android: { androidId, model, osVersion, installer, isRooted, isEmulator, apkSigSha256 }
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  account_count INT DEFAULT 0,  -- cron 每 30 分钟更新
  is_banned BOOLEAN DEFAULT FALSE,
  banned_until TIMESTAMPTZ,
  banned_reason TEXT,
  banned_at TIMESTAMPTZ,
  banned_by UUID REFERENCES users(id)
);

CREATE INDEX idx_fingerprints_hash ON fingerprints(fingerprint_hash);
CREATE INDEX idx_fingerprints_banned ON fingerprints(is_banned) WHERE is_banned = TRUE;
CREATE INDEX idx_fingerprints_account_count ON fingerprints(account_count DESC);
```

### 2.2 user_fingerprints（多对多）

```sql
CREATE TABLE user_fingerprints (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_id UUID NOT NULL REFERENCES fingerprints(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  seen_count INT DEFAULT 1,
  PRIMARY KEY (user_id, fingerprint_id)
);

CREATE INDEX idx_user_fingerprints_user ON user_fingerprints(user_id);
CREATE INDEX idx_user_fingerprints_fp ON user_fingerprints(fingerprint_id);
```

### 2.3 ip_records（IP 库）

```sql
CREATE TABLE ip_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address INET UNIQUE NOT NULL,
  ip_cidr_24 INET,  -- 预存 /24 段便于批量查询：set_masklen(ip, 24)
  asn INT,
  asn_org VARCHAR(255),
  country VARCHAR(2),
  is_datacenter BOOLEAN DEFAULT FALSE,
  enriched_at TIMESTAMPTZ,  -- 上次调 ip-api.com 时间
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  account_count INT DEFAULT 0,
  is_banned BOOLEAN DEFAULT FALSE,
  banned_until TIMESTAMPTZ,
  banned_reason TEXT
);

CREATE INDEX idx_ip_records_ip ON ip_records(ip_address);
CREATE INDEX idx_ip_records_cidr24 ON ip_records(ip_cidr_24);
CREATE INDEX idx_ip_records_banned ON ip_records(is_banned) WHERE is_banned = TRUE;
CREATE INDEX idx_ip_records_datacenter ON ip_records(is_datacenter) WHERE is_datacenter = TRUE;
```

### 2.4 user_ips

```sql
CREATE TABLE user_ips (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_id UUID NOT NULL REFERENCES ip_records(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  seen_count INT DEFAULT 1,
  PRIMARY KEY (user_id, ip_id)
);

CREATE INDEX idx_user_ips_user ON user_ips(user_id);
CREATE INDEX idx_user_ips_ip ON user_ips(ip_id);
```

### 2.5 risk_rules（规则引擎）

```sql
CREATE TABLE risk_rules (
  code VARCHAR(50) PRIMARY KEY,  -- 'REGISTER_QUICK_POST', 'SIMHASH_SIMILAR' 等
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(30) NOT NULL,  -- 'registration' / 'content' / 'behavior' / 'device' / 'network'
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  score INT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  -- params 字段锁死，不开放管理员配置（锁死阈值示例）：
  -- REGISTER_QUICK_POST: {"threshold_minutes": 5}
  -- SIMHASH_SIMILAR: {"threshold_distance": 3, "window_hours": 24, "new_days": 7}
  -- DEVICE_MULTI_ACCOUNT: {"max_accounts": 3}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- 12 条默认规则见 02-rules-and-scoring.md 第 2 节
```

### 2.6 risk_rule_audit

```sql
CREATE TABLE risk_rule_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_code VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL
    CHECK (action IN ('enable', 'disable', 'update_score', 'update_params', 'create', 'delete')),
  before_value JSONB,
  after_value JSONB,
  operator_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rule_audit_rule ON risk_rule_audit(rule_code, created_at DESC);
CREATE INDEX idx_rule_audit_operator ON risk_rule_audit(operator_id, created_at DESC);
```

### 2.7 risk_events（风险事件流水）

```sql
CREATE TABLE risk_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_code VARCHAR(50) NOT NULL,
  score_delta INT NOT NULL,  -- 正数加分，负数减分（衰减/奖励也进此表）
  reason VARCHAR(30) NOT NULL,  -- 'rule_trigger' / 'decay' / 'reward' / 'admin_adjust' / 'appeal_approve'
  evidence JSONB,  -- 触发证据：post_id / similar_to / simhash_distance 等
  mode VARCHAR(10) DEFAULT 'enforce' CHECK (mode IN ('enforce', 'observe')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_events_user ON risk_events(user_id, created_at DESC);
CREATE INDEX idx_risk_events_rule ON risk_events(rule_code, created_at DESC);
CREATE INDEX idx_risk_events_mode ON risk_events(mode, created_at DESC);

-- 90 天后归档（Phase 4 cron 清理）
```

---

## Phase 3：执行与申诉

### 3.1 ban_records（封禁历史）

```sql
CREATE TABLE ban_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type VARCHAR(20) NOT NULL
    CHECK (target_type IN ('user', 'fingerprint', 'ip')),
  target_id VARCHAR(64) NOT NULL,  -- user_id.uuid / fingerprint_id.uuid / ip_address
  ban_type VARCHAR(20) NOT NULL
    CHECK (ban_type IN ('auto_score', 'manual', 'cluster', 'bulk_rule', 'bulk_keyword', 'bulk_time_ip')),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,  -- NULL 表示永久
  created_by UUID REFERENCES users(id),  -- NULL 表示自动
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  revoke_reason TEXT
);

CREATE INDEX idx_ban_records_target ON ban_records(target_type, target_id);
CREATE INDEX idx_ban_records_active ON ban_records(target_type, target_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_ban_records_expires ON ban_records(expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
```

### 3.2 account_clusters（聚类检测结果）

```sql
CREATE TABLE account_clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_type VARCHAR(30) NOT NULL
    CHECK (cluster_type IN ('fingerprint', 'ip_cidr24', 'isolated_island', 'simhash_similar')),
  member_ids UUID[] NOT NULL,
  cluster_size INT GENERATED ALWAYS AS (array_length(member_ids, 1)) STORED,
  suspicion_score INT NOT NULL,  -- 0-100
  evidence JSONB,
  -- evidence 字段示例：
  -- fingerprint: { fingerprint_id: '...' }
  -- ip_cidr24: { ip_cidr: '1.2.3.0/24', registered_within_hours: 1 }
  -- isolated_island: { internal_interaction_rate: 0.8, external_count: 1 }
  -- simhash_similar: { shared_simhash_cluster_size: 5 }
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'banned', 'cleared', 'ignored')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

CREATE INDEX idx_clusters_status ON account_clusters(status, created_at DESC);
CREATE INDEX idx_clusters_type ON account_clusters(cluster_type, created_at DESC);
CREATE INDEX idx_clusters_members ON account_clusters USING GIN (member_ids);
```

### 3.3 appeals（申诉）

```sql
CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ban_record_id UUID REFERENCES ban_records(id),
  contact_email VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  evidence_urls JSONB DEFAULT '[]',  -- 用户上传截图等
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_appeals_status ON appeals(status, created_at DESC);
CREATE INDEX idx_appeals_user ON appeals(user_id, created_at DESC);

-- 约束：一账号 7 天最多 3 次申诉（在后端 API 层校验）
```

---

## Phase 4：衰减与日志

### 4.1 risk_score_decay_log（可选，用于追溯衰减历史）

```sql
CREATE TABLE risk_score_decay_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  before_score INT NOT NULL,
  after_score INT NOT NULL,
  decay_type VARCHAR(20) NOT NULL
    CHECK (decay_type IN ('time_decay', 'reward_active', 'reward_liked', 'reward_replied', 'reward_friend_accepted')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decay_log_user ON risk_score_decay_log(user_id, created_at DESC);

-- 保留 30 天
```

---

## 迁移脚本文件结构

```
database/migrations/
├── anti_abuse_phase1.sql   -- users 加列 + system_config + disposable_email_domains + trigger
├── anti_abuse_phase2.sql   -- fingerprints + user_fingerprints + ip_records + user_ips + risk_rules + risk_rule_audit + risk_events
├── anti_abuse_phase3.sql   -- ban_records + account_clusters + appeals
└── anti_abuse_phase4.sql   -- risk_score_decay_log + 归档/清理函数
```

每个 phase 的迁移脚本**必须**：
1. 包含所有 `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` / `CREATE TRIGGER`
2. 包含 seed 数据（`system_config` 默认值、`risk_rules` 12 条默认规则）
3. 包含 rollback 对应的 `DROP` 语句（注释形式，便于应急）

---

## 性能与容量估算

- `fingerprints` / `ip_records`：**百万级**（每个访客一条），查询走 hash 索引
- `user_fingerprints` / `user_ips`：**千万级**（多对多），只按用户或设备查单侧
- `risk_events`：**高频写**（每动作一条）→ **90 天后归档**
- `account_clusters`：**中频**（cron 每小时产出，最多日千条）
- `ban_records`：**低频**（日百条内）
- `appeals`：**低频**（日十条内）

---

**下一步**：读 [02-rules-and-scoring.md](./02-rules-and-scoring.md) 了解规则与评分的完整细节。
