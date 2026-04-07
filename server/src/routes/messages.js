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
      .select(`
        *,
        sender:users!sender_id (id, nickname, avatar_url),
        receiver:users!receiver_id (id, nickname, avatar_url)
      `)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);

    // 按对话对象分组，取最新一条
    const convMap = new Map();
    for (const msg of messages || []) {
      const otherId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
      if (!convMap.has(otherId)) {
        const other = msg.sender_id === userId ? msg.receiver : msg.sender;
        convMap.set(otherId, {
          friend_id: otherId,
          friend: other,
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
    .select(`
      *,
      sender:users!sender_id (id, nickname, avatar_url)
    `)
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

  res.json({ success: true, data: messages.reverse() });
});

module.exports = router;
