// Phase 3 用户侧申诉 API
//   POST /api/appeals      - 提交申诉（受 appeals_enabled feature flag 控制）
//   GET  /api/appeals/my   - 查自己的申诉历史
//
// 错误码（供前端 request.js 拦截）：
//   COMING_SOON      - appeals_enabled=false，功能未开放
//   RATE_LIMITED     - 7 天 3 次上限
//   REASON_TOO_SHORT - 理由少于 10 字
//   EMAIL_REQUIRED   - 缺邮箱

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const {
  submitAppeal,
  getUserAppeals,
  AppealError,
} = require('../services/appeals/appealService');

const router = express.Router();

// 提交申诉（封禁用户也能提 — 但前置 auth 会拦 banned 的 JWT，所以实操上
// 申诉能被封禁用户提交的前提是：管理员给他开了"申诉模式"的临时通道，
// 或者申诉者用还没失效的 JWT。Phase 4 可扩展给封禁用户专门的 minimal token。）
router.post('/', authMiddleware, async (req, res) => {
  try {
    const inserted = await submitAppeal(req.user.id, req.body || {});
    res.json({ success: true, data: inserted });
  } catch (err) {
    if (err instanceof AppealError) {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        error: err.message,
      });
    }
    console.error('[appeals] submit error:', err);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

// 查自己的申诉历史
router.get('/my', authMiddleware, async (req, res) => {
  const list = await getUserAppeals(req.user.id);
  res.json({ success: true, data: list });
});

module.exports = router;
