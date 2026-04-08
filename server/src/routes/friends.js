const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 发送好友申请
router.post('/request', authMiddleware, async (req, res) => {
  const { addressee_id } = req.body;
  const requesterId = req.user.id;

  if (addressee_id === requesterId) {
    return res.status(400).json({ success: false, error: '不能添加自己' });
  }

  // 检查对方是否存在
  const { data: targetUser } = await supabase
    .from('users')
    .select('id, status')
    .eq('id', addressee_id)
    .single();

  if (!targetUser) {
    return res.status(404).json({ success: false, error: '用户不存在' });
  }
  if (targetUser.status === 'banned') {
    return res.status(400).json({ success: false, error: '该用户不可添加' });
  }

  // 检查是否已有好友关系
  const { data: existing } = await supabase
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester_id.eq.${requesterId},addressee_id.eq.${addressee_id}),and(requester_id.eq.${addressee_id},addressee_id.eq.${requesterId})`
    )
    .single();

  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(400).json({ success: false, error: '已经是好友了' });
    }
    if (existing.status === 'pending') {
      return res.status(400).json({ success: false, error: '已发送过申请，请等待对方确认' });
    }
  }

  const { data: friendship, error } = await supabase
    .from('friendships')
    .insert({ requester_id: requesterId, addressee_id })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '发送申请失败' });
  }

  res.json({ success: true, data: friendship });
});

// 获取好友申请列表（收到的）
router.get('/requests', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const { data: requests, error } = await supabase
    .from('friendships')
    .select('*')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: '获取申请列表失败' });
  }

  // 获取申请人信息
  const requesterIds = requests.map(r => r.requester_id);
  const { data: requesters } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college')
    .in('id', requesterIds.length > 0 ? requesterIds : ['none']);

  const requesterMap = new Map((requesters || []).map(u => [u.id, u]));
  const enriched = requests.map(r => ({ ...r, requester: requesterMap.get(r.requester_id) || null }));

  res.json({ success: true, data: enriched });
});

// 处理好友申请
router.put('/request/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'accept' or 'reject'
  const userId = req.user.id;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: '无效操作' });
  }

  const { data: friendship } = await supabase
    .from('friendships')
    .select('*')
    .eq('id', id)
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .single();

  if (!friendship) {
    return res.status(404).json({ success: false, error: '申请不存在' });
  }

  const newStatus = action === 'accept' ? 'accepted' : 'rejected';
  const { data: updated, error } = await supabase
    .from('friendships')
    .update({ status: newStatus })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '处理失败' });
  }

  res.json({ success: true, data: updated });
});

// 好友列表
router.get('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) {
    return res.status(500).json({ success: false, error: '获取好友列表失败' });
  }

  // 获取好友用户信息
  const friendUserIds = friendships.map(f =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  );
  const { data: friendUsers } = await supabase
    .from('users')
    .select('id, nickname, avatar_url, college, grade')
    .in('id', friendUserIds.length > 0 ? friendUserIds : ['none']);

  const friendMap = new Map((friendUsers || []).map(u => [u.id, u]));
  const friends = friendships.map(f => {
    const fid = f.requester_id === userId ? f.addressee_id : f.requester_id;
    return { friendship_id: f.id, ...(friendMap.get(fid) || {}) };
  });

  res.json({ success: true, data: friends });
});

// 删除好友
router.delete('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { error } = await supabase
    .from('friendships')
    .delete()
    .eq('id', id)
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) {
    return res.status(500).json({ success: false, error: '删除失败' });
  }

  res.json({ success: true });
});

module.exports = router;
