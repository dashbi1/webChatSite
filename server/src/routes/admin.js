const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { getIO } = require('../utils/notify');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// 用户列表（支持邮箱/昵称搜索）
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, q } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('users')
    .select('id, email, phone, nickname, avatar_url, college, role, status, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.or(`nickname.ilike.%${q}%,email.ilike.%${q}%`);
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

  // 通过 Socket 踢出在线用户
  const io = getIO();
  if (io) {
    io.to(id).emit('account:banned', { error: '账号已被封禁' });
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

// 帖子列表（支持内容搜索）
router.get('/posts', async (req, res) => {
  const { page = 1, limit = 20, q } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (q) {
    query = query.ilike('content', `%${q}%`);
  }

  const { data: posts, error } = await query;
  if (error) {
    return res.status(500).json({ success: false, error: '获取帖子列表失败' });
  }

  // 批量获取作者信息
  const authorIds = [...new Set(posts.map(p => p.author_id))];
  let authorMap = new Map();
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from('users')
      .select('id, nickname, email')
      .in('id', authorIds);
    authorMap = new Map((authors || []).map(a => [a.id, a]));
  }

  const result = posts.map(p => ({
    ...p,
    author: authorMap.get(p.author_id) || null,
  }));

  res.json({ success: true, data: result });
});

// 管理员删帖
router.delete('/posts/:id', async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) {
    return res.status(500).json({ success: false, error: '删除失败' });
  }

  res.json({ success: true });
});

// 举报列表
router.get('/reports', async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data: reports, error } = await query;
  if (error) {
    return res.status(500).json({ success: false, error: '获取举报列表失败' });
  }

  // 获取举报者信息
  const reporterIds = [...new Set(reports.map(r => r.reporter_id))];
  let reporterMap = new Map();
  if (reporterIds.length > 0) {
    const { data: reporters } = await supabase
      .from('users')
      .select('id, nickname, email')
      .in('id', reporterIds);
    reporterMap = new Map((reporters || []).map(u => [u.id, u]));
  }

  const result = reports.map(r => ({
    ...r,
    reporter: reporterMap.get(r.reporter_id) || null,
  }));

  res.json({ success: true, data: result });
});

// 处理举报
router.put('/reports/:id', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'resolve' or 'dismiss'

  if (!['resolve', 'dismiss'].includes(action)) {
    return res.status(400).json({ success: false, error: '无效操作，需为 resolve 或 dismiss' });
  }

  // 先查举报详情
  const { data: report } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .single();

  if (!report) {
    return res.status(404).json({ success: false, error: '举报不存在' });
  }

  const newStatus = action === 'resolve' ? 'resolved' : 'dismissed';

  const { data, error } = await supabase
    .from('reports')
    .update({ status: newStatus })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '处理失败' });
  }

  // resolve 时执行对应操作
  if (action === 'resolve') {
    if (report.target_type === 'user') {
      // 封禁被举报用户
      await supabase.from('users').update({ status: 'banned' }).eq('id', report.target_id);
      const io = getIO();
      if (io) {
        io.to(report.target_id).emit('account:banned', { error: '账号已被封禁' });
      }
    } else if (report.target_type === 'post') {
      // 删除被举报帖子
      await supabase.from('posts').delete().eq('id', report.target_id);
    }
  }

  res.json({ success: true, data });
});

module.exports = router;
