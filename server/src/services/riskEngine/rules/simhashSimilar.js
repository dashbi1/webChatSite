// SIMHASH_SIMILAR: 与 24h 内其他新号的帖子 simhash 距离 < threshold
const supabase = require('../../../config/supabase');
const { simhash, hammingDistance } = require('../../simhash');

async function evaluate({ user, rule, action, context }) {
  if (action !== 'post_create') return { triggered: false };
  const content = context && context.post && context.post.content;
  if (typeof content !== 'string' || content.length < 5) {
    return { triggered: false };
  }

  const {
    threshold_distance = 3,
    window_hours = 24,
    new_days = 7,
  } = (rule && rule.params) || {};

  const currentSig = simhash(content);

  const sinceWindow = new Date(
    Date.now() - window_hours * 3600 * 1000
  ).toISOString();
  const sinceNewAcct = new Date(
    Date.now() - new_days * 86400 * 1000
  ).toISOString();

  // Step 1: 拿 < new_days 的新号 ID 列表（排除当前用户）
  const { data: newUsers, error: nuErr } = await supabase
    .from('users')
    .select('id')
    .gte('created_at', sinceNewAcct)
    .neq('id', user.id)
    .limit(500);
  if (nuErr || !newUsers || newUsers.length === 0) {
    return { triggered: false };
  }
  const newUserIds = newUsers.map((u) => u.id);

  // Step 2: 拿这些新号在 window 内发的帖
  const { data: candidates, error: pErr } = await supabase
    .from('posts')
    .select('id, author_id, content')
    .gte('created_at', sinceWindow)
    .in('author_id', newUserIds)
    .limit(500);
  if (pErr || !candidates || candidates.length === 0) {
    return { triggered: false };
  }

  for (const p of candidates) {
    if (typeof p.content !== 'string' || p.content.length < 5) continue;
    const sig = simhash(p.content);
    const dist = hammingDistance(currentSig, sig);
    if (dist < threshold_distance) {
      return {
        triggered: true,
        evidence: {
          similar_post_id: p.id,
          similar_author_id: p.author_id,
          simhash_distance: dist,
        },
      };
    }
  }
  return { triggered: false };
}

module.exports = { evaluate };
