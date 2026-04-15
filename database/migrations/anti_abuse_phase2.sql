-- ============================================================
-- Anti-Abuse Phase 2: 指纹采集 + 评分引擎
-- ============================================================
-- 前置：anti_abuse_phase1.sql 已成功执行
--
-- 本次新增：
--   - fingerprints / user_fingerprints（设备指纹多对多）
--   - ip_records / user_ips（IP 库 + ASN/机房标识）
--   - risk_rules（规则引擎配置）+ 12 条默认规则 seed
--   - risk_rule_audit（规则变更审计）
--   - risk_events（风险事件流水）
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴运行
--
-- ROLLBACK（注释形式）：
--   DROP TABLE IF EXISTS risk_events CASCADE;
--   DROP TABLE IF EXISTS risk_rule_audit CASCADE;
--   DROP TABLE IF EXISTS risk_rules CASCADE;
--   DROP TABLE IF EXISTS user_ips CASCADE;
--   DROP TABLE IF EXISTS ip_records CASCADE;
--   DROP TABLE IF EXISTS user_fingerprints CASCADE;
--   DROP TABLE IF EXISTS fingerprints CASCADE;
-- ============================================================

BEGIN;

-- ============================================================
-- 1. fingerprints 设备指纹库
-- ============================================================
CREATE TABLE IF NOT EXISTS fingerprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fingerprint_hash VARCHAR(64) UNIQUE NOT NULL,
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('web', 'android', 'ios', 'unknown')),
  details JSONB NOT NULL DEFAULT '{}',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  account_count INT DEFAULT 0,
  is_banned BOOLEAN DEFAULT FALSE,
  banned_until TIMESTAMPTZ,
  banned_reason TEXT,
  banned_at TIMESTAMPTZ,
  banned_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_fingerprints_hash ON fingerprints(fingerprint_hash);
CREATE INDEX IF NOT EXISTS idx_fingerprints_banned
  ON fingerprints(is_banned) WHERE is_banned = TRUE;
CREATE INDEX IF NOT EXISTS idx_fingerprints_account_count
  ON fingerprints(account_count DESC);

-- ============================================================
-- 2. user_fingerprints 多对多关联
-- ============================================================
CREATE TABLE IF NOT EXISTS user_fingerprints (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_id UUID NOT NULL REFERENCES fingerprints(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  seen_count INT DEFAULT 1,
  PRIMARY KEY (user_id, fingerprint_id)
);

CREATE INDEX IF NOT EXISTS idx_user_fingerprints_user ON user_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_user_fingerprints_fp ON user_fingerprints(fingerprint_id);

-- ============================================================
-- 3. ip_records IP 库（含 ASN / 机房标识）
-- ============================================================
CREATE TABLE IF NOT EXISTS ip_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address INET UNIQUE NOT NULL,
  ip_cidr_24 INET,
  asn INT,
  asn_org VARCHAR(255),
  country VARCHAR(2),
  is_datacenter BOOLEAN DEFAULT FALSE,
  enriched_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  account_count INT DEFAULT 0,
  is_banned BOOLEAN DEFAULT FALSE,
  banned_until TIMESTAMPTZ,
  banned_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ip_records_ip ON ip_records(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_records_cidr24 ON ip_records(ip_cidr_24);
CREATE INDEX IF NOT EXISTS idx_ip_records_banned
  ON ip_records(is_banned) WHERE is_banned = TRUE;
CREATE INDEX IF NOT EXISTS idx_ip_records_datacenter
  ON ip_records(is_datacenter) WHERE is_datacenter = TRUE;

-- ============================================================
-- 4. user_ips 多对多关联
-- ============================================================
CREATE TABLE IF NOT EXISTS user_ips (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_id UUID NOT NULL REFERENCES ip_records(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  seen_count INT DEFAULT 1,
  PRIMARY KEY (user_id, ip_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ips_user ON user_ips(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ips_ip ON user_ips(ip_id);

-- ============================================================
-- 5. risk_rules 规则引擎
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_rules (
  code VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(30) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  score INT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- ============================================================
-- 6. risk_rule_audit 规则变更审计
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_rule_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_code VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL
    CHECK (action IN ('enable', 'disable', 'update_score', 'update_params', 'create', 'delete')),
  before_value JSONB,
  after_value JSONB,
  operator_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rule_audit_rule
  ON risk_rule_audit(rule_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_audit_operator
  ON risk_rule_audit(operator_id, created_at DESC);

-- ============================================================
-- 7. risk_events 风险事件流水
-- ============================================================
CREATE TABLE IF NOT EXISTS risk_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_code VARCHAR(50) NOT NULL,
  score_delta INT NOT NULL,
  reason VARCHAR(30) NOT NULL DEFAULT 'rule_trigger',
    -- rule_trigger / decay / reward / admin_adjust / appeal_approve
  evidence JSONB DEFAULT '{}',
  mode VARCHAR(10) NOT NULL DEFAULT 'enforce' CHECK (mode IN ('enforce', 'observe')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_user
  ON risk_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_rule
  ON risk_events(rule_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_mode
  ON risk_events(mode, created_at DESC);

-- ============================================================
-- 8. Seed 12 条默认规则
-- ============================================================
-- 说明：
--   - APK_SIGNATURE_FAIL 初始 enabled=FALSE（等你发布带签名 HMAC 的新 APK 后再开）
--   - 其他 11 条默认 enabled=TRUE
--   - 分值按 docs/anti-abuse/02-rules-and-scoring.md 对齐
-- ============================================================
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
  '未设置头像 + 昵称是默认 "用户xxx" 格式',
  'registration', TRUE, 5,
  '{"default_nickname_pattern": "^用户[\\\\w]{4,8}$"}'::jsonb),

('ISOLATED_ISLAND',
  '孤岛互动簇',
  '账号属于互动率 > 60%、簇外互动 < 3 次/人、全是 < 7 天新号的孤岛簇',
  'behavior', TRUE, 10,
  '{"internal_rate_threshold": 0.6, "external_max_per_user": 3, "new_days": 7, "min_cluster_size": 3}'::jsonb),

('APK_SIGNATURE_FAIL',
  'APK 签名校验失败',
  'X-App-Signature header 校验失败：HMAC 不匹配或签名 SHA256 不在白名单。初始禁用，等发布带签名的新 APK 后手动开启',
  'device', FALSE, 45,
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
  '{}'::jsonb)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ============================================================
-- 迁移后快速验证：
--   SELECT COUNT(*) FROM risk_rules; -- 应 = 12
--   SELECT code, enabled, score FROM risk_rules ORDER BY category, code;
-- ============================================================
