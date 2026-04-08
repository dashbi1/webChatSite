const supabase = require('../config/supabase');

// 全局 io 引用，由 app.js 设置
let _io = null;

function setIO(io) {
  _io = io;
}

// 创建通知 + Socket 实时推送
async function createNotification({ userId, triggerUserId, type, content, referenceId }) {
  const { data: notification, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      trigger_user_id: triggerUserId,
      type,
      content,
      reference_id: referenceId || null,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[notify] insert error:', error.message);
    return null;
  }

  // 附加触发者信息
  if (triggerUserId) {
    const { data: triggerUser } = await supabase
      .from('users')
      .select('id, nickname, avatar_url')
      .eq('id', triggerUserId)
      .single();
    notification.trigger_user = triggerUser;
  }

  // Socket 实时推送
  if (_io) {
    _io.to(userId).emit('notification:new', notification);
  }

  return notification;
}

module.exports = { setIO, createNotification };
