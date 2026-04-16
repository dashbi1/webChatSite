// Phase 3 Fix Pack：规则加分去重 / 衰减
//
// 每条规则在 risk_rules.params 里配置（和现有 threshold 等参数并存）：
//   dedup_mode:           'none' | 'once' | 'decay'（默认 'none'，兼容旧数据）
//   dedup_window_hours:   INT | null（null = 永久窗口，只对 once 有意义）
//   decay_factor:         NUMERIC（默认 0.5，仅 decay 使用）
//
// 语义：
//   'none'   → 照常加 rule.score
//   'once'   → 窗口内已有命中 → 返回 0（调用方跳过，不写 risk_events）
//   'decay'  → 第 n 次命中 = round(rule.score × decay_factor^n)，最小保底 1
//
// window_hits 只数 reason='rule_trigger' 的历史事件（自然衰减/奖励 / admin 调整不计入）
// 并发说明：高并发下可能出现双倍加分（读-决定-写不原子），但日活 100、每用户每秒 <1 次，
//   可接受；严格原子等 Phase 4 引入 Redis 再做。

const supabase = require('../../config/supabase');

/**
 * 根据规则配置计算该次触发应实际加的分数
 * @param {string} userId
 * @param {Object} rule  risk_rules 行：{ code, score, params }
 * @returns {Promise<number>} 应加分数（0 表示跳过不写）
 */
async function computeAppliedDelta(userId, rule) {
  if (!userId || !rule || typeof rule.score !== 'number') return 0;

  const params = rule.params || {};
  const mode = params.dedup_mode || 'none';
  const windowHours = Object.prototype.hasOwnProperty.call(params, 'dedup_window_hours')
    ? params.dedup_window_hours
    : null;
  const factor = typeof params.decay_factor === 'number' ? params.decay_factor : 0.5;

  if (mode === 'none') return rule.score;

  const hits = await countWindowHits(userId, rule.code, windowHours);

  if (mode === 'once') {
    return hits > 0 ? 0 : rule.score;
  }

  if (mode === 'decay') {
    const clampedFactor = clampFactor(factor);
    const raw = rule.score * Math.pow(clampedFactor, hits);
    const rounded = Math.round(raw);
    return Math.max(1, rounded);
  }

  // 未知 mode：保守按 none 处理
  return rule.score;
}

/**
 * 查 risk_events 里 rule_trigger 事件计数
 * @param {string} userId
 * @param {string} ruleCode
 * @param {number|null} windowHours null/undefined = 永久窗口
 * @returns {Promise<number>}
 */
async function countWindowHits(userId, ruleCode, windowHours) {
  let q = supabase
    .from('risk_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('rule_code', ruleCode)
    .eq('reason', 'rule_trigger');
  if (windowHours != null) {
    const since = new Date(Date.now() - Number(windowHours) * 3600 * 1000).toISOString();
    q = q.gte('created_at', since);
  }
  const { count, error } = await q;
  if (error) {
    console.warn('[dedupDecay] countWindowHits error:', error.message);
    return 0; // 失败则放行（避免误封）
  }
  return count || 0;
}

function clampFactor(f) {
  if (!Number.isFinite(f)) return 0.5;
  if (f <= 0) return 0.01; // 保险：避免 0 导致永远返回 1
  if (f >= 1) return 0.99; // 不允许等于 1（那就不是 decay 了）
  return f;
}

module.exports = { computeAppliedDelta, countWindowHits };
