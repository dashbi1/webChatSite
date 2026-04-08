const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取通知列表（分页，时间倒序）
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ success: false, error: '获取通知失败' });
  }

  // 获取关联用户信息（触发者）
  const triggerIds = [...new Set(data.filter(n => n.trigger_user_id).map(n => n.trigger_user_id))];
  let triggerMap = new Map();
  if (triggerIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, nickname, avatar_url')
      .in('id', triggerIds);
    triggerMap = new Map((users || []).map(u => [u.id, u]));
  }

  const enriched = data.map(n => ({
    ...n,
    trigger_user: triggerMap.get(n.trigger_user_id) || null,
  }));

  res.json({ success: true, data: enriched });
});

// 获取未读通知数量
router.get('/unread-count', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) {
    return res.status(500).json({ success: false, error: '获取未读数失败' });
  }

  res.json({ success: true, data: { count: count || 0 } });
});

// 标记单条通知为已读
router.put('/:id/read', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '标记失败' });
  }

  if (!data) {
    return res.status(404).json({ success: false, error: '通知不存在' });
  }

  res.json({ success: true, data });
});

module.exports = router;
