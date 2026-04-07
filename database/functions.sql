-- 点赞计数 +1
CREATE OR REPLACE FUNCTION increment_like_count(post_id_input UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE posts SET like_count = like_count + 1 WHERE id = post_id_input;
END;
$$ LANGUAGE plpgsql;

-- 点赞计数 -1
CREATE OR REPLACE FUNCTION decrement_like_count(post_id_input UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = post_id_input;
END;
$$ LANGUAGE plpgsql;

-- 评论计数 +1
CREATE OR REPLACE FUNCTION increment_comment_count(post_id_input UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE posts SET comment_count = comment_count + 1 WHERE id = post_id_input;
END;
$$ LANGUAGE plpgsql;

-- 获取聊天会话列表
CREATE OR REPLACE FUNCTION get_conversations(current_user_id UUID)
RETURNS TABLE (
    friend_id UUID,
    friend_nickname TEXT,
    friend_avatar TEXT,
    last_message TEXT,
    last_time TIMESTAMPTZ,
    unread_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH ranked AS (
        SELECT
            m.*,
            CASE WHEN m.sender_id = current_user_id THEN m.receiver_id ELSE m.sender_id END AS other_id,
            ROW_NUMBER() OVER (
                PARTITION BY LEAST(m.sender_id, m.receiver_id), GREATEST(m.sender_id, m.receiver_id)
                ORDER BY m.created_at DESC
            ) AS rn
        FROM messages m
        WHERE m.sender_id = current_user_id OR m.receiver_id = current_user_id
    )
    SELECT
        r.other_id AS friend_id,
        u.nickname AS friend_nickname,
        u.avatar_url AS friend_avatar,
        r.content AS last_message,
        r.created_at AS last_time,
        (
            SELECT COUNT(*)
            FROM messages m2
            WHERE m2.sender_id = r.other_id
              AND m2.receiver_id = current_user_id
              AND m2.is_read = FALSE
        ) AS unread_count
    FROM ranked r
    JOIN users u ON u.id = r.other_id
    WHERE r.rn = 1
    ORDER BY r.created_at DESC;
END;
$$ LANGUAGE plpgsql;
