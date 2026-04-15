// 风险分读写 + 事件记录
// observe 模式：只写 risk_events（mode=observe），不更新 users.risk_score
// enforce 模式：两者都做

const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');

/**
 * 写一条 risk_events，并（仅 enforce 模式）更新 users.risk_score。
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.ruleCode
 * @param {number} params.scoreDelta
 * @param {'rule_trigger'|'decay'|'reward'|'admin_adjust'|'appeal_approve'} [params.reason]
 * @param {Object} [params.evidence]
 * @param {'enforce'|'observe'} [params.modeOverride] 强制模式（测试用）
 */
async function recordEvent({
  userId,
  ruleCode,
  scoreDelta,
  reason = 'rule_trigger',
  evidence = {},
  modeOverride = null,
}) {
  const mode =
    modeOverride || (await getSystemConfig('risk_enforcement_mode', 'enforce'));

  // 1. 写 risk_events
  const { error: evtErr } = await supabase.from('risk_events').insert({
    user_id: userId,
    rule_code: ruleCode,
    score_delta: scoreDelta,
    reason,
    evidence,
    mode,
  });
  if (evtErr) {
    console.warn('[scoreStore] risk_events insert failed:', evtErr.message);
    return { recorded: false, appliedDelta: 0, mode };
  }

  // 2. 只有 enforce 模式才真正更新 users.risk_score + last_risk_event_at
  if (mode !== 'enforce') {
    return { recorded: true, appliedDelta: 0, mode };
  }

  // 读现值然后更新（Supabase JS client 没有 atomic increment；Phase 2 下并发写同一用户极少见，可接受）
  const { data: user, error: readErr } = await supabase
    .from('users')
    .select('risk_score')
    .eq('id', userId)
    .maybeSingle();
  if (readErr || !user) {
    console.warn('[scoreStore] read user failed:', readErr && readErr.message);
    return { recorded: true, appliedDelta: 0, mode };
  }

  const current = user.risk_score || 0;
  const next = Math.max(0, Math.min(200, current + scoreDelta));
  if (next === current) {
    return { recorded: true, appliedDelta: 0, mode, newScore: next };
  }

  const { error: updErr } = await supabase
    .from('users')
    .update({
      risk_score: next,
      last_risk_event_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (updErr) {
    console.warn('[scoreStore] update user failed:', updErr.message);
    return { recorded: true, appliedDelta: 0, mode };
  }

  return {
    recorded: true,
    appliedDelta: next - current,
    mode,
    newScore: next,
    previousScore: current,
  };
}

module.exports = { recordEvent };
