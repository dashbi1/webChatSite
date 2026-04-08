const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { createNotification } = require('../utils/notify');

// 检查好友关系
async function areFriends(userA, userB) {
  const { data } = await supabase
    .from('friendships')
    .select('id')
    .eq('status', 'accepted')
    .or(
      `and(requester_id.eq.${userA},addressee_id.eq.${userB}),and(requester_id.eq.${userB},addressee_id.eq.${userA})`
    )
    .single();
  return !!data;
}

// 检查用户是否被封禁
async function isBanned(userId) {
  const { data } = await supabase
    .from('users')
    .select('status')
    .eq('id', userId)
    .single();
  return data?.status === 'banned';
}

function setupSocket(io) {
  // JWT 认证中间件
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('未提供 Token'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Token 无效'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;

    // 加入个人房间
    socket.join(userId);

    // 发送消息
    socket.on('chat:send', async (data) => {
      const { receiverId, content, messageType = 'text', referencePostId } = data;

      if (!receiverId || !content) {
        socket.emit('chat:error', { error: '缺少参数' });
        return;
      }

      // 检查自己是否被封禁
      if (await isBanned(userId)) {
        socket.emit('account:banned', { error: '账号已被封禁' });
        return;
      }

      // 检查对方是否被封禁
      if (await isBanned(receiverId)) {
        socket.emit('chat:error', { error: '对方账号已被封禁，无法发送消息' });
        return;
      }

      // 好友关系校验
      const friends = await areFriends(userId, receiverId);
      if (!friends) {
        socket.emit('chat:error', { error: '只能与好友私聊' });
        return;
      }

      // 存入数据库
      const { data: message, error } = await supabase
        .from('messages')
        .insert({
          sender_id: userId,
          receiver_id: receiverId,
          content,
          message_type: messageType,
          reference_post_id: referencePostId || null,
        })
        .select('*')
        .single();

      if (error) {
        socket.emit('chat:error', { error: '发送失败' });
        return;
      }

      // 附加发送者信息
      const { data: senderUser } = await supabase
        .from('users')
        .select('id, nickname, avatar_url')
        .eq('id', userId)
        .single();
      message.sender = senderUser;

      // 推送给接收者
      io.to(receiverId).emit('chat:receive', message);
      // 回执给发送者
      socket.emit('chat:sent', message);

      // 私聊通知
      const preview = content.length > 20 ? content.slice(0, 20) + '...' : content;
      const senderName = senderUser?.nickname || '有人';
      await createNotification({
        userId: receiverId,
        triggerUserId: userId,
        type: 'message',
        content: `${senderName}：${preview}`,
        referenceId: message.id,
      });
    });

    // 正在输入
    socket.on('chat:typing', (data) => {
      const { receiverId } = data;
      if (receiverId) {
        io.to(receiverId).emit('chat:typing', { senderId: userId });
      }
    });

    socket.on('disconnect', () => {
      // 静默下线
    });
  });
}

module.exports = setupSocket;
