const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

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
    console.log(`用户上线: ${userId}`);

    // 发送消息
    socket.on('chat:send', async (data) => {
      const { receiverId, content, messageType = 'text', referencePostId } = data;

      if (!receiverId || !content) return;

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

      if (!error && message) {
        const { data: senderUser } = await supabase
          .from('users')
          .select('id, nickname, avatar_url')
          .eq('id', userId)
          .single();
        message.sender = senderUser;
      }

      if (error) {
        socket.emit('chat:error', { error: '发送失败' });
        return;
      }

      // 推送给接收者
      io.to(receiverId).emit('chat:receive', message);
      // 回执给发送者
      socket.emit('chat:sent', message);
    });

    // 正在输入
    socket.on('chat:typing', (data) => {
      const { receiverId } = data;
      io.to(receiverId).emit('chat:typing', { senderId: userId });
    });

    socket.on('disconnect', () => {
      console.log(`用户下线: ${userId}`);
    });
  });
}

module.exports = setupSocket;
