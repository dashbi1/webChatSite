const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// 用户管理列表
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, q } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('users')
    .select('id, phone, nickname, avatar_url, college, role, status, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.ilike('nickname', `%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ success: false, error: '获取用户列表失败' });
  }

  res.json({ success: true, data });
});

// 封禁用户
router.put('/users/:id/ban', async (req, res) => {
  const { id } = req.params;

  if (id === req.user.id) {
    return res.status(400).json({ success: false, error: '不可封禁自己' });
  }

  const { error } = await supabase
    .from('users')
    .update({ status: 'banned' })
    .eq('id', id);

  if (error) {
    return res.status(500).json({ success: false, error: '封禁失败' });
  }

  res.json({ success: true });
});

// 解封用户
router.put('/users/:id/unban', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from('users')
    .update({ status: 'active' })
    .eq('id', id);

  if (error) {
    return res.status(500).json({ success: false, error: '解封失败' });
  }

  res.json({ success: true });
});

// 删除帖子
router.delete('/posts/:id', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) {
    return res.status(500).json({ success: false, error: '删除失败' });
  }

  res.json({ success: true });
});

module.exports = router;
