-- ============================================================
-- Anti-Abuse Phase 4: 聚类 cron + 时间衰减 + 正向奖励 + 归档 + 申诉热启用
-- ============================================================
-- 前置：phase1/2/3 迁移已成功执行
--
-- 本次新增：
--   - risk_score_decay_log（衰减/奖励轨迹表）
--   - risk_events_archive（90 天归档目的表）
--   - 3 个 RPC:
--       list_new_user_likes(p_user_ids uuid[], p_since timestamptz)
--       list_new_user_comments(p_user_ids uuid[], p_since timestamptz)
--       list_recent_active_users(p_since timestamptz)
--   - UPDATE system_config SET appeals_enabled = true
--
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴运行
-- 幂等：CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE FUNCTION
--
-- ROLLBACK（注释形式）：
--   UPDATE system_config SET value='false'::jsonb WHERE key='appeals_enabled';
--   DROP FUNCTION IF EXISTS list_recent_active_users(TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS list_new_user_comments(UUID[], TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS list_new_user_likes(UUID[], TIMESTAMPTZ);
--   DROP TABLE IF EXISTS risk_events_archive;
--   DROP TABLE IF EXISTS risk_score_decay_log;
-- ============================================================

-- ------------------------------------------------------------
-- 1. risk_score_decay_log：分数衰减 + 奖励轨迹
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_score_decay_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  before_score INT NOT NULL,
  after_score INT NOT NULL,
  decay_type VARCHAR(40) NOT NULL,
  -- 取值：
  --   'time_decay'
  --   'reward_weekly_active'
  --   'reward_post_liked_by_stranger'
  --   'reward_comment_replied'
  --   'reward_friend_accepted'
  --   'reward_appeal_approve'
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decay_log_user
  ON risk_score_decay_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decay_log_type
  ON risk_score_decay_log(decay_type, created_at DESC);

-- ------------------------------------------------------------
-- 2. risk_events_archive：90 天前事件归档
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_events_archive (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,         -- 不加 FK，防止 user 删除时归档同步丢失
  rule_code VARCHAR(50) NOT NULL,
  score_delta INT NOT NULL,
  reason VARCHAR(30) NOT NULL,
  evidence JSONB,
  mode VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_archive_user
  ON risk_events_archive(user_id, created_at DESC);

-- ------------------------------------------------------------
-- 3. RPC: list_new_user_likes
--    用于孤岛簇检测 —— 返回新用户之间的点赞边（actor→被点赞帖子作者）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_new_user_likes(
  p_user_ids UUID[],
  p_since TIMESTAMPTZ
) RETURNS TABLE (actor_id UUID, target_id UUID) AS $$
  SELECT l.user_id AS actor_id, p.author_id AS target_id
  FROM likes l
  JOIN posts p ON p.id = l.post_id
  WHERE l.user_id = ANY(p_user_ids)
    AND p.author_id = ANY(p_user_ids)
    AND l.user_id <> p.author_id
    AND l.created_at >= p_since;
$$ LANGUAGE SQL STABLE;

-- ------------------------------------------------------------
-- 4. RPC: list_new_user_comments
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_new_user_comments(
  p_user_ids UUID[],
  p_since TIMESTAMPTZ
) RETURNS TABLE (actor_id UUID, target_id UUID) AS $$
  SELECT c.user_id AS actor_id, p.author_id AS target_id
  FROM comments c
  JOIN posts p ON p.id = c.post_id
  WHERE c.user_id = ANY(p_user_ids)
    AND p.author_id = ANY(p_user_ids)
    AND c.user_id <> p.author_id
    AND c.created_at >= p_since;
$$ LANGUAGE SQL STABLE;

-- ------------------------------------------------------------
-- 5. RPC: list_recent_active_users
--    用于 daily reward（weekly_active_clean）：近 N 天有活动的用户
--    数据源：user_ips.last_seen_at（phase2 中间件每次请求会更新）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_recent_active_users(
  p_since TIMESTAMPTZ
) RETURNS TABLE (user_id UUID, last_seen_at TIMESTAMPTZ) AS $$
  SELECT ui.user_id, MAX(ui.last_seen_at) AS last_seen_at
  FROM user_ips ui
  WHERE ui.last_seen_at >= p_since
  GROUP BY ui.user_id;
$$ LANGUAGE SQL STABLE;

-- ------------------------------------------------------------
-- 6. 启用申诉前端（Phase 4 热启用）
-- ------------------------------------------------------------
UPDATE system_config
  SET value = 'true'::jsonb, updated_at = NOW()
  WHERE key = 'appeals_enabled';

-- ============================================================
-- END Phase 4 migration
-- ============================================================
