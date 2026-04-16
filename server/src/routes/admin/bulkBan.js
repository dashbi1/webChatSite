// Phase 3 管理员：批量封禁
//   POST /api/admin/bulk-ban/preview  - 返回候选账号列表（不封）
//   POST /api/admin/bulk-ban/execute  - 真正封禁 + 写 ban_records
//
// 支持 mode：
//   - score_gt: { threshold } → risk_score >= threshold 的用户
//   - same_ip_recent: { ip, hours } → 最近 N 小时同 IP 的用户
//   - keyword: { keyword } → 最近发过含此关键词帖子的用户
//   - cluster_fingerprint: { fingerprint_id } → 同一指纹下的用户

const express = require('express');
const supabase = require('../../config/supabase');
const { authMiddleware, adminMiddleware } = require('../../middleware/auth');
const { createBanRecord } = require('../../services/enforcement/banRecord');

const router = express.Router();
router.use(authMiddleware, adminMiddleware);

const VALID_MODES = new Set([
  'score_gt',
  'same_ip_recent',
  'keyword',
  'cluster_fingerprint',
]);

async function findCandidates(mode, params = {}) {
  if (mode === 'score_gt') {
    const threshold = Number(params.threshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('threshold 无效');
    }
    const { data, error } = await supabase
      .from('users')
      .select('id, email, nickname, risk_score, status')
      .gte('risk_score', threshold)
      .neq('status', 'banned')
      .limit(500);
    if (error) throw new Error('查询失败: ' + error.message);
    return data || [];
  }

  if (mode === 'same_ip_recent') {
    const ip = params.ip;
    const hours = Number(params.hours) || 1;
    if (!ip || typeof ip !== 'string') throw new Error('ip 必填');
    const { data, error } = await supabase.rpc('users_same_ip_within_hours', {
      p_ip: ip,
      p_hours: hours,
    });
    if (error) throw new Error('查询失败: ' + error.message);
    return data || [];
  }

  if (mode === 'keyword') {
    const kw = params.keyword;
    if (!kw || typeof kw !== 'string' || kw.length < 2) {
      throw new Error('keyword 至少 2 个字符');
    }
    const { data: posts, error } = await supabase
      .from('posts')
      .select('author_id')
      .ilike('content', `%${kw}%`)
      .limit(500);
    if (error) throw new Error('查询失败: ' + error.message);
    const userIds = [...new Set((posts || []).map((p) => p.author_id))];
    if (userIds.length === 0) return [];
    const { data: users, error: uerr } = await supabase
      .from('users')
      .select('id, email, nickname, status')
      .in('id', userIds)
      .neq('status', 'banned');
    if (uerr) throw new Error('查询失败: ' + uerr.message);
    return users || [];
  }

  if (mode === 'cluster_fingerprint') {
    const fpId = params.fingerprint_id;
    if (!fpId) throw new Error('fingerprint_id 必填');
    const { data, error } = await supabase.rpc('users_by_fingerprint_cluster', {
      p_fingerprint_id: fpId,
    });
    if (error) throw new Error('查询失败: ' + error.message);
    return data || [];
  }

  return [];
}

router.post('/preview', async (req, res) => {
  const { mode, params } = req.body || {};
  if (!VALID_MODES.has(mode)) {
    return res.status(400).json({
      success: false,
      error: `mode 必须是 ${[...VALID_MODES].join(' / ')}`,
    });
  }
  try {
    const users = await findCandidates(mode, params || {});
    res.json({
      success: true,
      data: { count: users.length, users },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/execute', async (req, res) => {
  const { mode, params, reason } = req.body || {};
  if (!VALID_MODES.has(mode)) {
    return res.status(400).json({
      success: false,
      error: `mode 必须是 ${[...VALID_MODES].join(' / ')}`,
    });
  }

  let users;
  try {
    users = await findCandidates(mode, params || {});
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }

  const bannedIds = [];
  const errors = [];
  const banType = `bulk_${mode}`;
  const reasonText = reason || `批量封禁 mode=${mode}`;

  for (const u of users) {
    try {
      await createBanRecord({
        targetType: 'user',
        targetId: u.id,
        banType,
        reason: reasonText,
        createdBy: req.user.id,
      });
      bannedIds.push(u.id);
    } catch (e) {
      errors.push({ user_id: u.id, error: e.message });
    }
  }

  res.json({
    success: true,
    banned_count: bannedIds.length,
    banned_ids: bannedIds,
    errors,
  });
});

module.exports = router;
