const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取通知列表
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

  // 获取未读数量
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  res.json({ success: true, data, unread_count: count || 0 });
});

// 标记通知已读
router.put('/read', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { ids } = req.body; // 可选：指定 ID 列表

  let query = supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (ids && ids.length > 0) {
    query = query.in('id', ids);
  }

  await query;
  res.json({ success: true });
});

module.exports = router;
