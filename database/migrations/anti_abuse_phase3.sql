-- ============================================================
-- Anti-Abuse Phase 3: 执行层 + 账号簇 + 批量封 + 申诉骨架
-- ============================================================
-- 前置：anti_abuse_phase1.sql、anti_abuse_phase2.sql 已成功执行
--
-- 本次新增：
--   - ban_records（封禁历史：账号/设备/IP）
--   - account_clusters（聚类检测结果 - Phase 3 先建表,Phase 4 写入者上线)
--   - appeals（申诉记录）
--   - posts / comments 加 shadow_ban 列（Phase 3 才真正启用）
--   - 6 个 RPC 函数：
--       get_timeline_posts, get_post_comments_visible,
--       list_fingerprint_clusters, list_ip_cidr24_clusters,
--       find_burst_ip_cidr24, users_same_ip_within_hours,
--       users_by_fingerprint_cluster
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴运行
-- 幂等：所有 CREATE 都用 IF NOT EXISTS，函数用 CREATE OR REPLACE
--
-- ROLLBACK（注释形式）：
--   DROP FUNCTION IF EXISTS users_by_fingerprint_cluster(UUID);
--   DROP FUNCTION IF EXISTS users_same_ip_within_hours(INET, INT);
--   DROP FUNCTION IF EXISTS find_burst_ip_cidr24(INT, INT);
--   DROP FUNCTION IF EXISTS list_ip_cidr24_clusters(INT, INT);
--   DROP FUNCTION IF EXISTS list_fingerprint_clusters(INT, INT);
--   DROP FUNCTION IF EXISTS get_post_comments_visible(UUID, UUID, INT, INT);
--   DROP FUNCTION IF EXISTS get_timeline_posts(UUID, INT, INT);
--   ALTER TABLE comments DROP COLUMN IF EXISTS shadow_ban;
--   ALTER TABLE posts DROP COLUMN IF EXISTS shadow_ban;
--   DROP TABLE IF EXISTS appeals CASCADE;
--   DROP TABLE IF EXISTS account_clusters CASCADE;
--   DROP TABLE IF EXISTS ban_records CASCADE;
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ban_records 封禁历史（账号 / 设备 / IP 三类）
-- ============================================================
CREATE TABLE IF NOT EXISTS ban_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type VARCHAR(20) NOT NULL
    CHECK (target_type IN ('user', 'fingerprint', 'ip')),
  target_id VARCHAR(64) NOT NULL,  -- UUID 或 ip 字符串
  ban_type VARCHAR(30) NOT NULL
    CHECK (ban_type IN (
      'auto_score', 'manual', 'cluster',
      'bulk_score_gt', 'bulk_same_ip_recent', 'bulk_keyword',
      'bulk_cluster_fingerprint', 'ip_burst_auto'
    )),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,  -- NULL = 永久
  created_by UUID REFERENCES users(id),  -- NULL = 自动
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  revoke_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ban_records_target
  ON ban_records(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ban_records_active
  ON ban_records(target_type, target_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ban_records_expires
  ON ban_records(expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ban_records_created
  ON ban_records(created_at DESC);

-- ============================================================
-- 2. account_clusters 聚类检测结果
-- ============================================================
CREATE TABLE IF NOT EXISTS account_clusters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_type VARCHAR(30) NOT NULL
    CHECK (cluster_type IN ('fingerprint', 'ip_cidr24', 'isolated_island', 'simhash_similar')),
  member_ids UUID[] NOT NULL,
  cluster_size INT GENERATED ALWAYS AS (array_length(member_ids, 1)) STORED,
  suspicion_score INT NOT NULL DEFAULT 0,
  evidence JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'banned', 'cleared', 'ignored')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_clusters_status
  ON account_clusters(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_type
  ON account_clusters(cluster_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_members
  ON account_clusters USING GIN (member_ids);

-- ============================================================
-- 3. appeals 申诉记录
-- ============================================================
CREATE TABLE IF NOT EXISTS appeals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ban_record_id UUID REFERENCES ban_records(id),
  contact_email VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  evidence_urls JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_appeals_status
  ON appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_user
  ON appeals(user_id, created_at DESC);

-- ============================================================
-- 4. posts / comments 加 shadow_ban 列
-- ============================================================
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS shadow_ban BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comments
  ADD COLUMN IF NOT EXISTS shadow_ban BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index：通常查询只看非 shadow 内容，WHERE FALSE 索引扫描快
CREATE INDEX IF NOT EXISTS idx_posts_shadow_visible
  ON posts(created_at DESC) WHERE shadow_ban = FALSE;
CREATE INDEX IF NOT EXISTS idx_comments_shadow_visible
  ON comments(post_id, created_at ASC) WHERE shadow_ban = FALSE;

-- ============================================================
-- 5. RPC: get_timeline_posts — shadow 过滤 timeline
-- ============================================================
CREATE OR REPLACE FUNCTION get_timeline_posts(
  current_user_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS SETOF posts
LANGUAGE SQL
STABLE
AS $$
  SELECT *
  FROM posts
  WHERE (shadow_ban = FALSE OR author_id = current_user_id)
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================================
-- 6. RPC: get_post_comments_visible — shadow 过滤评论
-- ============================================================
CREATE OR REPLACE FUNCTION get_post_comments_visible(
  p_post_id UUID,
  current_user_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS SETOF comments
LANGUAGE SQL
STABLE
AS $$
  SELECT *
  FROM comments
  WHERE post_id = p_post_id
    AND (shadow_ban = FALSE OR user_id = current_user_id)
  ORDER BY created_at ASC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================================
-- 7. RPC: list_fingerprint_clusters — 指纹簇列表
--    返回 account_count >= 阈值的指纹及关联账户 IDs
-- ============================================================
CREATE OR REPLACE FUNCTION list_fingerprint_clusters(
  p_min_accounts INT DEFAULT 3,
  p_limit INT DEFAULT 50
) RETURNS TABLE(
  fingerprint_id UUID,
  fingerprint_hash VARCHAR(64),
  platform VARCHAR(20),
  account_count INT,
  account_ids UUID[],
  last_seen_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    f.id,
    f.fingerprint_hash,
    f.platform,
    COUNT(uf.user_id)::INT AS account_count,
    ARRAY_AGG(uf.user_id ORDER BY uf.last_seen_at DESC) AS account_ids,
    f.last_seen_at
  FROM fingerprints f
  JOIN user_fingerprints uf ON uf.fingerprint_id = f.id
  GROUP BY f.id, f.fingerprint_hash, f.platform, f.last_seen_at
  HAVING COUNT(uf.user_id) >= p_min_accounts
  ORDER BY COUNT(uf.user_id) DESC, f.last_seen_at DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- 8. RPC: list_ip_cidr24_clusters — IP /24 段簇列表
-- ============================================================
CREATE OR REPLACE FUNCTION list_ip_cidr24_clusters(
  p_min_accounts INT DEFAULT 3,
  p_limit INT DEFAULT 50
) RETURNS TABLE(
  ip_cidr_24 INET,
  account_count INT,
  account_ids UUID[],
  ip_count INT,
  last_seen_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
AS $$
  SELECT
    ir.ip_cidr_24,
    COUNT(DISTINCT ui.user_id)::INT AS account_count,
    ARRAY_AGG(DISTINCT ui.user_id) AS account_ids,
    COUNT(DISTINCT ir.id)::INT AS ip_count,
    MAX(ir.last_seen_at) AS last_seen_at
  FROM ip_records ir
  JOIN user_ips ui ON ui.ip_id = ir.id
  WHERE ir.ip_cidr_24 IS NOT NULL
  GROUP BY ir.ip_cidr_24
  HAVING COUNT(DISTINCT ui.user_id) >= p_min_accounts
  ORDER BY COUNT(DISTINCT ui.user_id) DESC, MAX(ir.last_seen_at) DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- 9. RPC: find_burst_ip_cidr24 — 近 N 小时注册密集的 IP 段
--    用于 cron/ipBurstCheck 每 10 分钟扫描
-- ============================================================
CREATE OR REPLACE FUNCTION find_burst_ip_cidr24(
  p_window_hours INT DEFAULT 1,
  p_min INT DEFAULT 5
) RETURNS TABLE(
  ip_cidr_24 INET,
  account_count INT,
  account_ids UUID[]
)
LANGUAGE SQL
STABLE
AS $$
  WITH recent AS (
    SELECT DISTINCT ir.ip_cidr_24, u.id AS user_id
    FROM users u
    JOIN user_ips ui ON ui.user_id = u.id
    JOIN ip_records ir ON ir.id = ui.ip_id
    WHERE u.created_at >= NOW() - (p_window_hours || ' hours')::INTERVAL
      AND ir.ip_cidr_24 IS NOT NULL
  )
  SELECT
    ip_cidr_24,
    COUNT(user_id)::INT AS account_count,
    ARRAY_AGG(user_id) AS account_ids
  FROM recent
  GROUP BY ip_cidr_24
  HAVING COUNT(user_id) >= p_min;
$$;

-- ============================================================
-- 10. RPC: users_same_ip_within_hours — 批量封用
-- ============================================================
CREATE OR REPLACE FUNCTION users_same_ip_within_hours(
  p_ip INET,
  p_hours INT DEFAULT 1
) RETURNS TABLE(id UUID, email VARCHAR)
LANGUAGE SQL
STABLE
AS $$
  SELECT DISTINCT u.id, u.email
  FROM users u
  JOIN user_ips ui ON ui.user_id = u.id
  JOIN ip_records ir ON ir.id = ui.ip_id
  WHERE ir.ip_address = p_ip
    AND ui.last_seen_at >= NOW() - (p_hours || ' hours')::INTERVAL;
$$;

-- ============================================================
-- 11. RPC: users_by_fingerprint_cluster — 批量封用
-- ============================================================
CREATE OR REPLACE FUNCTION users_by_fingerprint_cluster(
  p_fingerprint_id UUID
) RETURNS TABLE(id UUID, email VARCHAR)
LANGUAGE SQL
STABLE
AS $$
  SELECT DISTINCT u.id, u.email
  FROM users u
  JOIN user_fingerprints uf ON uf.user_id = u.id
  WHERE uf.fingerprint_id = p_fingerprint_id;
$$;

COMMIT;
