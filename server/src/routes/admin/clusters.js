// Phase 3 管理员：账号簇视图
//   GET /api/admin/clusters?type=fingerprint|ip_cidr24&min=3&limit=50

const express = require('express');
const { authMiddleware, adminMiddleware } = require('../../middleware/auth');
const { listClusters } = require('../../services/cluster');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

router.get('/', async (req, res) => {
  const {
    type = 'fingerprint',
    min = 3,
    limit = 50,
  } = req.query;

  if (!['fingerprint', 'ip_cidr24'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: 'type 必须是 fingerprint 或 ip_cidr24',
    });
  }

  const minNum = Number(min);
  const limNum = Number(limit);
  const minAccounts = Math.max(2, Math.min(50, Number.isFinite(minNum) ? minNum : 3));
  const lim = Math.max(1, Math.min(200, Number.isFinite(limNum) ? limNum : 50));

  const list = await listClusters({ type, minAccounts, limit: lim });
  res.json({
    success: true,
    data: list,
    meta: { type, min: minAccounts, limit: lim, count: list.length },
  });
});

module.exports = router;
