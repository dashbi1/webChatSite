const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取当前用户信息
router.get('/me', authMiddleware, async (req, res) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, nickname, avatar_url, college, grade, role, status, created_at')
    .eq('id', req.user.id)
    .single();

  if (error || !user) {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }

  res.json({ success: true, data: user });
});

// 更新个人资料
router.put('/me', authMiddleware, async (req, res) => {
  const { nickname, avatar_url, college, grade } = req.body;
  const updates = {};

  if (nickname !== undefined) {
    if (nickname.length < 2 || nickname.length > 20) {
      return res.status(400).json({ success: false, error: '昵称长度需要2-20字符' });
    }
    updates.nickname = nickname;
  }
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (college !== undefined) updates.college = college;
  if (grade !== undefined) updates.grade = grade;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, error: '没有可更新的字段' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, phone, nickname, avatar_url, college, grade, role, status')
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '更新失败' });
  }

  res.json({ success: true, data: user });
});

// 搜索用户
router.get('/search', authMiddleware, async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;

  if (!q || q.trim().length === 0) {
    return res.json({ success: true, data: [] });
  }

  const offset = (page - 1) * limit;
  const { data: users, error } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college, grade')
    .ilike('nickname', `%${q.trim()}%`)
    .neq('id', req.user.id)
    .eq('status', 'active')
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ success: false, error: '搜索失败' });
  }

  res.json({ success: true, data: users });
});

// 查看用户资料
router.get('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: user, error } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college, grade, created_at')
    .eq('id', id)
    .single();

  if (error || !user) {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }

  // 查好友关系
  const { data: friendship } = await supabase
    .from('friendships')
    .select('id, status, requester_id')
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${id}),and(requester_id.eq.${id},addressee_id.eq.${userId})`
    )
    .single();

  let friendStatus = 'none'; // none / pending / accepted
  if (friendship) {
    friendStatus = friendship.status;
  }

  // 统计帖子数
  const { count } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('author_id', id);

  res.json({
    success: true,
    data: {
      ...user,
      friend_status: friendStatus,
      friendship_id: friendship?.id || null,
      post_count: count || 0,
      is_self: id === userId,
    },
  });
});

module.exports = router;
