// Phase 3 管理员：申诉处理
//   GET  /api/admin/appeals            - pending 列表
//   GET  /api/admin/appeals/all        - 全量（可带 status 过滤）
//   POST /api/admin/appeals/:id/resolve { status, note } - 处理

const express = require('express');
const supabase = require('../../config/supabase');
const { authMiddleware, adminMiddleware } = require('../../middleware/auth');
const {
  listPending,
  resolveAppeal,
  AppealError,
} = require('../../services/appeals/appealService');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

router.get('/', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  const list = await listPending({
    limit: Math.min(200, Number(limit) || 50),
    offset: Math.max(0, Number(offset) || 0),
  });
  res.json({ success: true, data: list });
});

router.get('/all', async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  let q = supabase
    .from('appeals')
    .select('*, user:user_id(id, email, nickname, risk_score, status)')
    .order('created_at', { ascending: false })
    .range(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 50) - 1);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) {
    return res.status(500).json({ success: false, error: '查询失败' });
  }
  res.json({ success: true, data });
});

router.post('/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body || {};
  try {
    const result = await resolveAppeal(id, req.user.id, status, note);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof AppealError) {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        error: err.message,
      });
    }
    console.error('[admin/appeals] resolve error:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

module.exports = router;
