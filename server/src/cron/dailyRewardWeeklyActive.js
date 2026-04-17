// Cron wrapper：每日 weekly_active_clean 奖励（每日 03:30）
//
// 逻辑：
//   1. 查近 7 天 user_ips 活跃用户
//   2. 对每个活跃用户：查近 7 天 risk_events(rule_trigger) 累计 score_delta
//      如果 < 10 → 调 rewardWeeklyActiveClean（内置 Redis 冷却 7 天一次）

const supabase = require('../config/supabase');
const { rewardWeeklyActiveClean } = require('../services/decay/positiveReward');

const WINDOW_DAYS = 7;
const MAX_BAD_SCORE_IN_WINDOW = 10;

async function runDailyRewardWeeklyActive() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();
  const summary = { active: 0, rewarded: 0, skippedNoisy: 0, errors: 0 };

  const { data: actives, error } = await supabase.rpc('list_recent_active_users', {
    p_since: since,
  });
  if (error) {
    console.warn('[cron:dailyReward] rpc failed:', error.message);
    summary.errors++;
    return summary;
  }
  summary.active = (actives || []).length;

  for (const a of actives || []) {
    try {
      const { data: events } = await supabase
        .from('risk_events')
        .select('score_delta')
        .eq('user_id', a.user_id)
        .eq('reason', 'rule_trigger')
        .gte('created_at', since);
      const total = (events || []).reduce(
        (s, e) => s + (e.score_delta || 0),
        0
      );
      if (total >= MAX_BAD_SCORE_IN_WINDOW) {
        summary.skippedNoisy++;
        continue;
      }
      const r = await rewardWeeklyActiveClean(a.user_id);
      if (r && r.applied) summary.rewarded++;
    } catch (err) {
      console.warn('[cron:dailyReward] user', a.user_id, 'failed:', err && err.message);
      summary.errors++;
    }
  }

  console.log('[cron:dailyReward] result:', JSON.stringify(summary));
  return summary;
}

module.exports = { runDailyRewardWeeklyActive };
