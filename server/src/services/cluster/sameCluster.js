// Phase 4：同簇判定，用于正向奖励"互动方不在同一风险簇"过滤
// 复用 account_clusters 表，排除 cleared / ignored 状态（admin 已澄清）
//
// 语义：A、B 出现在任意 status IN ('pending','reviewed','banned') 的 cluster.member_ids 中 → 同簇

const supabase = require('../../config/supabase');

const ACTIVE_STATES = ['pending', 'reviewed', 'banned'];

async function isInSameCluster(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;

  const { data, error } = await supabase
    .from('account_clusters')
    .select('id, member_ids')
    .in('status', ACTIVE_STATES)
    .contains('member_ids', [userIdA])
    .limit(50);

  if (error || !data) return false;
  return data.some(
    c => Array.isArray(c.member_ids) && c.member_ids.includes(userIdB)
  );
}

module.exports = { isInSameCluster, ACTIVE_STATES };
