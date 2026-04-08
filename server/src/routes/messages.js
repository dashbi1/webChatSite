const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 获取聊天列表（最近的会话）
router.get('/conversations', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  // 获取所有和当前用户有关的最近一条消息
  const { data, error } = await supabase.rpc('get_conversations', {
    current_user_id: userId,
  });

  if (error) {
    // 如果 RPC 不存在，退回到简单查询
    const { data: messages } = await supabase
      .from('messages')
      .select('*')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    // 收集对话对象 ID
    const otherIds = new Set();
    for (const msg of messages || []) {
      otherIds.add(msg.sender_id === userId ? msg.receiver_id : msg.sender_id);
    }
    const { data: otherUsers } = await supabase
      .from('users')
      .select('id, nickname, avatar_url')
      .in('id', otherIds.size > 0 ? [...otherIds] : ['none']);
    const userMap = new Map((otherUsers || []).map(u => [u.id, u]));

    // 按对话对象分组，取最新一条
    const convMap = new Map();
    for (const msg of messages || []) {
      const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
      if (!convMap.has(otherId)) {
        convMap.set(otherId, {
          friend_id: otherId,
          friend: userMap.get(otherId) || null,
          last_message: msg.content,
          last_time: msg.created_at,
          unread_count: 0,
        });
      }
    }

    return res.json({ success: true, data: Array.from(convMap.values()) });
  }

  res.json({ success: true, data });
});

// 获取与某好友的聊天记录
router.get('/:friendId', authMiddleware, async (req, res) => {
  const { friendId } = req.params;
  const userId = req.user.id;
  const { page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;

  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return res.status(500).json({ success: false, error: '获取消息失败' });
  }

  // 标记收到的消息为已读
  await supabase
    .from('messages')
    .update({ is_read: true })
    .eq('sender_id', friendId)
    .eq('receiver_id', userId)
    .eq('is_read', false);

  // 附加发送者信息
  const senderIds = [...new Set(messages.map(m => m.sender_id))];
  const { data: senders } = await supabase
    .from('users')
    .select('id, nickname, avatar_url')
    .in('id', senderIds.length > 0 ? senderIds : ['none']);
  const senderMap = new Map((senders || []).map(u => [u.id, u]));
  const enriched = messages.map(m => ({ ...m, sender: senderMap.get(m.sender_id) || null }));

  res.json({ success: true, data: enriched.reverse() });
});

module.exports = router;
