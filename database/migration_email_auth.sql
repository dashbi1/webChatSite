-- ============================================
-- 邮箱认证改造迁移
-- 在 Supabase SQL Editor 中执行一次
-- 幂等安全：重复执行会跳过已存在的列/约束/表
-- ============================================

-- 1. users 表加 email 列（先允许 NULL）
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- 2. phone 从 NOT NULL 改为可空（如果已经是可空，这条会报错但不影响）
DO $$
BEGIN
    ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
    -- 已经是 NULL 的话 Postgres 会抛 error，忽略
    NULL;
END $$;

-- 3. 迁移现有测试账号
UPDATE users SET email = 'admin@test.local' WHERE phone = '13800000001' AND email IS NULL;
UPDATE users SET email = 'user1@test.local' WHERE phone = '13800000002' AND email IS NULL;
UPDATE users SET email = 'user2@test.local' WHERE phone = '13800000003' AND email IS NULL;
UPDATE users SET email = 'user3@test.local' WHERE phone = '13800000004' AND email IS NULL;

-- 4. 兜底：其他没 email 的老账号用 legacy_<uuid>@test.local
UPDATE users
SET email = CONCAT('legacy_', id, '@test.local')
WHERE email IS NULL;

-- 5. 设为 NOT NULL + UNIQUE
ALTER TABLE users ALTER COLUMN email SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 6. 验证码表
CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    code VARCHAR(6) NOT NULL,
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('register', 'reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_lookup
    ON email_verifications(email, purpose, created_at DESC);
