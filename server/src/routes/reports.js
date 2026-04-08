const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// 提交举报
router.post('/', authMiddleware, async (req, res) => {
  const { target_type, target_id, reason } = req.body;
  const reporterId = req.user.id;

  if (!['post', 'user'].includes(target_type)) {
    return res.status(400).json({ success: false, error: '举报类型无效' });
  }
  if (!target_id) {
    return res.status(400).json({ success: false, error: '缺少举报目标' });
  }
  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ success: false, error: '举报原因不能为空' });
  }

  // 不能举报自己
  if (target_type === 'user' && target_id === reporterId) {
    return res.status(400).json({ success: false, error: '不能举报自己' });
  }

  // 检查是否重复举报
  const { data: existing } = await supabase
    .from('reports')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .eq('status', 'pending')
    .single();

  if (existing) {
    return res.status(400).json({ success: false, error: '已举报过，请等待处理' });
  }

  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: reporterId,
      target_type,
      target_id,
      reason: reason.trim(),
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ success: false, error: '举报失败' });
  }

  res.json({ success: true, data });
});

module.exports = router;
