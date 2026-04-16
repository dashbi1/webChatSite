// 管理员后台：风控规则配置 + 全局开关 + 审计日志 + 风险事件查询
// 挂在 /api/admin/risk 下，全部受 authMiddleware + adminMiddleware 保护

const express = require('express');
const supabase = require('../config/supabase');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { invalidate: invalidateRulesCache } = require('../services/riskEngine/ruleCache');
const {
  getSystemConfig,
  setSystemConfig,
  _clearCache: clearConfigCache,
} = require('../services/config/systemConfig');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

// ============================================================
// 规则：列表
// ============================================================
router.get('/rules', async (req, res) => {
  const { data, error } = await supabase
    .from('risk_rules')
    .select('*')
    .order('category', { ascending: true })
    .order('code', { ascending: true });
  if (error) {
    return res.status(500).json({ success: false, error: '获取规则失败' });
  }
  res.json({ success: true, data });
});

// ============================================================
// 规则：更新（enabled / score）
// params 字段锁死，不开放 UI（需直接改 DB）
// ============================================================
router.put('/rules/:code', async (req, res) => {
  const { code } = req.params;
  const { enabled, score } = req.body || {};

  // 先拿 before
  const { data: before, error: readErr } = await supabase
    .from('risk_rules')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (readErr || !before) {
    return res.status(404).json({ success: false, error: '规则不存在' });
  }

  const patch = {
    updated_at: new Date().toISOString(),
    updated_by: req.user.id,
  };
  let action = null;
  if (typeof enabled === 'boolean' && enabled !== before.enabled) {
    patch.enabled = enabled;
    action = enabled ? 'enable' : 'disable';
  }
  if (typeof score === 'number' && Number.isFinite(score)) {
    if (score < 0 || score > 100) {
      return res.status(400).json({ success: false, error: 'score 必须在 0-100 之间' });
    }
    if (score !== before.score) {
      patch.score = score;
      action = action || 'update_score';
    }
  }
  if (!action) {
    return res.json({ success: true, data: before, noop: true });
  }

  const { data: after, error: updErr } = await supabase
    .from('risk_rules')
    .update(patch)
    .eq('code', code)
    .select('*')
    .single();
  if (updErr) {
    return res.status(500).json({ success: false, error: '更新失败' });
  }

  // 写审计
  await supabase.from('risk_rule_audit').insert({
    rule_code: code,
    action,
    before_value: before,
    after_value: after,
    operator_id: req.user.id,
  });

  // 让缓存立刻失效
  invalidateRulesCache();

  res.json({ success: true, data: after });
});

// ============================================================
// 规则：审计日志
// ============================================================
router.get('/rules/audit', async (req, res) => {
  const { limit = 50, rule_code } = req.query;
  let q = supabase
    .from('risk_rule_audit')
    .select('*, operator:operator_id(id, email, nickname)')
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Number(limit) || 50));
  if (rule_code) q = q.eq('rule_code', rule_code);
  const { data, error } = await q;
  if (error) {
    return res.status(500).json({ success: false, error: '获取审计日志失败' });
  }
  res.json({ success: true, data });
});

// ============================================================
// 全局配置：读
// ============================================================
router.get('/config', async (req, res) => {
  // 一次拉所有 system_config 行（值不多，不限流）
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value, description, updated_at');
  if (error) {
    return res.status(500).json({ success: false, error: '获取配置失败' });
  }
  res.json({ success: true, data });
});

// ============================================================
// 全局配置：更新（如 risk_enforcement_mode 切换）
// ============================================================
router.put('/config/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (value === undefined) {
    return res.status(400).json({ success: false, error: '缺少 value' });
  }

  // 白名单：只允许改以下 key（防止手滑）
  const ALLOWED_KEYS = new Set([
    'risk_enforcement_mode',
    'rules_cache_ttl_seconds',
    'appeals_enabled',
    'shadow_ban_sample_rate',
    'new_account_protection_days',
    'score_decay_factor',
  ]);
  if (!ALLOWED_KEYS.has(key)) {
    return res.status(400).json({ success: false, error: '不允许修改此 key' });
  }

  // risk_enforcement_mode 必须是 'enforce' | 'observe'
  if (key === 'risk_enforcement_mode') {
    const v = typeof value === 'string' ? value : null;
    if (v !== 'enforce' && v !== 'observe') {
      return res
        .status(400)
        .json({ success: false, error: 'mode 必须是 enforce 或 observe' });
    }
  }

  try {
    await setSystemConfig(key, value, req.user.id);
    clearConfigCache();
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: '更新失败: ' + (err && err.message) });
  }
});

// ============================================================
// 风险事件：最近 N 条（用于观察模式下看规则命中情况）
// ============================================================
router.get('/events', async (req, res) => {
  const {
    limit = 50,
    user_id,
    rule_code,
    mode,
  } = req.query;
  let q = supabase
    .from('risk_events')
    .select('*, user:user_id(id, email, nickname, risk_score)')
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Number(limit) || 50));
  if (user_id) q = q.eq('user_id', user_id);
  if (rule_code) q = q.eq('rule_code', rule_code);
  if (mode) q = q.eq('mode', mode);
  const { data, error } = await q;
  if (error) {
    return res.status(500).json({ success: false, error: '获取事件失败' });
  }
  res.json({ success: true, data });
});

// ============================================================
// 风险事件：按规则分类统计（观察阈值用）
// ============================================================
router.get('/events/stats', async (req, res) => {
  const { hours = 24 } = req.query;
  const since = new Date(Date.now() - Number(hours) * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('risk_events')
    .select('rule_code, mode')
    .gte('created_at', since);
  if (error) {
    return res.status(500).json({ success: false, error: '统计失败' });
  }
  const stats = {};
  for (const e of data || []) {
    const key = `${e.rule_code}|${e.mode}`;
    stats[key] = (stats[key] || 0) + 1;
  }
  const rows = Object.entries(stats).map(([key, count]) => {
    const [rule_code, mode] = key.split('|');
    return { rule_code, mode, count };
  });
  rows.sort((a, b) => b.count - a.count);
  res.json({ success: true, data: rows, window_hours: Number(hours) });
});

module.exports = router;
