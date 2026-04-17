// Phase 4：风险分时间衰减（每日 02:00 cron 调）
//
// 规则：
//   对所有 risk_score > 0 AND status != 'banned' 的用户：
//     days_since_event = (now - last_risk_event_at || created_at) / 86400
//     如果 days_since_event < 7：跳过
//     factor = score_decay_factor（默认 0.9）
//     如果 新号保护期内（regDays < 7）：factor = 1 - (1-decayFactor)*0.3  → 0.97
//     newScore = floor(current * factor)
//     如果 newScore < current：
//       通过 recordEvent 写 risk_events(reason='decay', score_delta=newScore-current)
//       + 额外写 risk_score_decay_log
//       + recordEvent 内部会触发 applyEnforcement 闭环（banned 已被跳过，这里不担心）
//
// observe 模式下 recordEvent 只写 risk_events，不动 users.risk_score，符合 Q22 设计。

const supabase = require('../../config/supabase');
const { getSystemConfig } = require('../config/systemConfig');
const { recordEvent } = require('../riskEngine/scoreStore');

const DAY_MS = 86400 * 1000;
const PAGE = 500;

async function runDecay(now = new Date()) {
  const rawFactor = await getSystemConfig('score_decay_factor', 0.9);
  const decayFactor = parseFloat(rawFactor) || 0.9;
  const rawProtection = await getSystemConfig('new_account_protection_days', 7);
  const protectionDays = parseInt(rawProtection, 10) || 7;

  const summary = {
    scanned: 0,
    decayed: 0,
    skipped: 0,
    errors: 0,
  };

  let offset = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('users')
      .select(
        'id, email, status, risk_score, created_at, last_risk_event_at'
      )
      .gt('risk_score', 0)
      .neq('status', 'banned')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.warn('[timeDecay] page query failed:', error.message);
      summary.errors++;
      break;
    }
    if (!page || page.length === 0) break;

    summary.scanned += page.length;

    for (const u of page) {
      const current = u.risk_score || 0;
      const lastEvent = u.last_risk_event_at
        ? new Date(u.last_risk_event_at)
        : new Date(u.created_at);
      const daysSinceEvent = (now.getTime() - lastEvent.getTime()) / DAY_MS;
      if (daysSinceEvent < 7) {
        summary.skipped++;
        continue;
      }
      const regDays = (now.getTime() - new Date(u.created_at).getTime()) / DAY_MS;
      let factor = decayFactor;
      if (regDays < protectionDays) {
        factor = 1 - (1 - decayFactor) * 0.3;  // 新号保护：0.9 → 0.97
      }
      const newScore = Math.floor(current * factor);
      if (newScore >= current) {
        summary.skipped++;
        continue;
      }

      const delta = newScore - current; // 负数

      try {
        // recordEvent 会：写 risk_events + 更新 users.risk_score + 闭环
        await recordEvent({
          userId: u.id,
          ruleCode: 'TIME_DECAY',
          scoreDelta: delta,
          reason: 'decay',
          evidence: {
            factor,
            days_since_event: Math.floor(daysSinceEvent),
            reg_days: Math.floor(regDays),
          },
        });

        // 额外写 decay log
        await supabase.from('risk_score_decay_log').insert({
          user_id: u.id,
          before_score: current,
          after_score: newScore,
          decay_type: 'time_decay',
          metadata: {
            factor,
            days_since_event: Math.floor(daysSinceEvent),
            reg_days: Math.floor(regDays),
          },
        });

        summary.decayed++;
      } catch (err) {
        console.warn('[timeDecay] user', u.id, 'failed:', err && err.message);
        summary.errors++;
      }
    }

    if (page.length < PAGE) break;
    offset += PAGE;
  }

  return summary;
}

module.exports = { runDecay };
