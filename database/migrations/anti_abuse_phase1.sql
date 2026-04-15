-- ============================================================
-- Anti-Abuse Phase 1: 基础设施
-- ============================================================
-- 为反滥用系统打底：users 加风控字段、system_config 全局开关、
-- disposable_email_domains 一次性邮箱黑名单。
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴运行
-- 幂等：所有 CREATE 都用 IF NOT EXISTS，ALTER 用 IF NOT EXISTS（PG 16+）
--
-- ROLLBACK（注释形式）：
--   ALTER TABLE users DROP COLUMN risk_score, DROP COLUMN restricted_until,
--     DROP COLUMN is_shadow_banned, DROP COLUMN shadow_ban_until, DROP COLUMN last_risk_event_at;
--   DROP TABLE IF EXISTS disposable_email_domains;
--   DROP TABLE IF EXISTS system_config;
--   DROP TRIGGER IF EXISTS tr_users_risk_guard ON users;
--   DROP FUNCTION IF EXISTS prevent_risk_field_mutation;
-- ============================================================

BEGIN;

-- ============================================================
-- 1. users 加风控列
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0
    CHECK (risk_score >= 0 AND risk_score <= 200),
  ADD COLUMN IF NOT EXISTS restricted_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_shadow_banned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shadow_ban_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_risk_event_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_risk_score
  ON users(risk_score) WHERE risk_score > 0;
CREATE INDEX IF NOT EXISTS idx_users_restricted
  ON users(restricted_until) WHERE restricted_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_shadow
  ON users(is_shadow_banned) WHERE is_shadow_banned = TRUE;

-- ============================================================
-- 2. system_config 全局开关
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);

-- Seed 默认配置（ON CONFLICT 保证幂等）
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
    '每 7 天风险分乘以此系数')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. disposable_email_domains 一次性邮箱黑名单
-- ============================================================
CREATE TABLE IF NOT EXISTS disposable_email_domains (
  domain VARCHAR(255) PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. 风控字段写保护触发器
-- ============================================================
-- 防止用户端（anon key / authenticated JWT）绕过后端直接改自己的 risk_score / status。
--
-- 放行场景：
--   - service_role（后端用 SUPABASE_SERVICE_ROLE_KEY 调用 PostgREST）
--   - **直接 DB 连接**（psql、Dashboard SQL Editor、迁移脚本等，无 JWT claims）
-- 拦截场景：
--   - anon JWT（未登录用户）
--   - authenticated JWT（普通已登录用户）
CREATE OR REPLACE FUNCTION prevent_risk_field_mutation()
RETURNS TRIGGER AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  -- 尝试读取 JWT claims 的 role
  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    jwt_role := NULL;
  END;

  -- 只对客户端 JWT（anon / authenticated）做检查
  -- service_role 或 无 JWT（直连 DB）都放行
  IF jwt_role IS DISTINCT FROM 'anon'
     AND jwt_role IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- 普通用户不能改风控字段
  IF OLD.risk_score IS DISTINCT FROM NEW.risk_score
     OR OLD.restricted_until IS DISTINCT FROM NEW.restricted_until
     OR OLD.is_shadow_banned IS DISTINCT FROM NEW.is_shadow_banned
     OR OLD.shadow_ban_until IS DISTINCT FROM NEW.shadow_ban_until
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Cannot modify risk-related fields from client'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_users_risk_guard ON users;
CREATE TRIGGER tr_users_risk_guard
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_risk_field_mutation();

COMMIT;
